import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function createPage() {
  const nodes = {};
  const writes = [];
  const messages = [];
  const elements = ["usage", "connectionStatus", "provider", "key", "base", "model", "testConnection",
    "uiLang", "language", "customInstructions", "previewDwellMs", "previewMinIntervalMs", "dailyCap",
    "save", "status", "reportLink"];
  for (const id of elements) nodes[id] = {
    value: "", textContent: "", dataset: {}, disabled: id === "testConnection", handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
  };
  let resolveReply;
  const reply = new Promise((resolve) => { resolveReply = resolve; });
  const context = vm.createContext({
    document: { getElementById: (id) => nodes[id], documentElement: {} },
    chrome: {
      storage: {
        sync: { get: async (defaults) => ({ ...defaults, key: "saved-key" }), set: async (data) => writes.push(data) },
        local: { get: async (defaults) => defaults },
      },
      runtime: { sendMessage: (data) => { messages.push(data); return reply; } },
    },
    DebaitI18n: { t: (key) => key, init: async () => {}, apply() {}, lang: "en" },
    setTimeout: () => 0,
  });
  vm.runInContext(readFileSync(new URL("../extension/options.js", import.meta.url), "utf8"), context);
  return { nodes, writes, messages, resolveReply, flush: () => new Promise((resolve) => setImmediate(resolve)) };
}

test("settings connection test uses unsaved values, disables repeats, and does not save", async () => {
  const page = createPage();
  await page.flush();
  const { nodes } = page;
  assert.equal(nodes.testConnection.disabled, false);
  nodes.provider.value = "gemini";
  nodes.key.value = "unsaved-key";
  nodes.model.value = "unsaved-model";
  nodes.base.value = "https://custom.example/v1";
  const run = nodes.testConnection.handlers.click();
  assert.equal(nodes.testConnection.disabled, true);
  assert.equal(nodes.connectionStatus.textContent, "connectionTesting");
  await nodes.testConnection.handlers.click();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, "debait:testConnection");
  assert.equal(page.messages[0].settings.key, "unsaved-key");
  assert.equal(page.messages[0].settings.provider, "gemini");
  assert.equal(page.messages[0].settings.model, "unsaved-model");
  page.resolveReply({ ok: true, code: "success" });
  await run;
  assert.equal(nodes.connectionStatus.textContent, "connectionSuccess");
  assert.equal(nodes.connectionStatus.dataset.state, "success");
  assert.equal(nodes.testConnection.disabled, false);
  assert.equal(page.writes.length, 0);
});

test("settings never displays a stale success after the key has changed", async () => {
  const page = createPage();
  await page.flush();
  const run = page.nodes.testConnection.handlers.click();
  page.nodes.key.value = "new-key";
  page.nodes.key.handlers.input();
  page.resolveReply({ ok: true, code: "success" });
  await run;
  assert.equal(page.nodes.connectionStatus.textContent, "");
  assert.equal(page.nodes.testConnection.disabled, false);
});

test("connection results clear when a provider switch changes the key", async () => {
  const page = createPage();
  await page.flush();
  const run = page.nodes.testConnection.handlers.click();
  page.resolveReply({ ok: true, code: "success" });
  await run;
  page.nodes.provider.value = "anthropic";
  page.nodes.provider.handlers.change();
  assert.equal(page.nodes.connectionStatus.textContent, "");
  assert.equal(page.nodes.key.value, "");
});
