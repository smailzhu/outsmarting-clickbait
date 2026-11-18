import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createPage, deferred, editableControls, lockedControls } from "./helpers/options-page.js";

const providerIds = ["openai", "anthropic", "gemini", "groq", "openrouter", "deepseek", "xai", "mistral", "together", "nvidia", "ollama", "custom"];
const secrets = ["KEY_SENTINEL_928", "BASE_SENTINEL_731", "MODEL_SENTINEL_612", "ERROR_SENTINEL_529", "INSTRUCTIONS_SENTINEL_417", "ARTICLE_SENTINEL_318", "UPSTREAM_SENTINEL_219"];
function initialSettings(overrides = {}) {
  const profiles = Object.fromEntries(providerIds.map((id) => [id, { key: "", base: "", model: "" }]));
  profiles.openai = { key: secrets[0], base: `https://${secrets[1]}.example/v1`, model: secrets[2] };
  profiles.gemini = { key: "dormant-key", base: "https://dormant.example", model: "dormant-model" };
  profiles.unknown = { key: "unknown-key", base: "unknown-base", model: "unknown-model" };
  return { provider: "openai", ...profiles.openai, keys: { openai: "old-mirror", gemini: "legacy-dormant" }, profiles,
    uiLang: "", language: "English", customInstructions: secrets[4], previewDwellMs: 500, previewMinIntervalMs: 1500, dailyCap: 200, ...overrides };
}
async function ready(options = {}) {
  const page = createPage({ initial: initialSettings(), ...options });
  await page.flush();
  assert.equal(page.nodes.save.disabled, false);
  feedback(page, "");
  return page;
}
function safeText(page) {
  for (const id of ["status", "connectionStatus"]) for (const secret of secrets) assert.ok(!page.nodes[id].textContent.includes(secret), `${id} must not echo fixtures`);
  for (const secret of secrets.slice(3)) {
    for (const node of Object.values(page.nodes)) assert.ok(!node.textContent.includes(secret), "error/content must not appear in DOM text");
    assert.ok(!page.consoleOutput.join(" ").includes(secret), "error/content must not appear in console");
  }
  assert.deepEqual(page.consoleOutput, []);
}
function feedback(page, status, connection) {
  assert.equal(page.nodes.status.textContent, status);
  if (connection !== undefined) assert.equal(page.nodes.connectionStatus.textContent, connection);
  safeText(page);
}
const unloadCount = (page) => page.window.listeners.get("beforeunload")?.size || 0;
function locked(page, expected) {
  for (const id of lockedControls) assert.equal(page.nodes[id].disabled, expected || (id === "discard" && !readState(page, "dirty")), id);
}
async function succeedTest(page) {
  const run = page.nodes.testConnection.dispatch("click");
  page.pending.at(-1).resolve({ ok: true, code: "success" });
  await run;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
// Lexical state inspection is test-only; production exposes no debug/draft API.
const readState = (page, expression) => vm.runInContext(expression, page.context);
const connectionGenerationOf = (page) => readState(page, "connectionGeneration");

// Prove listener tests cannot pass vacuously because callbacks replaced each other.
test("options-page helper dispatches/removes multiple listeners and models select/input values", async () => {
  const page = await ready(), calls = [];
  const first = () => calls.push(1), second = () => calls.push(2);
  for (const target of [page.nodes.key, page.window]) {
    target.addEventListener("selfcheck", first); target.addEventListener("selfcheck", second);
    await target.dispatchEvent({ type: "selfcheck" });
    target.removeEventListener("selfcheck", first); await target.dispatchEvent({ type: "selfcheck" });
  }
  assert.deepEqual(calls, [1, 2, 2, 1, 2, 2]);
  page.nodes.dailyCap.value = 15.4; assert.equal(page.nodes.dailyCap.value, "15.4");
  page.nodes.dailyCap.value = "abc"; assert.equal(page.nodes.dailyCap.value, "");
  page.nodes.uiLang.value = "fr"; assert.equal(page.nodes.uiLang.value, "");
  page.nodes.key.value = "line\nbreak"; assert.equal(page.nodes.key.value, "linebreak");
});

for (const stage of ["beforeRead", "beforeWrite", "beforeI18n", "beforeUsage"]) {
  for (const reject of [false, true]) test(`options.js fail-closed ${stage} ${reject ? "rejection" : "delay"} ignores every early handler`, async () => {
    const gate = deferred(), page = createPage({ [stage]: () => gate.promise });
    await page.flush();
    const attempts = page.attempts.length, generation = connectionGenerationOf(page), drafts = plain(readState(page, "draftProfiles"));
    const discardBefore = discardCheckpoint(page), owner = readState(page, "draftProvider"), unload = readState(page, "unloadAttached");
    await page.nodes.discard.dispatch("click"); unchangedDiscardState(page, discardBefore);
    assert.equal(readState(page, "draftProvider"), owner); assert.equal(readState(page, "unloadAttached"), unload);
    for (const id of editableControls) {
      page.nodes[id].value = id === "provider" ? "custom" : "premature";
      await page.nodes[id].dispatch("input"); await page.nodes[id].dispatch("change");
    }
    await page.nodes.save.dispatch("click"); await page.nodes.testConnection.dispatch("click"); await page.nodes.discard.dispatch("click");
    locked(page, true); feedback(page, "");
    assert.deepEqual(plain(readState(page, "draftProfiles")), drafts);
    assert.equal(connectionGenerationOf(page), generation);
    assert.equal(page.attempts.length, attempts); assert.equal(page.messages.length, 0); assert.equal(unloadCount(page), 0);
    if (reject) gate.reject(new Error(secrets.slice(3).join(" "))); else gate.resolve();
    await page.flush();
    locked(page, reject); feedback(page, reject ? "optLoadFailed" : ""); assert.equal(unloadCount(page), 0);
    const settledBefore = discardCheckpoint(page), settledGeneration = connectionGenerationOf(page);
    await page.nodes.discard.dispatch("click"); unchangedDiscardState(page, settledBefore);
    assert.equal(connectionGenerationOf(page), settledGeneration); feedback(page, reject ? "optLoadFailed" : "");
    assert.equal(page.writes.length, reject && ["beforeRead", "beforeWrite"].includes(stage) ? 0 : 1);
  });
}
for (const uiLang of ["fr", "auto"]) test(`options.js normalized form baseline starts clean for invalid uiLang ${uiLang}`, async () => {
  const initial = initialSettings({ uiLang, language: " English ", customInstructions: " instructions ", previewDwellMs: 15.4, previewMinIntervalMs: -3, dailyCap: "abc" });
  const page = await ready({ initial });
  assert.equal(page.nodes.uiLang.value, ""); assert.equal(page.nodes.dailyCap.value, "");
  assert.deepEqual(plain(readState(page, "baseline")), { provider: "openai", uiLang: "", language: "English", customInstructions: "instructions",
    previewDwellMs: 15, previewMinIntervalMs: 1500, dailyCap: 200, profiles: initial.profiles });
  assert.equal(page.attempts.length, 0); assert.equal(unloadCount(page), 0);
  for (const [id, value] of [["dailyCap", ""], ["previewDwellMs", "15.49"], ["previewMinIntervalMs", "-3"]]) { await page.edit(id, value); feedback(page, ""); }
});
test("options.js saving an unknown stored provider preserves its profile without an unhandled error", async () => {
  const initial = initialSettings({ provider: "removed-provider" });
  initial.profiles["removed-provider"] = { key: "retained-key", base: "https://retained.example", model: "retained-model" };
  const page = await ready({ initial });
  assert.equal(page.nodes.provider.value, "");
  await page.nodes.save.dispatch("click");
  feedback(page, "optSaved");
  locked(page, false);
  assert.equal(unloadCount(page), 0);
  assert.deepEqual(page.store.profiles["removed-provider"], initial.profiles["removed-provider"]);
  assert.equal(page.store.key, "");
  assert.equal(page.store.base, "");
  assert.equal(page.store.model, "");
});

const dirtyEdits = { uiLang: "zh_TW", provider: "gemini", key: "changed-key", base: "https://changed.example", model: "changed-model",
  language: "Japanese", customInstructions: "changed instructions", previewDwellMs: 501, previewMinIntervalMs: 1501, dailyCap: 201 };
for (const [id, value] of Object.entries(dirtyEdits)) test(`options.js ${id} dirty/revert and canonical equivalence`, async () => {
  const page = await ready(), original = page.nodes[id].value;
  if (id === "provider") await page.switchTo(value); else await page.edit(id, value);
  feedback(page, "optUnsaved"); assert.equal(unloadCount(page), 1);
  const textWrites = page.nodes.status.textWrites;
  await page.nodes[id].dispatch("change"); feedback(page, "optUnsaved"); assert.equal(page.nodes.status.textWrites, textWrites);
  if (id === "provider") await page.switchTo(original); else await page.edit(id, original);
  feedback(page, ""); assert.equal(unloadCount(page), 0); assert.equal(page.attempts.length, 0);
  if (["key", "base", "model", "language", "customInstructions"].includes(id)) { await page.edit(id, `  ${original}  `); feedback(page, ""); }
});
test("options.js numeric intOr order rounds before nonnegative check and preserves defaults", async () => {
  const page = await ready();
  for (const [id, value] of [["previewDwellMs", "500.49"], ["previewMinIntervalMs", ""], ["dailyCap", "abc"], ["dailyCap", "-3"]]) { await page.edit(id, value); feedback(page, ""); }
  await page.edit("dailyCap", "-0.4"); feedback(page, "optUnsaved"); assert.equal(readState(page, "buildDraft().dailyCap"), -0);
  await page.edit("dailyCap", "Infinity"); feedback(page, "");
});
test("options.js provider input/change captures outgoing profile without transient dirty or insertion-order sensitivity", async () => {
  const page = await ready();
  page.nodes.provider.value = "gemini"; await page.nodes.provider.dispatch("input");
  feedback(page, ""); assert.equal(unloadCount(page), 0);
  assert.equal(readState(page, "draftProfiles.gemini.key"), "dormant-key"); assert.equal(page.nodes.key.value, secrets[0]);
  await page.nodes.provider.dispatch("change"); feedback(page, "optUnsaved"); assert.equal(page.nodes.key.value, "dormant-key");
  await page.switchTo("openai"); feedback(page, "");
  vm.runInContext("draftProfiles = Object.fromEntries(Object.entries(draftProfiles).reverse())", page.context);
  await page.nodes.language.dispatch("input"); feedback(page, "");
  await page.switchTo("gemini"); await page.edit("key", "edited-gemini"); await page.switchTo("custom"); await page.switchTo("gemini");
  assert.equal(page.nodes.key.value, "edited-gemini");
  await page.edit("key", "dormant-key"); await page.switchTo("openai"); feedback(page, "");
});
test("options.js cleared dormant authoritative profile and unknown profiles persist without rewriting dormant keys", async () => {
  const page = await ready(), initial = structuredClone(page.store);
  await page.switchTo("gemini"); await page.edit("key", ""); await page.switchTo("openai");
  await page.nodes.save.dispatch("click"); feedback(page, "optSaved"); assert.equal(page.store.profiles.gemini.key, "");
  for (const id of Object.keys(initial.profiles).filter((id) => id !== "gemini")) assert.equal(JSON.stringify(page.store.profiles[id]), JSON.stringify(initial.profiles[id]), id);
  assert.deepEqual(page.store.keys, { ...initial.keys, openai: secrets[0] });
  const reload = await ready({ initial: page.store });
  await reload.switchTo("gemini"); assert.equal(reload.nodes.key.value, "");
  await reload.switchTo("openai"); await reload.switchTo("gemini"); assert.equal(reload.nodes.key.value, "");
});
test("options.js pure builder normalizes every dormant profile without refilling explicit empty fields", async () => {
  const initial = initialSettings(); initial.profiles.unknown = { key: " unknown ", base: 123, model: "" };
  const page = await ready({ initial });
  const drafts = plain(readState(page, "draftProfiles"));
  const built = plain(readState(page, "buildDraft()"));
  assert.deepEqual(built.profiles.unknown, { key: "unknown", base: "", model: "" });
  assert.deepEqual(plain(readState(page, "draftProfiles")), drafts); feedback(page, "");
  built.profiles.gemini.key = "detached";
  assert.equal(readState(page, "draftProfiles.gemini.key"), "dormant-key");
});

test("options.js detached pending Save captures exact full payload, guards double/synthetic actions and never force-cleans live changes", async () => {
  const write = deferred(), page = await ready({ beforeWrite: () => write.promise });
  await page.edit("key", "new-key"); await page.edit("dailyCap", 15.4);
  const snapshot = plain(readState(page, "buildDraft()")), oldBaseline = plain(readState(page, "baseline"));
  const run = page.nodes.save.dispatch("click");
  locked(page, true); feedback(page, "optSaving"); assert.equal(page.nodes.save.textContent, "optSaving");
  assert.equal(page.attempts.length, 1); assert.equal(page.writes.length, 0);
  const expected = { provider: snapshot.provider, ...snapshot.profiles.openai, keys: { openai: "new-key", gemini: "legacy-dormant" }, profiles: snapshot.profiles,
    language: snapshot.language, customInstructions: snapshot.customInstructions, uiLang: snapshot.uiLang,
    previewDwellMs: snapshot.previewDwellMs, previewMinIntervalMs: snapshot.previewMinIntervalMs, dailyCap: snapshot.dailyCap };
  assert.deepEqual(page.attempts[0].data, expected);
  assert.deepEqual(Object.keys(page.attempts[0].data).sort(), ["provider", "key", "keys", "profiles", "base", "model", "language", "customInstructions", "uiLang", "previewDwellMs", "previewMinIntervalMs", "dailyCap"].sort());
  const drafts = plain(readState(page, "draftProfiles")), generation = connectionGenerationOf(page);
  await page.nodes.save.dispatch("click"); await page.nodes.testConnection.dispatch("click"); await page.nodes.discard.dispatch("click");
  for (const id of editableControls) {
    const original = page.nodes[id].value;
    page.nodes[id].value = id === "provider" ? "gemini" : "synthetic";
    await page.nodes[id].dispatch("input"); await page.nodes[id].dispatch("change");
    if (id === "provider") assert.equal(page.nodes[id].value, "openai");
    page.nodes[id].value = original;
  }
  assert.deepEqual(plain(readState(page, "draftProfiles")), drafts); assert.deepEqual(plain(readState(page, "baseline")), oldBaseline);
  assert.equal(connectionGenerationOf(page), generation); assert.equal(page.messages.length, 0); assert.equal(page.attempts.length, 1);
  page.nodes.language.value = "synthetic-live-change";
  vm.runInContext('draftProfiles.unknown.key = "synthetic-map-change"', page.context);
  assert.deepEqual(plain(page.attempts[0].reference), expected); assert.equal(unloadCount(page), 1);
  write.resolve(); await run;
  assert.deepEqual(page.store, expected); assert.deepEqual(plain(readState(page, "baseline")), snapshot);
  assert.equal(readState(page, "Object.isFrozen(baseline) && Object.isFrozen(baseline.profiles.unknown) && Object.isFrozen(committed.keys)"), true);
  feedback(page, "optUnsaved"); locked(page, false); assert.equal(unloadCount(page), 1);
  page.fireTimer(0); feedback(page, "optUnsaved"); await page.edit("language", snapshot.language); feedback(page, "");
});

for (const order of ["test-before-commit", "commit-before-test"]) test(`options.js independent Save/Test concurrency ${order}`, async () => {
  const write = deferred(), refresh = deferred(); let initCalls = 0;
  const page = await ready({ beforeWrite: () => write.promise, beforeI18n: () => ++initCalls > 1 ? refresh.promise : undefined });
  await page.edit("key", "new-key"); const generation = connectionGenerationOf(page);
  const testRun = page.nodes.testConnection.dispatch("click");
  assert.equal(page.nodes.save.disabled, false); assert.equal(page.nodes.key.disabled, false);
  await page.nodes.testConnection.dispatch("click"); assert.equal(page.messages.length, 1);
  const saveRun = page.nodes.save.dispatch("click"); locked(page, true);
  if (order === "test-before-commit") {
    page.resolveReply({ ok: true, code: "success" }); await testRun;
    feedback(page, "optSaving", "connectionSuccess connectionSaveReminder"); locked(page, true); assert.equal(unloadCount(page), 1);
  }
  write.resolve(); await page.flush();
  feedback(page, "optSaving", order === "test-before-commit" ? "connectionSuccess" : "connectionTesting");
  assert.equal(unloadCount(page), 0); locked(page, true); assert.equal(connectionGenerationOf(page), generation);
  if (order === "commit-before-test") {
    page.resolveReply({ ok: true, code: "success" }); await testRun;
    feedback(page, "optSaving", "connectionSuccess"); locked(page, true);
  }
  refresh.resolve(); await saveRun;
  feedback(page, "optSaved", "connectionSuccess"); locked(page, false);
  assert.equal(page.messages.length, 1); assert.equal(page.attempts.length, 1);
});
for (const clean of [false, true]) test(`options.js ${clean ? "clean" : "dirty"} write failure retains drafts, unlocks and retries without rejection`, async () => {
  let fail = true, initCalls = 0, usageCalls = 0;
  const page = await ready({ beforeWrite: () => { if (fail) throw new Error(secrets.slice(3).join(" ")); }, beforeI18n: () => { initCalls++; }, beforeUsage: () => { usageCalls++; } });
  if (!clean) { await page.switchTo("gemini"); await page.edit("key", ""); await page.switchTo("openai"); await page.edit("key", "retained-key"); await succeedTest(page); feedback(page, "optUnsaved", "connectionSuccess connectionSaveReminder"); }
  const oldStore = structuredClone(page.store), oldBaseline = plain(readState(page, "baseline")), oldDraft = plain(readState(page, "buildDraft()")), unhandled = [];
  const observe = (error) => unhandled.push(error); process.on("unhandledRejection", observe);
  try {
    page.nodes.save.focus(); await page.nodes.save.dispatch("click"); await page.flush();
    assert.deepEqual(unhandled, []); assert.deepEqual(page.store, oldStore);
    assert.deepEqual(plain(readState(page, "baseline")), oldBaseline); assert.deepEqual(plain(readState(page, "buildDraft()")), oldDraft);
    feedback(page, "optSaveFailed", clean ? "" : "connectionSuccess connectionSaveReminder"); locked(page, false);
    assert.equal(unloadCount(page), clean ? 0 : 1); assert.equal(page.document.activeElement, page.nodes.save);
    assert.equal(page.timers.length, 0); assert.equal(initCalls, 1); assert.equal(usageCalls, 1);
    await page.edit("language", "changed-language"); feedback(page, "optSaveFailed");
    await page.edit("language", oldDraft.language); feedback(page, "optSaveFailed"); await succeedTest(page); feedback(page, "optSaveFailed");
    fail = false; await page.nodes.save.dispatch("click"); feedback(page, "optSaved", "connectionSuccess"); assert.equal(unloadCount(page), 0);
    assert.deepEqual(page.attempts[1].data, page.attempts[0].data); if (!clean) assert.equal(page.store.profiles.gemini.key, "");
  } finally { process.removeListener("unhandledRejection", observe); }
});

for (const stage of ["init", "apply", "usage"]) test(`options.js persistence then ${stage} refresh rejection is warning, not failure/rollback`, async () => {
  let calls = 0; const gate = deferred();
  const options = stage === "init" ? { beforeI18n: () => ++calls > 1 ? gate.promise : undefined }
    : stage === "apply" ? { beforeApply: () => { if (++calls > 1) throw new Error(secrets.slice(3).join(" ")); } }
    : { beforeUsage: () => ++calls > 1 ? gate.promise : undefined };
  const page = await ready(options); await page.edit("key", "refresh-key"); await succeedTest(page); page.nodes.save.focus();
  const run = page.nodes.save.dispatch("click"); await page.flush();
  if (stage !== "apply") {
    feedback(page, "optSaving", "connectionSuccess"); locked(page, true);
    assert.equal(unloadCount(page), 0); assert.equal(page.store.key, "refresh-key"); gate.reject(new Error(secrets.slice(3).join(" ")));
  }
  await run; feedback(page, "optSavedRefreshWarning", "connectionSuccess"); locked(page, false);
  assert.equal(unloadCount(page), 0); assert.equal(page.document.activeElement, page.nodes.save); assert.equal(page.timers.length, 0); assert.equal(page.store.key, "refresh-key");
  await page.edit("language", "new-language"); feedback(page, "optUnsaved"); await page.edit("language", "English"); feedback(page, "optSavedRefreshWarning");
  await succeedTest(page); feedback(page, "optSavedRefreshWarning");
});
test("options.js refresh rejection while Test pending preserves independent busy state and new baseline", async () => {
  let calls = 0; const refresh = deferred(), page = await ready({ beforeI18n: () => ++calls > 1 ? refresh.promise : undefined });
  await page.edit("key", "new-key"); const testRun = page.nodes.testConnection.dispatch("click");
  const saveRun = page.nodes.save.dispatch("click"); await page.flush(); refresh.reject(new Error(secrets[3])); await saveRun;
  assert.equal(page.nodes.key.disabled, false); assert.equal(page.nodes.save.disabled, false); assert.equal(page.nodes.testConnection.disabled, true);
  feedback(page, "optSavedRefreshWarning", "connectionTesting"); page.resolveReply({ ok: true, code: "success" }); await testRun;
  feedback(page, "optSavedRefreshWarning", "connectionSuccess"); locked(page, false);
});
test("options.js secondary usage refresh uses captured cap despite disabled synthetic value changes", async () => {
  const write = deferred(), page = await ready({ beforeWrite: () => write.promise });
  await page.edit("dailyCap", 25); const run = page.nodes.save.dispatch("click"); page.nodes.dailyCap.value = 77;
  write.resolve(); await run; assert.equal(page.store.dailyCap, 25); assert.match(page.nodes.usage.textContent, / \/ 25$/);
  feedback(page, "optUnsaved");
});

test("options.js saved-flash tokens cannot erase Unsaved, failure, or a newer flash", async () => {
  let fail = false; const page = await ready({ beforeWrite: () => { if (fail) throw new Error(secrets[3]); } });
  await page.nodes.save.dispatch("click"); feedback(page, "optSaved"); assert.equal(page.timers[0].delay, 1500);
  await page.edit("language", "Japanese"); feedback(page, "optUnsaved"); page.fireTimer(0, true); feedback(page, "optUnsaved");
  await page.nodes.save.dispatch("click"); feedback(page, "optSaved"); page.fireTimer(0, true); feedback(page, "optSaved");
  fail = true; await page.nodes.save.dispatch("click"); feedback(page, "optSaveFailed"); page.fireTimer(1, true); feedback(page, "optSaveFailed");
  fail = false; await page.nodes.save.dispatch("click"); feedback(page, "optSaved"); page.fireTimer(1, true); feedback(page, "optSaved");
  page.fireTimer(2); feedback(page, "");
});
test("options.js flash starts after refresh/unlock and cannot erase newer refresh warning or Saving", async () => {
  const refresh = deferred(); let calls = 0;
  const page = await ready({ beforeI18n: () => { calls++; if (calls === 2) return refresh.promise; if (calls === 3) throw new Error(secrets[3]); } });
  const run = page.nodes.save.dispatch("click"); await page.flush(); assert.equal(page.timers.length, 0); feedback(page, "optSaving");
  refresh.resolve(); await run; assert.equal(page.nodes.save.disabled, false); assert.equal(page.timers.length, 1);
  const next = page.nodes.save.dispatch("click"); page.fireTimer(0, true); feedback(page, "optSaving");
  await next; feedback(page, "optSavedRefreshWarning"); page.fireTimer(0, true); feedback(page, "optSavedRefreshWarning");
});
test("options.js current i18n dynamic status/reminder and Saving survive static-label resets", async () => {
  const refresh = deferred(); let calls = 0;
  const page = await ready({ beforeI18n: () => ++calls > 1 ? refresh.promise : undefined, translate: (key, lang) => `${lang}:${key}`, applyStaticLabels: true });
  await page.edit("key", "new-key"); await succeedTest(page); feedback(page, "en:optUnsaved", "en:connectionSuccess en:connectionSaveReminder");
  page.i18n.lang = "zh_TW"; readState(page, "applyI18n()"); feedback(page, "zh_TW:optUnsaved", "zh_TW:connectionSuccess zh_TW:connectionSaveReminder");
  await page.edit("uiLang", "nan-Hanlo"); const saveRun = page.nodes.save.dispatch("click"); await page.flush(); feedback(page, "zh_TW:optSaving", "zh_TW:connectionSuccess");
  page.i18n.lang = "nan-Hanlo"; readState(page, "applyI18n()"); assert.equal(page.nodes.save.textContent, "nan-Hanlo:optSaving"); feedback(page, "nan-Hanlo:optSaving", "nan-Hanlo:connectionSuccess");
  refresh.resolve(); await saveRun; feedback(page, "nan-Hanlo:optSaved", "nan-Hanlo:connectionSuccess");
  await page.edit("key", "different-key"); await succeedTest(page); feedback(page, "nan-Hanlo:optUnsaved", "nan-Hanlo:connectionSuccess nan-Hanlo:connectionSaveReminder");
});
test("options.js nonconnection edit invalidates flash but read-only Test does not clear Save feedback", async () => {
  const page = await ready(); await page.nodes.save.dispatch("click"); feedback(page, "optSaved");
  const run = page.nodes.testConnection.dispatch("click"); feedback(page, "optSaved", "connectionTesting");
  page.resolveReply({ ok: true, code: "success" }); await run; feedback(page, "optSaved", "connectionSuccess");
  await page.edit("language", "Japanese"); feedback(page, "optUnsaved", "connectionSuccess"); await page.edit("language", "English"); feedback(page, "", "connectionSuccess");
});

test("options.js one named unload listener has exact browser semantics and no write/message/timer side effects", async () => {
  const write = deferred(); let fail = true;
  const page = await ready({ beforeWrite: async () => { await write.promise; if (fail) throw new Error(secrets[3]); } });
  await page.edit("language", "changed"); const textWrites = page.nodes.status.textWrites;
  for (const value of ["changed1", "changed2", "changed3"]) await page.edit("language", value);
  feedback(page, "optUnsaved"); assert.equal(page.nodes.status.textWrites, textWrites); assert.equal(page.window.counts.added, 1);
  const listener = [...page.window.listeners.get("beforeunload")][0]; assert.equal(listener.name, "warnBeforeUnload");
  const before = [page.attempts.length, page.messages.length, page.timers.length];
  const event = { type: "beforeunload", returnValue: "old", prevented: 0, preventDefault() { this.prevented++; } };
  await page.window.dispatchEvent(event); assert.equal(event.prevented, 1); assert.equal(event.returnValue, "");
  assert.deepEqual([page.attempts.length, page.messages.length, page.timers.length], before);
  const run = page.nodes.save.dispatch("click"); assert.equal(unloadCount(page), 1);
  write.resolve(); await run; feedback(page, "optSaveFailed"); assert.equal(unloadCount(page), 1);
  assert.equal(page.window.counts.added, 1); assert.equal(page.window.counts.removed, 0);
  await page.edit("language", "English"); feedback(page, "optSaveFailed"); assert.equal(unloadCount(page), 0); assert.equal(page.window.counts.removed, 1);
  fail = false; await page.edit("language", "new"); assert.equal(page.window.counts.added, 2);
  await page.nodes.save.dispatch("click"); assert.equal(unloadCount(page), 0); assert.equal(page.window.counts.removed, 2);
});
for (const id of Object.keys(dirtyEdits)) test(`options.js read-only Test reminder matrix for unsaved ${id}`, async () => {
  const page = await ready(); if (id === "provider") await page.switchTo("gemini"); else await page.edit(id, dirtyEdits[id]);
  await succeedTest(page); feedback(page, "optUnsaved", `connectionSuccess${["provider", "key", "base", "model"].includes(id) ? " connectionSaveReminder" : ""}`);
  assert.equal(page.messages.length, 1); assert.equal(page.attempts.length, 0);
});
for (const action of ["edit-return", "switch-return", "change-only", "input-only"]) test(`options.js stale ${action} response has no success/reminder even if values return`, async () => {
  const page = await ready(), run = page.nodes.testConnection.dispatch("click");
  if (action === "edit-return") { await page.edit("key", "temporary"); await page.edit("key", secrets[0]); }
  if (action === "switch-return") { await page.switchTo("gemini"); await page.switchTo("openai"); }
  if (action === "change-only") { page.nodes.provider.value = "gemini"; await page.nodes.provider.dispatch("change"); page.nodes.provider.value = "openai"; await page.nodes.provider.dispatch("change"); }
  if (action === "input-only") await page.nodes.provider.dispatch("input");
  page.resolveReply({ ok: true, code: "success" }); await run; feedback(page, "", ""); assert.equal(page.messages.length, 1); assert.equal(page.attempts.length, 0);
});
for (const result of [{ ok: false, code: "auth" }, { ok: false, code: "unknown", message: secrets[3] }, { ok: true, code: "empty" }]) test(`options.js no reminder for non-success code ${result.code}`, async () => {
  const page = await ready(); await page.edit("key", "unsaved");
  const run = page.nodes.testConnection.dispatch("click"); page.resolveReply(result); await run;
  feedback(page, "optUnsaved"); assert.ok(!page.nodes.connectionStatus.textContent.includes("connectionSaveReminder"));
  assert.equal(readState(page, "testedTuple"), null); assert.equal(page.attempts.length, 0);
});

for (const outcome of ["success", "write-failure", "refresh-warning"]) {
  for (const moved of [false, true]) test(`options.js conditional Save focus restoration ${outcome}, moved=${moved}`, async () => {
    const gate = deferred(); let initCalls = 0;
    const page = await ready({ beforeWrite: async () => { await gate.promise; if (outcome === "write-failure") throw new Error(secrets[3]); }, beforeI18n: () => { if (++initCalls > 1 && outcome === "refresh-warning") throw new Error(secrets[3]); } });
    page.nodes.save.focus(); const run = page.nodes.save.dispatch("click"); assert.equal(page.document.activeElement, page.document.body);
    if (moved) page.nodes.reportLink.focus(); gate.resolve(); await run;
    assert.equal(page.document.activeElement, moved ? page.nodes.reportLink : page.nodes.save);
    feedback(page, outcome === "success" ? "optSaved" : outcome === "write-failure" ? "optSaveFailed" : "optSavedRefreshWarning");
  });
}
test("options.js Save does not steal focus if not originally focused", async () => {
  const page = await ready(); page.nodes.language.focus(); await page.nodes.save.dispatch("click"); assert.equal(page.nodes.save.focusCalls, 0);
});

function requiredTag(html, id, attrs = []) {
  const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0]; assert.ok(tag, `${id} exists`);
  for (const attr of attrs) {
    const [name, value] = attr.split("=");
    assert.ok(value ? new RegExp(`\\b${name}="${value}"`).test(tag) : new RegExp(`\\s${name}(?:\\s|>|=)`).test(tag), `${id} ${attr}`);
  }
  return tag;
}
function contrast(hex) {
  const rgb = hex.match(/\w\w/g).map((part) => parseInt(part, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 1.05 / (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 + 0.05);
}
test("options.html disabled attributes, single live regions and sticky-bar CSS checks reject missing markup", () => {
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  for (const id of lockedControls) {
    const tag = requiredTag(html, id, ["disabled"]);
    assert.throws(() => requiredTag(html.replace(tag, tag.replace(/\sdisabled/, "")), id, ["disabled"]));
    assert.throws(() => requiredTag(html.replace(tag, ""), id));
  }
  for (const [id, attrs] of [["status", ["role=status", "aria-live=polite"]], ["connectionStatus", ["role=status", "aria-live=polite", "aria-atomic=true"]]]) {
    const tag = requiredTag(html, id, attrs); assert.ok(!tag.includes("data-i18n"));
    for (const attr of attrs) assert.throws(() => requiredTag(html.replace(tag, tag.replace(` ${attr.split("=")[0]}="${attr.split("=")[1]}"`, "")), id, attrs));
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
  }
  assert.match(html, /<div id="saveBar">\s*<button id="save"[^>]*>[\s\S]*?<span id="status"[^>]*>[\s\S]*?<\/div>/);
  const bar = html.match(/#saveBar \{([^}]+)\}/)[1];
  for (const rule of [/position: sticky/, /bottom: 0/, /background: #fff/, /border-top:/, /padding:/, /display: flex/, /flex-wrap: wrap/, /gap:/]) assert.match(bar, rule);
  assert.doesNotMatch(bar, /(?:^|;)\s*(?:width|height):/);
  assert.match(html, /scroll-padding-bottom: calc\(var\(--save-bar-height\) \+ 12px\)/);
  assert.match(html, /@media \(max-height: 360px\)\s*\{\s*#saveBar \{ position: static; \}\s*html \{ scroll-padding-bottom: 0; \}/);
  for (const hex of ["167343", "b42318", "333333"]) assert.ok(contrast(hex) >= 4.5, hex);
  assert.match(html, /#status \{ color: #333;/); for (const hex of ["167343", "b42318"]) assert.ok(html.includes(`#${hex}`));
  assert.doesNotMatch(html, /#30a46c|outline\s*:\s*(?:none|0)/);
  assert.match(html, /id="reportLink"/); assert.match(html, /target="_blank" rel="noopener"/);
});
test("options.js sticky ResizeObserver measures actual bar height without settings side effects", async () => {
  const page = await ready(); assert.equal(page.document.documentElement.style.properties["--save-bar-height"], "64px");
  assert.equal(page.resizeObservers.length, 1); assert.equal(page.resizeObservers[0].node, page.nodes.saveBar);
  const before = [page.attempts.length, page.messages.length]; page.nodes.saveBar.height = 147; page.resizeObservers[0].callback();
  assert.equal(page.document.documentElement.style.properties["--save-bar-height"], "147px"); assert.deepEqual([page.attempts.length, page.messages.length], before);
});

test("options.js Test completing after Save unlock compares to the new baseline and stays single-call/read-only", async () => {
  const page = await ready(); await page.edit("key", "new-key");
  const testRun = page.nodes.testConnection.dispatch("click");
  await page.nodes.save.dispatch("click");
  feedback(page, "optSaved", "connectionTesting");
  assert.equal(page.nodes.save.disabled, false); assert.equal(page.nodes.testConnection.disabled, true);
  page.resolveReply({ ok: true, code: "success" }); await testRun;
  feedback(page, "optSaved", "connectionSuccess"); locked(page, false);
  assert.equal(page.attempts.length, 1); assert.equal(page.messages.length, 1);
});
test("options.js failure and refresh-warning dynamic statuses retranslate without losing independent state", async () => {
  let outcome = "write-failure", calls = 0;
  const page = await ready({ translate: (key, lang) => `${lang}:${key}`, applyStaticLabels: true,
    beforeWrite: () => { if (outcome === "write-failure") throw new Error(secrets[3]); },
    beforeI18n: () => { if (++calls > 1 && outcome === "refresh-warning") throw new Error(secrets[3]); } });
  await page.nodes.save.dispatch("click"); feedback(page, "en:optSaveFailed");
  page.i18n.lang = "zh_TW"; readState(page, "applyI18n()"); feedback(page, "zh_TW:optSaveFailed");
  outcome = "refresh-warning"; await page.nodes.save.dispatch("click"); feedback(page, "zh_TW:optSavedRefreshWarning");
  page.i18n.lang = "nan-Hanlo"; readState(page, "applyI18n()"); feedback(page, "nan-Hanlo:optSavedRefreshWarning");
  await page.edit("language", "Japanese"); feedback(page, "nan-Hanlo:optUnsaved");
  await page.edit("language", "English"); feedback(page, "nan-Hanlo:optSavedRefreshWarning");
});

function discardCheckpoint(page) {
  return {
    calls: { ...page.calls }, attempts: page.attempts.length, writes: page.writes.length,
    messages: page.messages.length, timers: page.timers.length, usage: page.nodes.usage.textContent,
    locale: page.i18n.lang, store: JSON.stringify(page.store),
    baseline: readState(page, "baseline"), committed: readState(page, "committed"),
    baselineJSON: readState(page, "JSON.stringify(baseline)"), committedJSON: readState(page, "JSON.stringify(committed)"),
    owner: readState(page, "baselineOwner"),
  };
}
function unchangedDiscardState(page, before) {
  assert.deepEqual(page.calls, before.calls, "Discard must not invoke storage or i18n");
  assert.equal(page.attempts.length, before.attempts); assert.equal(page.writes.length, before.writes);
  assert.equal(page.messages.length, before.messages); assert.equal(page.timers.length, before.timers);
  assert.equal(page.nodes.usage.textContent, before.usage); assert.equal(page.i18n.lang, before.locale);
  assert.equal(JSON.stringify(page.store), before.store);
  assert.equal(readState(page, "baseline"), before.baseline); assert.equal(readState(page, "committed"), before.committed);
  assert.equal(readState(page, "JSON.stringify(baseline)"), before.baselineJSON);
  assert.equal(readState(page, "JSON.stringify(committed)"), before.committedJSON);
  assert.equal(readState(page, "baselineOwner"), before.owner);
}
async function discard(page, status = "optDiscarded") {
  assert.equal(page.nodes.discard.disabled, false);
  const before = discardCheckpoint(page);
  await page.nodes.discard.dispatch("click");
  unchangedDiscardState(page, before);
  assert.equal(readState(page, "canonical(buildDraft()) === canonical(baseline)"), true);
  assert.equal(readState(page, "dirty"), false); assert.equal(unloadCount(page), 0);
  assert.equal(page.nodes.discard.disabled, true); assert.equal(page.nodes.save.disabled, false);
  assert.equal(readState(page, "draftProfiles !== baseline.profiles && draftProfiles[baselineOwner] !== baseline.profiles[baselineOwner]"), true);
  assert.equal(readState(page, "Object.isFrozen(baseline) && Object.isFrozen(baseline.profiles[baselineOwner]) && Object.isFrozen(committed.keys)"), true);
  feedback(page, status);
}

test("options.js clean synthetic Discard is a guarded no-op, including after manual reversion", async () => {
  const page = await ready();
  for (const afterRevert of [false, true]) {
    if (afterRevert) {
      await page.edit("language", "Japanese"); assert.equal(page.nodes.discard.disabled, false);
      await page.edit("language", "English");
    }
    const before = discardCheckpoint(page), generation = connectionGenerationOf(page);
    assert.equal(page.nodes.discard.disabled, true);
    await page.nodes.discard.dispatch("click"); unchangedDiscardState(page, before);
    feedback(page, ""); assert.equal(connectionGenerationOf(page), generation);
    assert.equal(readState(page, "discardedNotice"), false); assert.equal(unloadCount(page), 0);
  }
});
for (const [id, value] of Object.entries(dirtyEdits)) test(`options.js Discard restores ${id} without side effects`, async () => {
  const page = await ready(), original = page.nodes[id].value;
  if (id === "provider") await page.switchTo(value); else await page.edit(id, value);
  assert.equal(page.nodes.discard.disabled, false); await discard(page);
  assert.equal(page.nodes[id].value, original);
});
test("options.js Discard restores all hidden/active profiles and globals, including authoritative empty fields", async () => {
  const initial = initialSettings(); initial.profiles.gemini = { key: "", base: "", model: "" };
  const page = await ready({ initial });
  await page.edit("key", "active-draft"); await page.switchTo("gemini");
  for (const id of ["key", "base", "model"]) await page.edit(id, `hidden-${id}`);
  await page.switchTo("custom");
  for (const [id, value] of Object.entries(dirtyEdits).filter(([id]) => id !== "provider")) await page.edit(id, value);
  await discard(page);
  assert.deepEqual(plain(readState(page, "draftProfiles")), initial.profiles);
  for (const id of editableControls.filter((id) => id !== "provider")) assert.equal(page.nodes[id].value, String(initial[id]), id);
  assert.equal(page.nodes.provider.value, "openai");
  await page.switchTo("gemini"); for (const id of ["key", "base", "model"]) assert.equal(page.nodes[id].value, "");
  await page.switchTo("openai"); feedback(page, "");
  assert.deepEqual(plain(readState(page, "draftProfiles.unknown")), initial.profiles.unknown);
});
for (const cap of ["abc", -3, 0]) test(`options.js Discard restores normalized fields but leaves inherited usage untouched for initial cap ${cap}`, async () => {
  const page = await ready({ initial: initialSettings({ uiLang: "fr", language: " English ", customInstructions: " instructions ",
    previewDwellMs: 15.4, previewMinIntervalMs: -3, dailyCap: cap }) });
  const usage = page.nodes.usage.textContent;
  for (const [id, value] of [["uiLang", "zh_TW"], ["language", "Japanese"], ["customInstructions", "draft"],
    ["previewDwellMs", 900], ["previewMinIntervalMs", 1000], ["dailyCap", 25]]) await page.edit(id, value);
  await discard(page);
  assert.equal(page.nodes.uiLang.value, ""); assert.equal(page.nodes.language.value, "English");
  assert.equal(page.nodes.customInstructions.value, "instructions"); assert.equal(page.nodes.previewDwellMs.value, "15");
  assert.equal(page.nodes.previewMinIntervalMs.value, "1500"); assert.equal(page.nodes.dailyCap.value, cap === 0 ? "0" : "200");
  assert.equal(page.nodes.usage.textContent, usage);
  assert.match(usage, /usageNoCap$/); // inherited initial display, not a new normalized render
});
function removedSettings() {
  const initial = initialSettings({ provider: "removed-provider" });
  initial.profiles[initial.provider] = { key: "retained-key", base: "retained-base", model: "retained-model" };
  Object.assign(initial, initial.profiles[initial.provider]);
  return initial;
}
for (const saved of [false, true]) test(`options.js Discard keeps removed provider owner separate from empty select, saved=${saved}`, async () => {
  const initial = removedSettings(), page = await ready({ initial });
  if (saved) { await page.edit("key", "new-removed-key"); await page.nodes.save.dispatch("click"); }
  const owned = plain(readState(page, "baseline.profiles[baselineOwner]"));
  await page.edit("key", "draft-key"); await page.edit("language", "Japanese"); await discard(page);
  assert.equal(page.nodes.provider.value, ""); assert.equal(readState(page, "draftProvider"), initial.provider);
  assert.equal(readState(page, "baselineOwner"), initial.provider);
  assert.equal(readState(page, 'Object.hasOwn(draftProfiles, "")'), false);
  assert.deepEqual(plain(readState(page, "draftProfiles[baselineOwner]")), owned);
  await page.switchTo("openai"); await page.edit("key", "draft-openai"); await discard(page);
  assert.equal(page.nodes.provider.value, ""); assert.equal(page.nodes.key.value, owned.key);
  await succeedTest(page); feedback(page, "optDiscarded", "connectionSuccess"); // reminder uses owner, not rejected select
  await page.nodes.save.dispatch("click");
  assert.equal(page.store.provider, ""); for (const id of ["key", "base", "model"]) assert.equal(page.store[id], "");
  assert.deepEqual(page.store.profiles[initial.provider], owned); assert.equal(Object.hasOwn(page.store.profiles, ""), false);
  assert.equal(page.store.keys[""], "");
});
test("options.js successful Save advances baseline owner from removed provider using synchronous detached capture", async () => {
  const gate = deferred(), page = await ready({ initial: removedSettings(), beforeWrite: () => gate.promise });
  await page.switchTo("openai"); await page.edit("key", "new-owned-key");
  const run = page.nodes.save.dispatch("click");
  vm.runInContext('draftProvider = "removed-provider"', page.context); // after capture, cannot change Save ownership
  gate.resolve(); await run;
  assert.equal(readState(page, "baselineOwner"), "openai");
  await page.edit("language", "Japanese"); await discard(page);
  assert.equal(readState(page, "draftProvider"), "openai"); assert.equal(page.nodes.key.value, "new-owned-key");
});
test("options.js failed Save does not advance baseline owner and Discard clears failed-draft feedback", async () => {
  const page = await ready({ initial: removedSettings(), beforeWrite: () => { throw new Error("fixture"); } });
  await page.switchTo("gemini"); await page.edit("key", "draft"); await page.nodes.save.dispatch("click");
  feedback(page, "optSaveFailed"); assert.equal(readState(page, "baselineOwner"), "removed-provider");
  await discard(page); assert.equal(readState(page, "saveFailed"), false); assert.equal(page.nodes.key.value, "retained-key");
});
test("options.js Discard restores last successful Save rather than initial load, including cleared credentials and cap", async () => {
  const page = await ready(); await page.switchTo("gemini");
  for (const id of ["key", "base", "model"]) await page.edit(id, "");
  await page.edit("dailyCap", 25.4); await page.nodes.save.dispatch("click");
  const saved = plain(readState(page, "baseline"));
  await page.switchTo("openai"); await page.edit("key", "draft-key"); await page.edit("dailyCap", 999); await discard(page);
  assert.deepEqual(plain(readState(page, "buildDraft()")), saved);
  assert.equal(page.nodes.provider.value, "gemini"); assert.equal(page.nodes.dailyCap.value, "25");
  for (const id of ["key", "base", "model"]) assert.equal(page.nodes[id].value, "");
});
for (const stage of ["init", "apply", "usage"]) test(`options.js Discard preserves persisted ${stage} refresh warning and last-read cap/locale`, async () => {
  let calls = 0;
  const fail = () => { if (++calls > 1) throw new Error("fixture refresh error"); };
  const page = await ready(stage === "init" ? { beforeI18n: fail } : stage === "apply" ? { beforeApply: fail } : { beforeUsage: fail });
  const usage = page.nodes.usage.textContent;
  await page.edit("dailyCap", 25.4); await page.edit("uiLang", "zh_TW"); await page.nodes.save.dispatch("click");
  feedback(page, "optSavedRefreshWarning"); assert.equal(readState(page, "savedRefreshWarning"), true);
  const locale = page.i18n.lang;
  await page.edit("dailyCap", 999); await page.edit("uiLang", "nan-Hanlo"); await discard(page, "optSavedRefreshWarning");
  assert.equal(page.nodes.status.dataset.state, "error"); assert.equal(readState(page, "savedRefreshWarning"), true);
  assert.equal(page.nodes.dailyCap.value, "25"); assert.equal(page.nodes.uiLang.value, "zh_TW");
  assert.equal(page.nodes.usage.textContent, usage); assert.match(usage, / \/ 200$/); assert.equal(page.i18n.lang, locale);
});
for (const stage of ["write", "refresh"]) test(`options.js synthetic Discard during Save ${stage} is a no-op`, async () => {
  const gate = deferred(); let calls = 0;
  const page = await ready(stage === "write" ? { beforeWrite: () => gate.promise } : { beforeI18n: () => ++calls > 1 ? gate.promise : undefined });
  await page.edit("key", "saved-new"); const run = page.nodes.save.dispatch("click"); await page.flush();
  const before = discardCheckpoint(page), draft = readState(page, "canonical(buildDraft())"), generation = connectionGenerationOf(page);
  assert.equal(page.nodes.discard.disabled, true); await page.nodes.discard.dispatch("click"); unchangedDiscardState(page, before);
  assert.equal(readState(page, "canonical(buildDraft())"), draft); assert.equal(connectionGenerationOf(page), generation);
  feedback(page, "optSaving"); gate.resolve(); await run;
});
for (const tuple of ["unchanged", "changed", "return"]) for (const outcome of ["success", "error", "rejection"]) {
  test(`options.js pending Test ${tuple} Discard invalidates late ${outcome} without canceling busy state`, async () => {
    const page = await ready();
    if (tuple === "changed") await page.edit("key", "tested-draft");
    const run = page.nodes.testConnection.dispatch("click");
    if (tuple === "return") { await page.edit("key", "temporary"); await page.edit("key", secrets[0]); }
    await page.edit("language", "Japanese"); assert.equal(page.nodes.discard.disabled, false);
    const generation = connectionGenerationOf(page); await discard(page);
    assert.equal(connectionGenerationOf(page), generation + 1);
    assert.equal(readState(page, "testingConnection"), true); assert.equal(page.nodes.testConnection.disabled, true);
    feedback(page, "optDiscarded", "");
    await page.nodes.testConnection.dispatch("click"); assert.equal(page.messages.length, 1);
    if (outcome === "rejection") page.pending[0].reject(new Error(secrets[3]));
    else page.resolveReply(outcome === "success" ? { ok: true, code: "success" } : { ok: false, code: "auth" });
    await run; feedback(page, "optDiscarded", ""); assert.equal(page.nodes.testConnection.disabled, false);
    assert.equal(connectionGenerationOf(page), generation + 1); assert.equal(readState(page, "testedTuple"), null);
  });
}
for (const code of ["success", "auth"]) test(`options.js settled unchanged-tuple ${code} survives language-only Discard`, async () => {
  const page = await ready(), run = page.nodes.testConnection.dispatch("click");
  page.resolveReply({ ok: code === "success", code }); await run;
  const generation = connectionGenerationOf(page); await page.edit("language", "Japanese"); await discard(page);
  feedback(page, "optDiscarded", code === "success" ? "connectionSuccess" : "connectionAuth");
  assert.equal(connectionGenerationOf(page), generation);
});
for (const id of ["provider", "key", "base", "model"]) test(`options.js settled unsaved ${id} Discard clears result/reminder`, async () => {
  const page = await ready(); if (id === "provider") await page.switchTo("gemini"); else await page.edit(id, dirtyEdits[id]);
  await succeedTest(page); feedback(page, "optUnsaved", "connectionSuccess connectionSaveReminder");
  const generation = connectionGenerationOf(page); await discard(page);
  feedback(page, "optDiscarded", ""); assert.equal(connectionGenerationOf(page), generation + 1);
  assert.equal(readState(page, "testedTuple"), null);
});
test("options.js hidden-profile-only Discard preserves valid settled active result", async () => {
  const page = await ready(); await page.switchTo("gemini"); await page.edit("key", "hidden-draft"); await page.switchTo("openai");
  await succeedTest(page); const generation = connectionGenerationOf(page); await discard(page);
  feedback(page, "optDiscarded", "connectionSuccess"); assert.equal(connectionGenerationOf(page), generation);
});
for (const action of ["input", "change", "provider-input", "provider-change", "save", "test"]) {
  test(`options.js Discard notice ${action === "test" ? "survives" : "clears on"} ${action} and canceled flash cannot erase it`, async () => {
    const page = await ready(); await page.nodes.save.dispatch("click"); await page.edit("language", "Japanese"); await discard(page);
    assert.equal(page.nodes.status.dataset.state, "neutral"); assert.equal(page.timers[0].cancelled, true);
    page.fireTimer(0, true); feedback(page, "optDiscarded");
    if (["input", "change"].includes(action)) await page.nodes.language.dispatch(action);
    if (action.startsWith("provider-")) await page.nodes.provider.dispatch(action.slice("provider-".length));
    if (action === "save") await page.nodes.save.dispatch("click");
    if (action === "test") await succeedTest(page);
    assert.equal(readState(page, "discardedNotice"), action === "test");
    feedback(page, action === "test" ? "optDiscarded" : action === "save" ? "optSaved" : "");
  });
}
for (const focused of ["discard", "language", "reportLink", "body"]) test(`options.js Discard conditionally transfers focus only from ${focused}`, async () => {
  const page = await ready(); await page.edit("language", "Japanese");
  if (focused !== "body") page.nodes[focused].focus();
  const active = page.document.activeElement; await discard(page);
  assert.equal(page.document.activeElement, focused === "discard" ? page.nodes.save : active);
  assert.equal(page.nodes.save.focusCalls, focused === "discard" ? 1 : 0);
});
test("options.html Discard is secondary, statically disabled, described outside sticky bar and ordered after Save", () => {
  const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
  requiredTag(html, "discard", ["type=button", "disabled", "data-i18n=optDiscard", "aria-describedby=discardHint"]);
  requiredTag(html, "discardHint", ["class=hint", "data-i18n=optDiscardHint"]);
  assert.match(html, /<p class="hint" id="discardHint"[^>]*>[^<]+<\/p>\s*<div id="saveBar">/);
  assert.match(html, /<div id="saveBar">\s*<button id="save"[^>]*>[^<]+<\/button>\s*<button id="discard"[^>]*>[^<]+<\/button>\s*<span id="status"/);
  assert.match(html, /#discard \{ background: #fff; color: #333; border: 1px solid #777; \}/);
  assert.match(html, /#discard:disabled \{ cursor: default; \}/);
  assert.ok(contrast("333333") >= 4.5); assert.doesNotMatch(html, /outline\s*:\s*(?:none|0)/);
});

test("options.js synchronous initial locale apply failure keeps synthetic Discard fail-closed", async () => {
  const page = createPage({ initial: initialSettings(), beforeApply: () => { throw new Error("fixture"); } });
  await page.flush(); const before = discardCheckpoint(page), generation = connectionGenerationOf(page);
  locked(page, true); await page.nodes.discard.dispatch("click"); unchangedDiscardState(page, before);
  feedback(page, "optLoadFailed"); assert.equal(connectionGenerationOf(page), generation);
  assert.equal(readState(page, "baseline"), null); assert.equal(readState(page, "baselineOwner"), null); assert.equal(unloadCount(page), 0);
});
test("options.js Discard explicitly rejects a settled testedTuple mismatching the restored active connection", async () => {
  const page = await ready(); await succeedTest(page); await page.edit("language", "Japanese");
  vm.runInContext('testedTuple.key = "obsolete-key"', page.context);
  const generation = connectionGenerationOf(page); await discard(page); feedback(page, "optDiscarded", "");
  assert.equal(connectionGenerationOf(page), generation + 1);
});

for (const id of ["provider", "key", "base", "model"]) test(`options.js settled unsaved ${id} error is cleared by Discard`, async () => {
  const page = await ready(); if (id === "provider") await page.switchTo("gemini"); else await page.edit(id, dirtyEdits[id]);
  const run = page.nodes.testConnection.dispatch("click"); page.resolveReply({ ok: false, code: "auth" }); await run;
  feedback(page, "optUnsaved", "connectionAuth"); const generation = connectionGenerationOf(page);
  await discard(page); feedback(page, "optDiscarded", ""); assert.equal(connectionGenerationOf(page), generation + 1);
});
test("options.js canceled saved-flash callback cannot erase Discard, newer dirty feedback or preserved warning", async () => {
  let failRefresh = false;
  const page = await ready({ beforeI18n: () => { if (failRefresh) throw new Error("fixture"); } });
  await page.nodes.save.dispatch("click"); await page.edit("language", "Japanese"); await discard(page);
  page.fireTimer(0, true); feedback(page, "optDiscarded");
  await page.edit("language", "Spanish"); page.fireTimer(0, true); feedback(page, "optUnsaved");
  failRefresh = true; await page.nodes.save.dispatch("click"); await page.edit("language", "French");
  await discard(page, "optSavedRefreshWarning"); page.fireTimer(0, true); feedback(page, "optSavedRefreshWarning");
  assert.equal(readState(page, "savedRefreshWarning"), true); assert.equal(page.nodes.status.dataset.state, "error");
});

test("options.js Discard on migrated legacy settings restores page baseline without repeating migration or deleting keys", async () => {
  const page = await ready({ initial: { provider: "openai", key: "legacy-key", keys: { gemini: "legacy-hidden" } } });
  assert.equal(page.writes.length, 1); assert.equal(page.nodes.discard.disabled, true);
  await page.edit("key", "draft-key"); await page.switchTo("gemini"); await page.edit("key", ""); await discard(page);
  assert.equal(page.nodes.provider.value, "openai"); assert.equal(page.nodes.key.value, "legacy-key");
  assert.deepEqual(page.store.keys, { gemini: "legacy-hidden" });
  await page.switchTo("gemini"); assert.equal(page.nodes.key.value, "legacy-hidden"); assert.equal(page.writes.length, 1);
});
