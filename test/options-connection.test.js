import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPage, deferred, lockedControls } from "./helpers/options-page.js";

test("settings connection test uses unsaved values, disables repeats, and does not save", async () => {
  const page = createPage();
  await page.flush();
  const { nodes } = page;
  assert.equal(nodes.testConnection.disabled, false);
  nodes.provider.value = "gemini";
  nodes.key.value = "unsaved-key";
  nodes.model.value = "unsaved-model";
  nodes.base.value = "https://custom.example/v1";
  const run = nodes.testConnection.dispatch("click");
  assert.equal(nodes.testConnection.disabled, true);
  assert.equal(nodes.connectionStatus.textContent, "connectionTesting");
  await nodes.testConnection.dispatch("click");
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, "debait:testConnection");
  assert.equal(page.messages[0].settings.key, "unsaved-key");
  assert.equal(page.messages[0].settings.provider, "gemini");
  assert.equal(page.messages[0].settings.model, "unsaved-model");
  page.resolveReply({ ok: true, code: "success" });
  await run;
  assert.equal(nodes.connectionStatus.textContent, "connectionSuccess connectionSaveReminder");
  assert.equal(nodes.connectionStatus.dataset.state, "success");
  assert.equal(nodes.testConnection.disabled, false);
  assert.equal(page.writes.length, 1); // deterministic migration on load, not a Test connection write
  assert.equal(page.writes[0].profiles.openai.key, "saved-key");
});

test("settings never displays a stale success after the key has changed", async () => {
  const page = createPage();
  await page.flush();
  const run = page.nodes.testConnection.dispatch("click");
  page.nodes.key.value = "new-key";
  await page.nodes.key.dispatch("input");
  page.resolveReply({ ok: true, code: "success" });
  await run;
  assert.equal(page.nodes.connectionStatus.textContent, "");
  assert.equal(page.nodes.testConnection.disabled, false);
});

test("connection results clear when a provider switch changes the key", async () => {
  const page = createPage();
  await page.flush();
  const run = page.nodes.testConnection.dispatch("click");
  page.resolveReply({ ok: true, code: "success" });
  await run;
  page.nodes.provider.value = "anthropic";
  await page.nodes.provider.dispatch("change");
  assert.equal(page.nodes.connectionStatus.textContent, "");
  assert.equal(page.nodes.key.value, "");
});

function assertControlsDisabled(page, disabled) {
  for (const id of lockedControls) assert.equal(page.nodes[id].disabled, disabled || id === "discard", id);
}
async function assertEarlyActionsIgnored(page) {
  assertControlsDisabled(page, true);
  const before = structuredClone(page.store);
  const writes = page.writes.length;
  const messages = page.messages.length;
  page.nodes.provider.value = "custom";
  await page.nodes.provider.dispatch("change");
  await page.nodes.save.dispatch("click");
  await page.nodes.testConnection.dispatch("click");
  await page.nodes.discard.dispatch("click");
  assert.deepEqual(page.store, before);
  assert.equal(page.writes.length, writes);
  assert.equal(page.messages.length, messages);
}

test("Options controls start disabled in markup, before scripts or storage run", () => {
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  for (const id of lockedControls) {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(tag && /\sdisabled(?:\s|>|=)/.test(tag), id);
  }
});

test("Options delayed initial read blocks switching/save/testing without replacing existing settings", async () => {
  const read = deferred();
  const initial = {
    provider: "gemini", key: "existing-key", base: "https://existing.example/v1", model: "existing-model",
    keys: { openai: "owned-key" }, profiles: { custom: { key: "custom-key", base: "https://custom.example/v1", model: "custom-model" } },
    language: "existing-language", customInstructions: "existing-instructions", uiLang: "zh_TW",
    previewDwellMs: 700, previewMinIntervalMs: 3000, dailyCap: 15,
  };
  const page = createPage({ initial, beforeRead: () => read.promise });
  page.nodes.key.value = "premature-key";
  await assertEarlyActionsIgnored(page);
  await page.flush();
  assert.equal(page.writes.length, 0);
  assert.deepEqual(page.store, initial);
  read.resolve();
  await page.flush();
  assertControlsDisabled(page, false);
  for (const id of ["provider", "key", "base", "model", "language", "customInstructions", "uiLang", "previewDwellMs", "previewMinIntervalMs", "dailyCap"]) {
    assert.equal(page.nodes[id].value, String(initial[id]), id);
  }
  assert.equal(page.writes.length, 1); // only the completed migration
  assert.equal(page.store.profiles.gemini.key, initial.key);
  assert.deepEqual(page.store.profiles.custom, initial.profiles.custom);
  page.nodes.provider.value = "custom";
  await page.nodes.provider.dispatch("change");
  assert.equal(page.nodes.key.value, "custom-key");
  page.nodes.provider.value = "gemini";
  await page.nodes.provider.dispatch("change");
  const expected = structuredClone(page.store);
  expected.keys.gemini = initial.key; // Save maintains the active legacy key map, too.
  await page.nodes.save.dispatch("click");
  assert.equal(page.writes.length, 2);
  assert.deepEqual(page.store, expected);
});

for (const stage of ["beforeWrite", "beforeI18n", "beforeUsage"]) {
  test(`Options stays disabled while initialization awaits ${stage}`, async () => {
    const pending = deferred();
    const page = createPage({ [stage]: () => pending.promise });
    await page.flush();
    await assertEarlyActionsIgnored(page);
    pending.resolve();
    await page.flush();
    assertControlsDisabled(page, false);
    assert.equal(page.nodes.provider.value, "openai");
    assert.equal(page.nodes.key.value, "saved-key");
  });
}

for (const stage of ["beforeRead", "beforeWrite", "beforeI18n", "beforeUsage"]) {
  test(`Options initialization failure at ${stage} keeps handlers and controls locked`, async () => {
    const page = createPage({ [stage]: () => { throw new Error("private storage failure sentinel"); } });
    await page.flush();
    assert.equal(page.nodes.status.textContent, "optLoadFailed");
    await assertEarlyActionsIgnored(page);
    assert.equal(page.store.key, "saved-key");
    assert.equal(page.messages.length, 0);
    assert.equal(page.writes.length, ["beforeRead", "beforeWrite"].includes(stage) ? 0 : 1);
    assert.doesNotMatch(page.nodes.status.textContent, /private storage failure sentinel/);
  });
}
