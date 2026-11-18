import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createPage, deferred, editableControls } from "./helpers/options-page.js";

const html = readFileSync(new URL("../extension/options.html", import.meta.url), "utf8");
const providers = ["openai", "anthropic", "gemini", "groq", "openrouter", "deepseek", "xai", "mistral", "together", "nvidia", "ollama", "custom"];
const profileFields = ["key", "base", "model"];
const state = (page, expression) => vm.runInContext(expression, page.context);
const plain = (value) => JSON.parse(JSON.stringify(value));
function initial(overrides = {}) {
  const profiles = Object.fromEntries(providers.map((id) => [id, { key: "", base: "", model: "" }]));
  profiles.openai = { key: "SECRET_ACTIVE", base: "https://SECRET_URL.example/v1", model: "SECRET_MODEL" };
  profiles.gemini = { key: "SECRET_DORMANT", base: "https://DORMANT_URL.example", model: "DORMANT_MODEL" };
  profiles.SECRET_UNKNOWN_ID = { key: " SECRET_UNKNOWN_KEY ", base: 123, model: null };
  return { provider: "openai", ...profiles.openai, profiles, keys: { openai: "legacy", gemini: "legacy-dormant" },
    language: "English", customInstructions: "SECRET_INSTRUCTIONS", uiLang: "", previewDwellMs: 500,
    previewMinIntervalMs: 1500, dailyCap: 200, ...overrides };
}
async function ready(options = {}) {
  const page = createPage({ initial: initial(), ...options });
  await page.flush(); assert.equal(page.nodes.save.disabled, false);
  markers(page); membership(page);
  return page;
}
const tokens = (node) => (node.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
function markers(page, visible = [], note = false, settled = true) {
  for (const id of editableControls) {
    const modified = visible.includes(id), marker = page.nodes[`${id}Modified`], control = page.nodes[id];
    assert.equal(marker.hidden, !modified, `${id} visibility`);
    assert.equal(control.dataset.modified, modified ? "true" : undefined, `${id} border attribute`);
    assert.equal(marker.getAttribute("aria-hidden"), "true", `${id} excluded from name`);
    assert.equal(tokens(control).filter((token) => token === `${id}Modified`).length, modified ? 1 : 0, `${id} description`);
  }
  assert.equal(page.nodes.otherProvidersModified.hidden, !note, "other-provider note");
  assert.equal(tokens(page.nodes.provider).filter((token) => token === "otherProvidersModified").length, note ? 1 : 0);
  if (settled && state(page, "settingsReady && !!baseline")) {
    assert.equal(state(page, "dirty"), !!(visible.length || note), "settled dirty/marker equivalence");
    assert.equal(state(page, "dirty"), state(page, "canonical(buildDraft()) !== canonical(baseline)"));
  }
}
function membership(page) {
  assert.equal(state(page, `Object.hasOwn(baseline.profiles, baselineOwner) && ${JSON.stringify(providers)}.every((id) => Object.hasOwn(baseline.profiles, id))`), true);
}
function effects(page) { return { ...page.calls, messages: page.messages.length }; }
function noEffects(page, before, applies = 0) {
  assert.deepEqual(effects(page), { ...before, i18nApply: before.i18nApply + applies });
}
function safeFeedback(page) {
  const secrets = ["SECRET_ACTIVE", "SECRET_URL", "SECRET_MODEL", "SECRET_DORMANT", "DORMANT_URL", "DORMANT_MODEL", "SECRET_UNKNOWN_ID", "SECRET_UNKNOWN_KEY", "SECRET_INSTRUCTIONS", "SECRET_ERROR"];
  const feedbackNodes = [...editableControls.map((id) => page.nodes[`${id}Modified`]), page.nodes.otherProvidersModified];
  for (const secret of secrets) {
    for (const node of feedbackNodes) assert.ok(!node.textContent.includes(secret));
    for (const id of editableControls) assert.ok(!String(page.nodes[id].getAttribute("aria-describedby")).includes(secret));
    assert.ok(!page.consoleOutput.join(" ").includes(secret));
  }
  assert.deepEqual(page.consoleOutput, []);
}

for (const stage of ["beforeRead", "beforeWrite", "beforeI18n", "beforeApply", "beforeUsage"]) {
  for (const reject of [false, true]) test(`options.js markers off during ${stage} ${reject ? "failure" : "load"}`, async () => {
    const gate = deferred(); let allowApply = false;
    const page = createPage(stage === "beforeApply" ? { beforeApply: () => { if (reject && !allowApply) throw new Error("SECRET_ERROR"); } } : { [stage]: () => gate.promise });
    await page.flush(); markers(page);
    if (stage !== "beforeApply") {
      assert.equal(page.nodes.save.disabled, true);
      state(page, "renderFieldMarkers(); recomputeDirty(); applyI18n()"); markers(page);
      if (reject) gate.reject(new Error("SECRET_ERROR")); else gate.resolve();
      await page.flush(); markers(page);
    }
    assert.equal(page.nodes.save.disabled, reject);
    if (reject) {
      assert.equal(page.nodes.status.textContent, "optLoadFailed");
      // Catch must clear stale owned state without trying to build an unready draft.
      page.nodes.key.dataset.modified = "true"; page.nodes.keyModified.hidden = false;
      page.nodes.key.setAttribute("aria-describedby", "hint keyModified keyModified");
      page.nodes.provider.setAttribute("aria-describedby", "hint providerModified otherProvidersModified");
      page.nodes.otherProvidersModified.hidden = false;
      allowApply = true; state(page, "applyI18n(); recomputeDirty()"); markers(page);
      assert.equal(page.nodes.key.getAttribute("aria-describedby"), "hint");
      assert.equal(page.nodes.provider.getAttribute("aria-describedby"), "hint");
    } else membership(page);
    safeFeedback(page);
  });
}

const edits = { uiLang: "zh_TW", provider: "gemini", key: "changed-key", base: "https://changed.example", model: "changed-model",
  language: "Japanese", customInstructions: "changed instructions", previewDwellMs: "501", previewMinIntervalMs: "1501", dailyCap: "201" };
for (const [id, value] of Object.entries(edits)) test(`options.js ${id} marker exact attribution, repeat, revert and Discard`, async () => {
  const page = await ready(), before = effects(page), original = page.nodes[id].value;
  const edit = (next) => id === "provider" ? page.switchTo(next) : page.edit(id, next);
  await edit(value); markers(page, [id]);
  await page.nodes[id].dispatch("change"); markers(page, [id]);
  await edit(original); markers(page);
  await edit(value); markers(page, [id]);
  page.nodes.discard.focus(); await page.nodes.discard.dispatch("click"); markers(page);
  assert.equal(page.document.activeElement, page.nodes.save); assert.equal(page.nodes[id].value, original);
  noEffects(page, before); safeFeedback(page);
});

for (const id of ["key", "base", "model", "language", "customInstructions"]) test(`options.js ${id} trim equivalence uses Save normalization without changing raw text`, async () => {
  const page = await ready(), original = page.nodes[id].value;
  page.nodes[id].focus(); await page.edit(id, `  ${original}  `); markers(page);
  assert.equal(page.nodes[id].value, `  ${original}  `); assert.equal(page.document.activeElement, page.nodes[id]);
  await page.edit(id, `${original} internal change`); markers(page, [id]);
});
test("options.js numeric markers match rounded/default projection, including canonical -0 equality", async () => {
  const page = await ready();
  for (const [id, value] of [["previewDwellMs", "500.49"], ["previewMinIntervalMs", "1500.49"], ["previewMinIntervalMs", ""],
    ["dailyCap", ""], ["dailyCap", "invalid"], ["dailyCap", "Infinity"], ["dailyCap", "-3"], ["dailyCap", " 200 "]]) {
    await page.edit(id, value); markers(page);
  }
  await page.edit("dailyCap", "-0.4"); markers(page, ["dailyCap"]);
  const zero = await ready({ initial: initial({ dailyCap: 0 }) });
  await zero.edit("dailyCap", "-0.4"); markers(zero);
  assert.equal(state(zero, "Object.is(buildDraft().dailyCap, -0)"), true);
  await zero.edit("dailyCap", "0.51"); markers(zero, ["dailyCap"]);
});

test("options.js completed provider transaction uses current-owner profile; input gap stays unchanged", async () => {
  const page = await ready(), before = effects(page);
  page.nodes.provider.value = "gemini"; await page.nodes.provider.dispatch("input");
  markers(page, [], false, false); assert.equal(page.nodes.key.value, "SECRET_ACTIVE");
  await page.nodes.provider.dispatch("change"); markers(page, ["provider"]);
  assert.equal(page.nodes.key.value, "SECRET_DORMANT");
  await page.edit("key", ""); markers(page, ["provider", "key"]);
  await page.edit("base", "changed"); markers(page, ["provider", "key", "base"]);
  await page.edit("model", "changed"); markers(page, ["provider", "key", "base", "model"]);
  await page.switchTo("openai"); markers(page, [], true);
  assert.equal(page.nodes.provider.dataset.modified, undefined, "note alone does not color provider");
  await page.switchTo("custom"); markers(page, ["provider"], true);
  await page.switchTo("gemini"); markers(page, ["provider", "key", "base", "model"], false);
  for (const id of profileFields) await page.edit(id, initial().profiles.gemini[id]);
  markers(page, ["provider"]); await page.switchTo("openai"); markers(page);
  await page.switchTo("ollama"); markers(page, ["provider"]); await page.switchTo("openai"); markers(page);
  noEffects(page, before); safeFeedback(page);
});

for (const existing of [false, true]) test(`options.js unknown owner, stored profile=${existing}, stays separate from empty select`, async () => {
  const settings = initial({ provider: "SECRET_UNKNOWN_ID" });
  if (!existing) delete settings.profiles.SECRET_UNKNOWN_ID;
  else settings.profiles.SECRET_UNKNOWN_ID = { key: "SECRET_UNKNOWN_KEY", base: "https://SECRET_URL.example", model: "SECRET_MODEL" };
  const page = await ready({ initial: settings }), before = effects(page);
  assert.equal(page.nodes.provider.value, ""); assert.equal(state(page, "draftProvider"), "SECRET_UNKNOWN_ID");
  await page.edit("key", "edited unknown"); markers(page, ["key"]);
  await page.switchTo("openai"); markers(page, ["provider"], true);
  page.nodes.discard.focus(); await page.nodes.discard.dispatch("click"); markers(page);
  assert.equal(page.nodes.provider.value, ""); assert.equal(state(page, "draftProvider"), "SECRET_UNKNOWN_ID");
  noEffects(page, before);
  await page.edit("key", "edited unknown"); await page.nodes.save.dispatch("click"); markers(page); membership(page);
  assert.equal(page.store.profiles.SECRET_UNKNOWN_ID.key, "edited unknown"); assert.equal(page.store.key, "");
  assert.equal(page.store.keys[""], ""); safeFeedback(page);
});

test("options.js dormant normalization/order/membership use canonical semantics and renderer is pure", async () => {
  const page = await ready(), before = effects(page);
  const baseline = state(page, "baseline"), originalBaseline = state(page, "JSON.stringify(baseline)");
  state(page, 'draftProfiles = Object.fromEntries(Object.entries(draftProfiles).reverse()); draftProfiles.SECRET_UNKNOWN_ID = { key: "  SECRET_UNKNOWN_KEY ", base: false, model: 456 }');
  const raw = state(page, "JSON.stringify(draftProfiles)"); state(page, "recomputeDirty(); renderFieldMarkers()"); markers(page);
  assert.equal(state(page, "JSON.stringify(draftProfiles)"), raw);
  state(page, 'draftProfiles.extra = { key: "", base: "", model: "" }; recomputeDirty()'); markers(page, [], true);
  state(page, 'delete draftProfiles.extra; recomputeDirty()'); markers(page);
  state(page, 'delete draftProfiles.SECRET_UNKNOWN_ID; recomputeDirty()'); markers(page, [], true);
  state(page, 'draftProfiles.SECRET_UNKNOWN_ID = structuredClone(baseline.profiles.SECRET_UNKNOWN_ID); recomputeDirty()'); markers(page);
  // A dormant authoritative-empty profile is significant even with equal values.
  state(page, 'delete draftProfiles.custom; recomputeDirty()'); markers(page, [], true);
  state(page, 'draftProfiles.custom = { key: "", base: "", model: "" }; recomputeDirty()'); markers(page);
  assert.equal(state(page, "baseline"), baseline); assert.equal(state(page, "JSON.stringify(baseline)"), originalBaseline);
  noEffects(page, before);
});
test("options.js missing-current-owner synthetic baseline only promises empty fallback/no throw", async () => {
  const page = await ready();
  state(page, 'baseline = frozenCopy({ ...baseline, profiles: Object.fromEntries(Object.entries(baseline.profiles).filter(([id]) => id !== draftProvider)) })');
  for (const id of profileFields) page.nodes[id].value = "";
  assert.doesNotThrow(() => state(page, "renderFieldMarkers()"));
  markers(page, [], false, false); // Intentionally invalid membership, not a native dirty checkpoint.
});

for (const fail of [false, true]) test(`options.js pending Save keeps markers; write failure=${fail}, retry and focus`, async () => {
  const gate = deferred(); let reject = fail;
  const page = await ready({ beforeWrite: async () => { await gate.promise; if (reject) throw new Error("SECRET_ERROR"); } });
  await page.switchTo("gemini"); await page.edit("key", ""); await page.switchTo("openai"); await page.edit("language", "Japanese");
  markers(page, ["language"], true); page.nodes.save.focus();
  const baseline = state(page, "baseline"), run = page.nodes.save.dispatch("click"); markers(page, ["language"], true);
  assert.equal(page.nodes.status.textContent, "optSaving"); assert.equal(page.document.activeElement, page.document.body);
  assert.equal(page.calls.syncSet, 1); await page.nodes.save.dispatch("click"); assert.equal(page.calls.syncSet, 1);
  state(page, "applyI18n()"); markers(page, ["language"], true);
  gate.resolve(); await run;
  if (fail) {
    markers(page, ["language"], true); assert.equal(state(page, "baseline"), baseline);
    assert.equal(page.nodes.status.textContent, "optSaveFailed"); reject = false;
    await page.nodes.save.dispatch("click");
  }
  markers(page); membership(page); assert.equal(page.document.activeElement, page.nodes.save);
  assert.equal(page.store.profiles.gemini.key, ""); assert.equal(page.store.keys.gemini, "legacy-dormant");
  assert.equal(page.calls.syncSet, fail ? 2 : 1); assert.equal(page.calls.i18nInit, 2); assert.equal(page.calls.localGet, 2);
  assert.equal(page.messages.length, 0); safeFeedback(page);
});

for (const stage of ["init", "apply", "usage"]) test(`options.js baseline clears markers before secondary ${stage} refresh fails`, async () => {
  const gate = deferred(); let calls = 0;
  const options = stage === "init" ? { beforeI18n: () => ++calls > 1 ? gate.promise : undefined }
    : stage === "apply" ? { beforeApply: () => { if (++calls > 1) throw new Error("SECRET_ERROR"); } }
    : { beforeUsage: () => ++calls > 1 ? gate.promise : undefined };
  const page = await ready(options); await page.edit("key", "new key"); markers(page, ["key"]);
  const run = page.nodes.save.dispatch("click"); await page.flush(); markers(page); membership(page);
  if (stage !== "apply") { assert.equal(page.nodes.status.textContent, "optSaving"); gate.reject(new Error("SECRET_ERROR")); }
  await run; markers(page); assert.equal(page.nodes.status.textContent, "optSavedRefreshWarning");
  await page.edit("language", "Japanese"); markers(page, ["language"]);
  await page.nodes.discard.dispatch("click"); markers(page); safeFeedback(page);
});
test("options.js Save snapshot commit does not force-clear post-capture live edits", async () => {
  const gate = deferred(), refresh = deferred(); let inits = 0;
  const page = await ready({ beforeWrite: () => gate.promise, beforeI18n: () => ++inits > 1 ? refresh.promise : undefined });
  await page.edit("key", "captured key"); const run = page.nodes.save.dispatch("click"); markers(page, ["key"]);
  page.nodes.language.value = "synthetic live";
  gate.resolve(); await page.flush(); markers(page, ["language"]);
  assert.equal(page.nodes.status.textContent, "optSaving");
  state(page, "applyI18n()"); markers(page, ["language"]);
  refresh.resolve(); await run; markers(page, ["language"]);
  assert.equal(page.store.language, "English"); assert.equal(page.store.key, "captured key");
  await page.edit("language", "English"); markers(page);
});

test("options.js optional missing badge/note markup cannot reject Save finally", async () => {
  const page = await ready();
  for (const id of editableControls) delete page.nodes[`${id}Modified`];
  delete page.nodes.otherProvidersModified;
  await page.edit("key", "changed"); await assert.doesNotReject(page.nodes.save.dispatch("click"));
  assert.equal(state(page, "dirty"), false); assert.equal(page.nodes.save.disabled, false);
});

test("options.js descriptions append/remove only owned IDs, retain hints, and never accumulate", async () => {
  const page = await ready();
  page.nodes.provider.setAttribute("aria-describedby", "first\tsecond");
  page.nodes.key.setAttribute("aria-describedby", "keyHint  extraHint");
  page.nodes.language.setAttribute("aria-describedby", "");
  for (let repeat = 0; repeat < 3; repeat++) {
    await page.edit("key", "changed"); markers(page, ["key"]);
    assert.equal(page.nodes.key.getAttribute("aria-describedby"), "keyHint extraHint keyModified");
    await page.switchTo("gemini"); markers(page, ["provider"], true);
    assert.equal(page.nodes.provider.getAttribute("aria-describedby"), "first second providerModified otherProvidersModified");
    page.nodes.provider.setAttribute("aria-describedby", "first providerModified providerModified second otherProvidersModified otherProvidersModified");
    state(page, "renderFieldMarkers(); applyI18n(); applyI18n()"); markers(page, ["provider"], true);
    assert.equal(page.nodes.provider.getAttribute("aria-describedby"), "first second providerModified otherProvidersModified");
    await page.nodes.discard.dispatch("click"); markers(page);
    assert.equal(page.nodes.provider.getAttribute("aria-describedby"), "first second");
    assert.equal(page.nodes.key.getAttribute("aria-describedby"), "keyHint extraHint");
    assert.equal(page.nodes.language.getAttribute("aria-describedby"), null);
  }
  await page.edit("language", "Japanese"); assert.equal(page.nodes.language.getAttribute("aria-describedby"), "languageModified");
  await page.nodes.save.dispatch("click"); markers(page);
  assert.equal(page.nodes.language.getAttribute("aria-describedby"), null);
});

function assertConnected(page, identities) {
  for (const [id, node] of Object.entries(identities)) assert.equal(page.document.getElementById(id), node, `${id} connected identity survives actual textContent localization`);
}
for (const lang of ["en", "zh_TW", "nan-Hanlo"]) test(`options.js actual ${lang} runtime preserves connected label markers and generic note`, async () => {
  const gate = deferred(), page = await ready({ realI18n: true, initial: initial({ uiLang: lang }), beforeWrite: () => gate.promise });
  const identities = Object.fromEntries([...editableControls.map((id) => `${id}Modified`), "otherProvidersModified"].map((id) => [id, page.nodes[id]]));
  const table = plain(page.context.DebaitMessages[lang]);
  async function relocalize(visible = [], note = false) {
    const before = effects(page);
    for (let repeat = 0; repeat < 3; repeat++) { state(page, "applyI18n()"); markers(page, visible, note); assertConnected(page, identities); }
    noEffects(page, before, 3);
    for (const id of editableControls) assert.equal(page.nodes[`${id}Modified`].textContent, table.optFieldModified.message);
    assert.equal(page.nodes.otherProvidersModified.textContent, table.optOtherProvidersModified.message);
    for (const [id, key] of [["provider", "optProvider"], ["key", "optKey"], ["previewMinIntervalMs", "optInterval"]]) {
      const label = page.nodes[`${id}Modified`].parentElement;
      assert.equal(label.children.find((node) => node.dataset?.i18n === key).textContent, table[key].message);
    }
    safeFeedback(page);
  }
  await relocalize(); await page.edit("key", "changed"); await page.switchTo("gemini");
  await relocalize(["provider"], true);
  page.nodes.provider.focus(); const focused = page.document.activeElement;
  await relocalize(["provider"], true); assert.equal(page.document.activeElement, focused);
  const run = page.nodes.save.dispatch("click"); await relocalize(["provider"], true);
  assert.equal(page.nodes.save.textContent, table.optSaving.message);
  gate.resolve(); await run; markers(page); membership(page); await relocalize();
  await page.edit("key", ""); await relocalize(["key"]);
  await page.nodes.discard.dispatch("click"); await relocalize();
});
test("options.js real runtime uses English fallback for missing localized marker/note entries", async () => {
  const page = await ready({ realI18n: true, initial: initial({ uiLang: "zh_TW" }) });
  state(page, "delete DebaitMessages.zh_TW.optFieldModified; delete DebaitMessages.zh_TW.optOtherProvidersModified");
  await page.edit("key", "changed"); await page.switchTo("gemini"); state(page, "applyI18n()");
  markers(page, ["provider"], true);
  assert.equal(page.nodes.providerModified.textContent, "Modified");
  assert.equal(page.nodes.otherProvidersModified.textContent, "Other provider settings also have unsaved changes.");
});
for (const reject of [false, true]) test(`options.js connected real i18n before readiness and failed initialization=${reject}`, async () => {
  const gate = deferred(), page = createPage({ realI18n: true, beforeUsage: () => gate.promise });
  await page.flush(); const marker = page.nodes.keyModified;
  state(page, "applyI18n(); applyI18n()"); markers(page); assertConnected(page, { keyModified: marker });
  if (reject) gate.reject(new Error("SECRET_ERROR")); else gate.resolve();
  await page.flush(); state(page, "applyI18n(); applyI18n()"); markers(page); assertConnected(page, { keyModified: marker });
  assert.equal(page.nodes.save.disabled, reject);
});
test("options DOM seam detects destruction of a marker incorrectly inside a translated ancestor", async () => {
  const badHtml = html.replace('<label for="provider"><span data-i18n="optProvider">Provider</span>', '<label for="provider" data-i18n="optProvider"><span>Provider</span>');
  const page = createPage({ realI18n: true, htmlSource: badHtml });
  const node = page.nodes.providerModified; await page.flush();
  assert.throws(() => assertConnected(page, { providerModified: node }), /connected identity/);
  assert.equal(page.document.getElementById("providerModified"), undefined);
  await assert.doesNotReject(page.nodes.save.dispatch("click"));
});

test("options.js marker-only rendering and actual localization add no I/O; explicit Test adds only its message", async () => {
  const page = await ready({ realI18n: true }), before = effects(page);
  for (const id of ["key", "base", "model", "language", "customInstructions"]) {
    const value = page.nodes[id].value; await page.edit(id, "temporary"); await page.edit(id, value);
  }
  await page.switchTo("gemini"); await page.edit("key", ""); await page.switchTo("openai");
  state(page, "renderFieldMarkers(); recomputeDirty(); applyI18n()"); markers(page, [], true);
  await page.nodes.discard.dispatch("click"); markers(page); noEffects(page, before, 1);
  const testRun = page.nodes.testConnection.dispatch("click");
  page.resolveReply({ ok: true, code: "success" }); await testRun;
  assert.deepEqual(effects(page), { ...before, i18nApply: before.i18nApply + 1, messages: before.messages + 1 });
  assert.equal(page.messages[0].type, "debait:testConnection"); safeFeedback(page);
});

function assertStructure(page) {
  const elements = page.document.elements();
  for (const id of editableControls) {
    const matches = elements.filter((node) => node.getAttribute("id") === `${id}Modified`);
    assert.equal(matches.length, 1, `${id} exactly one marker`);
    const marker = matches[0], label = marker.parentElement;
    assert.equal(marker.tagName, "span"); assert.equal(label.tagName, "label"); assert.equal(label.getAttribute("for"), id);
    assert.equal(marker.getAttribute("class"), "field-modified");
    assert.equal(marker.getAttribute("aria-hidden"), "true"); assert.equal(marker.dataset.i18n, "optFieldModified");
    assert.equal(marker.hidden, true);
    for (let ancestor = label; ancestor; ancestor = ancestor.parentElement) assert.equal(ancestor.hasAttribute?.("data-i18n") || false, false);
    const children = label.children.filter((node) => node.tagName);
    assert.equal(children[1], marker, `${id} marker immediately follows primary translation`);
    assert.ok(children[0].dataset.i18n);
  }
  const provider = page.nodes.provider, note = page.nodes.otherProvidersModified;
  const siblings = provider.parentElement.children.filter((node) => node.tagName);
  assert.equal(siblings[siblings.indexOf(provider) + 1], note);
  assert.equal(siblings[siblings.indexOf(note) + 1].dataset.i18n, "customGuidance");
  assert.equal(note.tagName, "p"); assert.equal(note.getAttribute("class"), "hint field-modified-note");
  assert.equal(note.textContent, "Other provider settings also have unsaved changes."); assert.equal(note.hidden, true);
  for (const node of elements) {
    const description = tokens(node);
    assert.ok(!description.some((token) => editableControls.some((id) => token === `${id}Modified`) || token === "otherProvidersModified"));
  }
  for (const node of [...editableControls.map((id) => page.nodes[`${id}Modified`]), note]) {
    for (const attr of ["role", "aria-live", "aria-invalid"]) assert.equal(node.getAttribute(attr), null);
  }
  assert.equal(elements.filter((node) => node.getAttribute("aria-live")).length, 2, "existing global live regions only");
}
test("options.html parsed marker structure is persistent, localized and non-live; bad nesting fails", async () => {
  const gate = deferred(), page = createPage({ connectedDOM: true, beforeRead: () => gate.promise });
  assertStructure(page);
  for (const [id, key, text] of [["provider", "optProvider", "Provider"], ["key", "optKey", "API key"], ["previewMinIntervalMs", "optInterval", "Min interval between previews (ms)"]]) {
    const primary = page.nodes[`${id}Modified`].parentElement.children.find((node) => node.dataset?.i18n === key);
    assert.equal(primary.textContent, text);
  }
  const bad = createPage({ connectedDOM: true, beforeRead: () => gate.promise, htmlSource: html.replace('<label for="key">', '<label for="key" data-i18n="optKey">') });
  assert.throws(() => assertStructure(bad)); gate.resolve(); await page.flush(); await bad.flush();
});
function contrast(hex) {
  const [r, g, b] = hex.match(/\w\w/g).map((part) => parseInt(part, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}
test("options.html parsed CSS is contrast-safe amber border only, preserves inline geometry and native focus", () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), declarations: m[2].trim() }));
  const modified = rules.filter((rule) => /data-modified|field-modified/.test(rule.selector));
  assert.deepEqual(modified, [
    { selector: '[data-modified="true"]', declarations: 'border-color: #b45309 !important;' },
    { selector: '.field-modified', declarations: 'color: #92400e; font-weight: 600;' },
    { selector: '.field-modified-note', declarations: 'color: #92400e;' },
  ]);
  assert.ok(contrast("b45309") >= 3); assert.ok(contrast("92400e") >= 4.5);
  assert.ok(css.indexOf(".field-modified-note") > css.indexOf(".hint"));
  for (const id of ["uiLang", "provider", "customInstructions"]) {
    const tag = html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))[0];
    assert.match(tag, /border:1px solid #767676;border-radius:6px/);
  }
  assert.match(css, /input \{[^}]*border: 1px solid #767676; border-radius: 6px;/);
  assert.doesNotMatch(modified.map((rule) => rule.declarations).join(" "), /(?:^|;)\s*(?:background|outline|box-shadow|border-width|height|white-space|display)\s*:/);
  assert.doesNotMatch(html, /requireAltForHover|:focus[^}]*\{|outline\s*:\s*(?:none|0)/);
});

