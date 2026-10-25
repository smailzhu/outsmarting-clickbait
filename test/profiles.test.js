import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import "../shared/profiles.js";
const ids = ["openai", "gemini", "ollama", "custom"];
const { migrate } = globalThis.DebaitProfiles;

test("profile migration honors presence/empty ownership and copies base/model to legacy active only", () => {
  const s = migrate({ provider: "gemini", key: "global", base: "https://legacy.example", model: "legacy", keys: { gemini: "", openai: "owned" } }, ids);
  assert.deepEqual(s.profiles.gemini, { key: "", base: "https://legacy.example", model: "legacy" });
  assert.deepEqual(s.profiles.openai, { key: "owned", base: "", model: "" });
  assert.deepEqual(s.profiles.custom, { key: "", base: "", model: "" });
  assert.equal(s.key, ""); assert.deepEqual(migrate(s, ids), s);
  assert.equal(migrate({ provider: "gemini", key: "global", keys: { openai: "other" } }, ids).profiles.gemini.key, "global");
  for (const profile of [{}, { key: "", base: "", model: "" }, { key: "authoritative" }]) {
    const migrated = migrate({ provider: "openai", key: "obsolete", base: "obsolete-base", model: "obsolete-model", keys: { openai: "obsolete-owned" }, profiles: { openai: profile } }, ids);
    assert.equal(migrated.key, profile.key || ""); assert.equal(migrated.base, ""); assert.equal(migrated.model, "");
    assert.deepEqual(migrate(migrated, ids), migrated);
  }
  const custom = migrate({ provider: "custom", key: "saved", base: "https://custom.example/v1", model: "m", keys: {} }, ids);
  assert.deepEqual(custom.profiles.custom, { key: "saved", base: "https://custom.example/v1", model: "m" });
  assert.equal(custom.profiles.openai.key, "");
});

function options(initial) {
  const store = structuredClone(initial), writes = [], messages = [], nodes = {};
  const fields = ["usage", "connectionStatus", "provider", "key", "base", "model", "testConnection", "uiLang", "language", "customInstructions", "previewDwellMs", "previewMinIntervalMs", "dailyCap", "save", "status", "reportLink"];
  for (const id of fields) nodes[id] = { value: "", dataset: {}, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } };
  const pending = [];
  const context = vm.createContext({
    document: { getElementById: (id) => nodes[id], documentElement: {} }, setTimeout: () => 0,
    DebaitI18n: { t: (key) => key, init: async () => {}, apply() {}, lang: "en" },
    chrome: { storage: { sync: { get: async (defaults) => ({ ...defaults, ...store }), set: async (values) => { writes.push(structuredClone(values)); Object.assign(store, structuredClone(values)); } }, local: { get: async (defaults) => defaults } },
      runtime: { sendMessage: (message) => { messages.push(message); return new Promise((resolve) => pending.push(resolve)); } } },
  });
  for (const file of ["profiles.js", "options.js"]) vm.runInContext(readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
  const switchTo = (id) => { nodes.provider.value = id; nodes.provider.handlers.change(); };
  return { nodes, store, writes, messages, pending, switchTo, flush: () => new Promise((resolve) => setImmediate(resolve)) };
}

test("Options first switch before save preserves outgoing unsaved fields, clear/save/reload never resurrects mirrors", async () => {
  const p = options({ provider: "gemini", key: "legacy", base: "https://legacy.example", model: "old", keys: { openai: "owned" } });
  await p.flush();
  assert.equal(p.store.profiles.gemini.key, "legacy");
  p.nodes.key.value = "unsaved"; p.nodes.base.value = "https://unsaved.example"; p.nodes.model.value = "unsaved-model";
  const beforeSwitch = JSON.stringify(p.store); p.switchTo("custom");
  assert.equal(p.nodes.key.value, ""); assert.equal(p.nodes.base.value, ""); assert.equal(p.nodes.model.value, "");
  p.switchTo("openai"); assert.equal(p.nodes.key.value, "owned"); assert.equal(p.nodes.base.value, "");
  p.switchTo("gemini"); assert.equal(p.nodes.key.value, "unsaved"); assert.equal(p.nodes.base.value, "https://unsaved.example"); assert.equal(p.nodes.model.value, "unsaved-model");
  assert.equal(JSON.stringify(p.store), beforeSwitch);
  p.nodes.key.value = ""; await p.nodes.save.handlers.click();
  p.store.key = "obsolete"; p.store.keys.gemini = "obsolete-map";
  const reload = options(p.store); await reload.flush(); assert.equal(reload.nodes.key.value, "");
  reload.switchTo("custom"); reload.switchTo("gemini"); assert.equal(reload.nodes.key.value, "");
  assert.equal(reload.nodes.base.value, "https://unsaved.example");
});

test("Options unsaved keyless custom test does not persist and edit-switch-back cannot display stale success", async () => {
  const p = options({ provider: "openai", key: "legacy" }); await p.flush(); p.switchTo("custom");
  p.nodes.base.value = "http://localhost:8000/v1"; p.nodes.model.value = "fixture";
  const before = JSON.stringify(p.store); const run = p.nodes.testConnection.handlers.click();
  assert.equal(p.messages[0].settings.key, ""); assert.equal(p.messages[0].settings.base, "http://localhost:8000/v1");
  p.switchTo("openai"); p.switchTo("custom");
  p.pending[0]({ ok: true, code: "success" }); await run;
  assert.equal(p.nodes.connectionStatus.textContent, ""); assert.equal(JSON.stringify(p.store), before);
});

test("Options present-empty profile remains authoritative over legacy credentials on repeated loads", async () => {
  const p = options({ provider: "openai", key: "obsolete", keys: { openai: "obsolete-map", gemini: "owned" }, base: "https://obsolete.example", model: "obsolete", profiles: { openai: {} } });
  await p.flush(); assert.equal(p.nodes.key.value, ""); assert.equal(p.nodes.base.value, ""); assert.equal(p.nodes.model.value, "");
  p.switchTo("gemini"); assert.equal(p.nodes.key.value, "owned"); assert.equal(p.nodes.base.value, "");
  p.switchTo("openai"); await p.nodes.save.handlers.click();
  const reload = options(p.store); await reload.flush(); assert.equal(reload.nodes.key.value, ""); assert.equal(reload.writes.length, 0);
});
