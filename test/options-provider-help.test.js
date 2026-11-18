import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createPage, deferred } from "./helpers/options-page.js";

const providers = ["openai", "anthropic", "gemini", "groq", "openrouter", "deepseek", "xai", "mistral", "together", "nvidia", "custom", "ollama"];
const secrets = ["PRIVATE_KEY_123", "https://private.example/BASE?token=SECRET", 'MODEL_\"<unsafe>'];
const initial = (migrated) => ({ provider: "anthropic", key: secrets[0], base: secrets[1], model: secrets[2],
  ...(migrated ? { profiles: Object.fromEntries(providers.map((id) => [id, { key: secrets[0], base: secrets[1], model: secrets[2] }])) } : {}) });
const counters = (p) => [p.calls.syncGet, p.calls.syncSet, p.calls.localGet, p.calls.localSet, p.messages.length, p.fetchCalls.length, p.writes.length];
const rerender = (p) => vm.runInContext("renderProviderHints()", p.context);

for (const connectedDOM of [false, true]) for (const migrated of [false, true]) test(`options provider help follows unsaved selection, Discard and locale without side effects (connected=${connectedDOM}, migrated=${migrated})`, async () => {
  const p = createPage({ initial: initial(migrated), connectedDOM, realI18n: connectedDOM }); await p.flush();
  const before = counters(p), { keyHelp: hint, keyHelpText: text, keyHelpLink: link } = p.nodes;
  const urls = p.context.DebaitProviderHelp.PROVIDER_HELP_URLS;
  assert.equal(p.nodes.key.getAttribute("aria-describedby"), "keyHelp");
  for (const id of providers) {
    await p.switchTo(id);
    assert.equal(hint.hidden, false);
    if (Object.hasOwn(urls, id)) {
      assert.equal(link.href, urls[id]); assert.equal(link.hidden, false); assert.equal(text.textContent, "");
      assert.equal(link.textContent, p.i18n.t("keyHelpLinkLabel"));
    } else {
      assert.equal(link.hidden, true); assert.equal(link.getAttribute("href"), null); assert.equal(link.textContent, "");
      assert.equal(text.textContent, p.i18n.t(id === "custom" ? "keyHelpCustom" : id === "ollama" ? "keyHelpOllama" : "keyHelpCloudLocal"));
    }
    for (const value of secrets) assert.ok(![hint.textContent, text.textContent, link.textContent, link.href, p.consoleOutput.join(), JSON.stringify(p.messages)].join().includes(value));
    const markers = providers.length && p.nodes.provider.getAttribute("data-modified"), listeners = p.window.counts.added;
    const dirty = vm.runInContext("dirty", p.context);
    rerender(p);
    assert.equal(vm.runInContext("dirty", p.context), dirty);
    assert.equal(p.nodes.provider.getAttribute("data-modified"), markers); assert.equal(p.window.counts.added, listeners);
  }
  await p.nodes.discard.click(); assert.equal(p.nodes.provider.value, "anthropic"); assert.equal(link.href, urls.anthropic);
  for (const lang of ["en", "zh_TW", "nan-Hanlo"]) {
    p.store.uiLang = lang; await p.i18n.init(); vm.runInContext("applyI18n()", p.context);
    assert.equal(p.document.getElementById("keyHelpText"), text); assert.equal(p.document.getElementById("keyHelpLink"), link);
    assert.equal(link.textContent, p.i18n.t("keyHelpLinkLabel"));
    assert.equal(p.nodes.key.getAttribute("aria-describedby"), "keyHelp");
  }
  // Explicit i18n init above reads storage; help/localization render itself does not.
  const afterInit = counters(p); rerender(p); vm.runInContext("applyI18n()", p.context); assert.deepEqual(counters(p), afterInit);
  assert.equal(p.calls.syncSet, before[1]); assert.equal(p.messages.length, 0); assert.equal(p.fetchCalls.length, 0);
  await link.click(); assert.deepEqual(p.navigations, [{ href: urls.anthropic, target: "_blank", rel: "noopener noreferrer" }]); assert.deepEqual(counters(p), afterInit);
  for (const id of ["", "unknown", "constructor", "toString"]) {
    p.nodes.provider.value = id; rerender(p);
    assert.equal(hint.hidden, true); assert.equal(link.getAttribute("href"), null); assert.equal(text.textContent + link.textContent, "");
  }
});

test("options loading/failed-load hide help, even with a visible linked selection", async () => {
  for (const fail of [false, true]) {
    const read = deferred(), p = createPage({ initial: initial(false), beforeRead: () => read.promise });
    p.nodes.provider.value = "anthropic"; rerender(p);
    assert.equal(p.nodes.keyHelp.hidden, true); assert.equal(p.nodes.keyHelpLink.getAttribute("href"), null);
    if (fail) read.reject(new Error("private fixture load failure")); else read.resolve();
    await p.flush(); assert.equal(p.nodes.keyHelp.hidden, fail);
    if (fail) assert.equal(p.nodes.keyHelpLink.getAttribute("href"), null);
  }
});

test("help rerender/click never changes deferred Test busy state or resurrects invalidated feedback", async () => {
  const p = createPage({ initial: initial(true) }); await p.flush();
  const testing = p.nodes.testConnection.click(); await p.flush(); assert.equal(p.messages.length, 1);
  const before = counters(p), busy = p.nodes.testConnection.disabled;
  rerender(p); await p.nodes.keyHelpLink.click(); assert.deepEqual(counters(p), before); assert.equal(p.nodes.testConnection.disabled, busy);
  await p.switchTo("groq"); rerender(p); await p.nodes.keyHelpLink.click();
  assert.equal(p.nodes.testConnection.disabled, true); assert.deepEqual(counters(p), before);
  await p.nodes.discard.click(); assert.equal(p.nodes.testConnection.disabled, true);
  p.pending[0].resolve({ ok: true }); await testing;
  assert.equal(p.nodes.testConnection.disabled, false); assert.equal(p.nodes.connectionStatus.textContent, "");
});

test("a later Save preserves the last rendered help while controls are locked", async () => {
  const write = deferred(); let block = false;
  const p = createPage({ initial: initial(true), beforeWrite: () => block ? write.promise : undefined }); await p.flush();
  await p.switchTo("groq"); block = true; const saved = p.nodes.save.click(); await p.flush();
  const href = p.nodes.keyHelpLink.href; rerender(p); assert.equal(p.nodes.keyHelpLink.href, href);
  write.resolve(); await saved;
});

for (const lang of ["en", "zh_TW", "nan-Hanlo"]) test(`connected options ${lang} all provider help texts survive actual localization`, async () => {
  const p = createPage({ initial: { ...initial(true), uiLang: lang }, realI18n: true }); await p.flush();
  const before = counters(p), ids = [p.nodes.keyHelp, p.nodes.keyHelpText, p.nodes.keyHelpLink];
  for (const id of providers) {
    await p.switchTo(id); vm.runInContext("applyI18n()", p.context);
    const expectedKey = Object.hasOwn(p.context.DebaitProviderHelp.PROVIDER_HELP_URLS, id) ? "keyHelpLinkLabel" : id === "custom" ? "keyHelpCustom" : id === "ollama" ? "keyHelpOllama" : "keyHelpCloudLocal";
    assert.equal(p.nodes.keyHelp.textContent, p.context.DebaitMessages[lang][expectedKey].message);
    assert.deepEqual(ids.map((node) => p.document.getElementById(node.getAttribute("id"))), ids);
    assert.ok(p.nodes.key.getAttribute("aria-describedby").split(/\s+/).includes("keyHelp"));
  }
  assert.deepEqual(counters(p), before);
});