test("options.js clean pending Save and clean write failure keep all markers off independently of status", async () => {
  const gate = deferred(); let fail = true;
  const page = await ready({ beforeWrite: async () => { await gate.promise; if (fail) throw new Error("SECRET_ERROR"); } });
  const run = page.nodes.save.dispatch("click"); markers(page);
  assert.equal(page.nodes.status.textContent, "optSaving");
  state(page, "applyI18n(); recomputeDirty()"); markers(page);
  gate.resolve(); await run; markers(page);
  assert.equal(page.nodes.status.textContent, "optSaveFailed");
  fail = false; await page.nodes.save.dispatch("click"); markers(page); membership(page);
});
test("options.js actual runtime locale transitions preserve modified identities, names and descriptions", async () => {
  const page = await ready({ realI18n: true });
  const identities = Object.fromEntries(editableControls.map((id) => [`${id}Modified`, page.nodes[`${id}Modified`]]));
  await page.edit("key", ""); await page.switchTo("gemini");
  page.nodes.provider.setAttribute("aria-describedby", "providerHint providerModified otherProvidersModified");
  for (const lang of ["zh_TW", "nan-Hanlo", "en", "zh_TW"]) {
    page.store.uiLang = lang; await page.i18n.init();
    const before = effects(page); state(page, "applyI18n(); applyI18n()"); noEffects(page, before, 2);
    markers(page, ["provider"], true); assertConnected(page, identities);
    assert.equal(page.nodes.providerModified.textContent, page.context.DebaitMessages[lang].optFieldModified.message);
    assert.equal(page.nodes.otherProvidersModified.textContent, page.context.DebaitMessages[lang].optOtherProvidersModified.message);
    assert.equal(page.nodes.provider.getAttribute("aria-describedby"), "providerHint providerModified otherProvidersModified");
  }
  await page.nodes.discard.dispatch("click"); markers(page);
  assert.equal(page.nodes.provider.getAttribute("aria-describedby"), "providerHint");
});
