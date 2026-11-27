import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createContent, deferred, flush } from "./helpers/content-page.js";
const K = "hoverActivationProvenanceV1";
const reply = { ok: true, result: { honest_title: "Fixture", clickbait_score: 10 } };
function key(p, type, name, values = {}) { return p.key(type, { key: name, ...values }); }
function move(p, a, mode, screenX = 11, extra = {}) { p.mouse("mousemove", a, { screenX, shiftKey: mode === "shift", altKey: mode === "alt", ...extra }); }
function baseline(p, a, extra = {}) { p.mouse("mouseover", a, extra); }
const focusKinds = ["plain", "input", "readonly", "disabled", "textarea", "select", "editable", "inherited", "shadow", "designMode", "closed", "iframe", "cycle", "throws"];
function focus(p, kind) {
  const node = p.element(); node.isConnected = true;
  if (["input", "readonly", "disabled"].includes(kind)) node.tagName = "INPUT";
  if (kind === "readonly") node.readOnly = true;
  if (kind === "disabled") node.disabled = true;
  if (kind === "textarea") node.tagName = "TEXTAREA";
  if (kind === "select") node.tagName = "SELECT";
  if (["editable", "inherited"].includes(kind)) node.isContentEditable = true;
  if (kind === "shadow") { node.tagName = "OPEN-FIELD"; const root = node.attachShadow(); root.activeElement = p.element(); root.activeElement.tagName = "TEXTAREA"; }
  if (kind === "designMode") p.document.designMode = "on";
  if (kind === "closed") node.tagName = "CLOSED-FIELD";
  if (kind === "iframe") node.tagName = "IFRAME";
  if (kind === "cycle") { const root = node.attachShadow(); root.activeElement = node; }
  if (kind === "throws") Object.defineProperty(node, "shadowRoot", { get() { throw new Error("focus"); } });
  p.document.activeElement = node;
  return node;
}
for (const dwell of [0, 500]) for (const kind of focusKinds) test(`content.js stationary Shift is NEVER activation at dwell ${dwell}/${kind}`, async () => {
  for (const sequence of [[], ["a"], ["Tab"], ["ArrowDown"], ["Control"], ["Meta"], ["Alt"], ["IME"]]) {
    const p = createContent({ prefs: { hoverActivation: "shift", previewDwellMs: dwell } }); await flush(); const a = p.anchor(); focus(p, kind);
    baseline(p, a); key(p, "keydown", "Shift");
    for (const name of sequence) key(p, "keydown", name, name === "IME" ? { isComposing: true, keyCode: 229 } : { shiftKey: true });
    key(p, "keydown", "Shift", { repeat: true }); key(p, "keydown", "Shift");
    p.mouse("mouseover", p.child(a), { screenX: 10, clientX: 999, shiftKey: true }); move(p, a, "shift", 10);
    p.timer(); assert.equal(p.timers.length, 0); assert.equal(p.ports.length, 0); assert.equal(p.messages.length, 0);
  }
});
for (const dwell of [0, 500]) for (const mode of ["shift", "alt", "none"]) for (const mixed of [false, true]) test(`content.js trusted movement ${mode}/${dwell}/mixed=${mixed}`, async () => {
  const p = createContent({ prefs: { hoverActivation: mode, previewDwellMs: dwell } }); await flush(); const a = p.anchor(), child = p.child(a);
  baseline(p, a); if (mode === "shift") key(p, "keydown", "Shift");
  move(p, child, mode, 10, { altKey: mode === "alt" || mixed, shiftKey: mode === "shift" || mixed, ctrlKey: true, metaKey: true });
  assert.equal(p.timers.length, 0);
  const event = move(p, child, mode, 11, { altKey: mode === "alt" || mixed, shiftKey: mode === "shift" || mixed, ctrlKey: true, metaKey: true });
  assert.equal(p.timers.length, 1); assert.equal(p.timers[0].delay, dwell); p.timer(); assert.equal(p.ports.length, 1);
  assert.deepEqual(structuredClone(p.ports[0].sent), [{ type: "start", url: a.href }]);
  assert.equal(p.document.activeElement, p.document.body);
  p.ports[0].reply(reply); move(p, a, mode, 12, { altKey: mode === "alt" || mixed, shiftKey: mode === "shift" || mixed });
  assert.equal(p.timers.length, 1);
});
for (const dwell of [0, 500]) for (const kind of focusKinds.filter((k) => k !== "plain")) test(`content.js Alt stationary veto readable-focus uncertainty ${dwell}/${kind}`, async () => {
  const p = createContent({ prefs: { hoverActivation: "alt", previewDwellMs: dwell } }); await flush(); const a = p.anchor(); baseline(p, a); focus(p, kind);
  key(p, "keydown", "Alt"); p.timer(); assert.equal(p.timers.length, 0); assert.equal(p.ports.length, 0);
});
for (const dwell of [0, 500]) test(`content.js legacy Alt fresh stationary start and explicit release/repress ${dwell}`, async () => {
  const p = createContent({ prefs: { requireAltForHover: true, previewDwellMs: dwell } }); await flush(); const a = p.anchor(); baseline(p, a);
  const e = key(p, "keydown", "Alt"); assert.equal(e.defaultPrevented, false); assert.equal(p.timers.length, 1);
  assert.equal(vm.runInContext("hoverIntent.origin", p.context), "keyboard");
  key(p, "keydown", "Alt"); key(p, "keydown", "Alt", { repeat: true }); key(p, "keyup", "Shift"); assert.equal(p.timers.length, 1); assert.equal(p.timers[0].canceled, false);
  key(p, "keyup", "Alt"); p.timer(0, true); assert.equal(p.ports.length, 0);
  key(p, "keydown", "Alt"); assert.equal(p.timers.length, 2); p.timer(); assert.equal(p.ports.length, 1);
});
for (const dwell of [0, 500]) for (const guard of ["Shift", "Control", "Meta", "AltGraph", "letter", "composition", "shiftFlag", "ctrlFlag", "metaFlag", "altGraphFlag", "composing", "229", "badPath", "missingPath", "repeat", "synthetic"]) test(`content.js observed stationary Alt chord guard ${dwell}/${guard}`, async () => {
  const p = createContent({ prefs: { hoverActivation: "alt", previewDwellMs: dwell } }); await flush(); const a = p.anchor(); baseline(p, a);
  const flags = {};
  if (["Shift", "Control", "Meta", "AltGraph"].includes(guard)) key(p, "keydown", guard);
  if (guard === "letter") key(p, "keydown", "a");
  if (guard === "composition") p.window.emit("compositionstart");
  if (guard === "shiftFlag") flags.shiftKey = true;
  if (guard === "ctrlFlag") flags.ctrlKey = true;
  if (guard === "metaFlag") flags.metaKey = true;
  if (guard === "altGraphFlag") flags.getModifierState = (name) => name === "AltGraph";
  if (guard === "composing") flags.isComposing = true;
  if (guard === "229") flags.keyCode = 229;
  if (guard === "badPath") flags.composedPath = () => [];
  if (guard === "missingPath") flags.composedPath = undefined;
  if (guard === "repeat") flags.repeat = true;
  if (guard === "synthetic") flags.isTrusted = false;
  key(p, "keydown", "Alt", flags); p.timer(); assert.equal(p.timers.length, 0); assert.equal(p.ports.length, 0);
});
const typingEvents = ["letter", "Tab", "ArrowDown", "Escape", "229", "compositionstart", "compositionupdate", "beforeinput", "input", "insertCompositionText", "deleteCompositionText", "insertFromComposition"];
function typing(p, type, isTrusted = true) {
  if (["letter", "Tab", "ArrowDown", "Escape", "229"].includes(type)) key(p, "keydown", type === "letter" ? "a" : type, { isTrusted, ...(type === "229" ? { keyCode: 229 } : {}) });
  else if (["insertCompositionText", "deleteCompositionText", "insertFromComposition"].includes(type)) p.window.emit("beforeinput", { inputType: type, isTrusted });
  else p.window.emit(type, { isTrusted, isComposing: ["beforeinput", "input"].includes(type) });
}
for (const dwell of [0, 500]) for (const origin of ["shift-movement", "alt-keyboard", "alt-movement", "none-movement"]) for (const event of typingEvents) test(`content.js observed typing cancels only approved interests ${origin}/${dwell}/${event}`, async () => {
  const mode = origin.split("-")[0], p = createContent({ prefs: { hoverActivation: mode, previewDwellMs: dwell } }); await flush(); const a = p.anchor(); baseline(p, a);
  if (origin === "alt-keyboard") key(p, "keydown", "Alt"); else move(p, a, mode);
  assert.equal(p.timers.length, 1); typing(p, event, false); assert.equal(p.timers[0].canceled, false);
  typing(p, event); p.timer(0, true);
  const canceled = ["shift-movement", "alt-keyboard"].includes(origin);
  assert.equal(p.timers[0].canceled, canceled); assert.equal(p.ports.length, canceled ? 0 : 1);
  if (canceled) { move(p, a, mode, origin === "alt-keyboard" ? 10 : 11); assert.equal(p.timers.length, 1); if (mode === "shift") { move(p, a, mode, 12); assert.equal(p.timers.length, 2); } }
});
for (const stage of ["dwell", "connected", "completed", "error"]) for (const origin of ["shift-movement", "alt-keyboard", "alt-movement", "none-movement"]) test(`content.js focus transition cancels without revival ${origin}/${stage}`, async () => {
  for (const kind of ["input", "shadow", "closed", "iframe"]) {
    const mode = origin.split("-")[0], p = createContent({ prefs: { hoverActivation: mode } }); await flush(); const a = p.anchor(); baseline(p, a);
    if (origin === "alt-keyboard") key(p, "keydown", "Alt"); else move(p, a, mode);
    if (stage !== "dwell") p.timer();
    if (stage === "completed") p.ports[0].reply(reply);
    if (stage === "error") p.ports[0].unexpected();
    const n = focus(p, kind); p.document.emit("focus", { target: n, isTrusted: false }); assert.equal(p.timers[0].canceled, false);
    p.document.emit("focus", { target: n });
    const canceled = ["shift-movement", "alt-keyboard"].includes(origin);
    assert.equal(p.timers[0].canceled, canceled); assert.equal(p.observers[0].active, !canceled);
    if (canceled) {
      assert.equal(p.tip(), undefined); p.timer(0, true); move(p, a, mode, origin === "alt-keyboard" ? 10 : 11); assert.equal(p.timers.length, 1);
      if (mode === "shift") { move(p, a, mode, 12); assert.equal(p.timers.length, 2, "deliberate later Shift movement allowed even in editable focus"); }
    }
  }
});
for (const stage of ["dwell", "reply", "observer"]) test(`content.js Alt keyboard focus validity rechecks at ${stage}`, async () => {
  const p = createContent({ prefs: { hoverActivation: "alt" } }); await flush(); const a = p.anchor(); baseline(p, a); key(p, "keydown", "Alt");
  if (stage !== "dwell") p.timer(); focus(p, "input");
  if (stage === "dwell") p.timer(); else if (stage === "reply") p.ports[0].reply(reply); else p.mutate();
  assert.equal(p.tip(), undefined); assert.equal(p.observers[0].active, false);
});
for (const stage of ["connected", "completed", "error"]) for (const origin of ["shift-movement", "alt-keyboard"]) test(`content.js typing cancellation after dispatch never claims zero prior contact ${origin}/${stage}`, async () => {
  const mode = origin.split("-")[0], p = createContent({ prefs: { hoverActivation: mode, previewDwellMs: 0 } }); await flush(); const a = p.anchor(); baseline(p, a);
  if (mode === "alt") key(p, "keydown", "Alt"); else move(p, a, mode);
  p.timer(); if (stage === "completed") p.ports[0].reply(reply); if (stage === "error") p.ports[0].unexpected();
  typing(p, "letter"); assert.equal(p.ports.length, 1); assert.equal(p.ports[0].sent.length, 1); assert.equal(p.tip(), undefined); assert.equal(p.observers[0].active, false);
});
for (const stage of ["dwell", "connected", "completed", "error"]) for (const mode of ["shift", "alt", "none"]) test(`content.js independent modifiers/release and positional withdrawal ${mode}/${stage}`, async () => {
  const p = createContent({ prefs: { hoverActivation: mode } }); await flush(); const a = p.anchor(); baseline(p, a);
  move(p, a, mode, 11, { shiftKey: true, altKey: true });
  if (stage !== "dwell") p.timer(); if (stage === "completed") p.ports[0].reply(reply); if (stage === "error") p.ports[0].unexpected();
  key(p, "keyup", mode === "shift" ? "Alt" : "Shift"); assert.equal(p.timers[0].canceled, false);
  key(p, "keydown", mode === "shift" ? "Shift" : "Alt", { isTrusted: false });
  key(p, "keyup", mode === "shift" ? "Shift" : "Alt", { isTrusted: false }); assert.equal(p.timers[0].canceled, false);
  key(p, "keyup", mode === "shift" ? "Shift" : "Alt"); assert.equal(p.timers[0].canceled, mode !== "none");
});
test("content.js selected modifier flags disappearing on movement cancel; unrelated modifier key flags do not erase selected key", async () => {
  for (const mode of ["shift", "alt"]) {
    const p = createContent({ prefs: { hoverActivation: mode } }); await flush(); const a = p.anchor(); baseline(p, a); move(p, a, mode);
    key(p, "keydown", mode === "shift" ? "Alt" : "Shift"); assert.equal(p.timers[0].canceled, false);
    key(p, "keyup", mode === "shift" ? "Alt" : "Shift"); assert.equal(p.timers[0].canceled, false);
    move(p, a, "none", 12); assert.equal(p.timers[0].canceled, true);
  }
});
test("content.js Alt keyboard other modifier/chord cancels but movement keeps selected-key-only policy", async () => {
  for (const name of ["Shift", "Control", "Meta", "AltGraph"]) for (const keyboard of [true, false]) {
    const p = createContent({ prefs: { hoverActivation: "alt" } }); await flush(); const a = p.anchor(); baseline(p, a);
    if (keyboard) key(p, "keydown", "Alt"); else move(p, a, "alt");
    key(p, "keydown", name); assert.equal(p.timers[0].canceled, keyboard);
  }
});
test("content.js composition end/lifecycle clears guard without auto revival, ordinary focus/blur preserves", async () => {
  const p = createContent({ prefs: { hoverActivation: "alt" } }); await flush(); const a = p.anchor(); baseline(p, a);
  p.window.emit("compositionstart"); key(p, "keydown", "Alt"); assert.equal(p.timers.length, 0);
  p.window.emit("compositionend", { isTrusted: false }); key(p, "keyup", "Alt"); key(p, "keydown", "Alt"); assert.equal(p.timers.length, 0);
  p.window.emit("compositionend"); assert.equal(p.timers.length, 0); key(p, "keyup", "Alt"); key(p, "keydown", "Alt"); assert.equal(p.timers.length, 1);
  const plain = focus(p, "plain"); p.document.emit("focus", { target: plain }); p.document.emit("blur", { target: plain }); assert.equal(p.timers[0].canceled, false);
  p.window.emit("blur"); assert.equal(vm.runInContext("!altDown && !shiftDown && pressedKeys.size === 0 && !compositionActive", p.context), true);
});
test("content.js raw initial area reads/event precedence/removal epochs do not fabricate readiness", async () => {
  for (const reverse of [false, true]) {
    const sync = deferred(), local = deferred(); const p = createContent({ initialRead: () => sync.promise, localRead: () => local.promise }); const a = p.anchor();
    p.change({ requireAltForHover: false, previewDwellMs: 0 }); baseline(p, a); key(p, "keydown", "Shift"); move(p, a, "shift"); assert.equal(p.timers.length, 0);
    p.change({ hoverActivation: "shift", requireAltForHover: false });
    const before = p.timers.length; move(p, a, "shift", 11); assert.equal(p.timers.length, before);
    if (reverse) local.resolve({ [K]: "existing" }); else sync.resolve({ hoverActivation: "none", previewDwellMs: 500 });
    await flush(); if (reverse) sync.resolve({ hoverActivation: "none", previewDwellMs: 500 }); else local.resolve({ [K]: "existing" }); await flush();
    assert.equal(vm.runInContext("hoverPolicy.mode", p.context), "shift"); assert.equal(vm.runInContext("hoverPolicy.dwellMs", p.context), 0);
    move(p, a, "shift", 12); assert.equal(p.timers.length, 1);
    p.remove(["hoverActivation"]); assert.equal(p.timers[0].canceled, true); assert.equal(vm.runInContext("hoverPolicy.mode", p.context), "none");
    p.remove(["requireAltForHover", "previewDwellMs"]); assert.equal(vm.runInContext("hoverPolicy.mode", p.context), "alt"); assert.equal(vm.runInContext("hoverPolicy.dwellMs", p.context), 500);
  }
});
test("content.js pending local read across removal cannot resurrect fallback, marker arrival allows only new movement", async () => {
  const wait = deferred(); const p = createContent({ localRead: () => wait.promise }); await flush(); const a = p.anchor(); baseline(p, a); move(p, a, "shift");
  p.remove([K], "local"); wait.resolve({ [K]: "existing" }); await flush(); assert.equal(vm.runInContext("hoverPolicy.ready", p.context), false);
  p.change({ profiles: {}, uiLang: "zh_TW" }); p.change({ debaitUsage: {} }, "local"); assert.equal(vm.runInContext("hoverPolicy.ready", p.context), false);
  p.change({ [K]: "fresh" }, "local"); move(p, a, "shift", 11); assert.equal(p.timers.length, 0); key(p, "keydown", "Shift"); assert.equal(p.timers.length, 0);
  move(p, a, "shift", 12); assert.equal(p.timers.length, 1);
});
test("content.js shadowed raw events and evidence do not cancel identical saved policy", async () => {
  const p = createContent({ prefs: { hoverActivation: "shift" }, local: { [K]: "fresh" } }); await flush(); const a = p.anchor(); baseline(p, a); move(p, a, "shift");
  p.change({ requireAltForHover: false, profiles: {}, uiLang: "zh_TW" }); p.remove([K], "local"); assert.equal(p.timers[0].canceled, false);
  p.change({ hoverActivation: null }); assert.equal(p.timers[0].canceled, false, "malformed canonical still required Shift");
  p.remove(["hoverActivation"]); assert.equal(p.timers[0].canceled, true); assert.equal(vm.runInContext("hoverPolicy.mode", p.context), "none");
});
test("content.js failed reads preserve newer authoritative events, missing/unknown canonical cannot be bypassed", async () => {
  const wait = deferred(); const p = createContent({ initialRead: () => wait.promise, localRead: () => Promise.reject(new Error("local")) });
  p.change({ requireAltForHover: false, previewDwellMs: 0 }); wait.reject(new Error("sync")); await flush();
  assert.equal(vm.runInContext("hoverPolicy.ready", p.context), false);
  p.remove(["hoverActivation"]); assert.equal(vm.runInContext("hoverPolicy.ready", p.context), true);
  const a = p.anchor(); baseline(p, a); move(p, a, "none"); assert.equal(p.timers.length, 1);
});

for (const field of ["previewDwellMs", "provider", "profiles", "uiLang", "requireAltForHover", "hoverActivation"]) test(`content.js unrelated/newer ${field} event only supersedes that raw field during delayed sync read`, async () => {
  const wait = deferred(), p = createContent({ initialRead: () => wait.promise, local: { [K]: "fresh" } });
  const values = { previewDwellMs: 0, provider: "openai", profiles: {}, uiLang: "zh_TW", requireAltForHover: false, hoverActivation: "shift" };
  p.change({ [field]: values[field] });
  wait.resolve({ hoverActivation: "alt", requireAltForHover: true, previewDwellMs: 30, provider: "custom" }); await flush();
  assert.equal(vm.runInContext("hoverPolicy.mode", p.context), field === "hoverActivation" ? "shift" : "alt");
  assert.equal(vm.runInContext("hoverPolicy.dwellMs", p.context), field === "previewDwellMs" ? 0 : 30);
  const a = p.anchor(); baseline(p, a); move(p, a, field === "hoverActivation" ? "shift" : "alt"); assert.equal(p.timers.length, 1);
});
for (const noiseArea of ["sync", "local", "session"]) test(`content.js noise ${noiseArea} events do not suppress delayed known empty raw preference initialization`, async () => {
  const wait = deferred(), p = createContent({ initialRead: () => wait.promise, local: { [K]: "fresh" } });
  p.change({ debaitUsage: {}, popupStatus: "noise" }, noiseArea); wait.resolve({}); await flush();
  assert.equal(vm.runInContext("hoverPolicy.ready && hoverPolicy.mode === 'shift' && hoverPolicy.dwellMs === 500", p.context), true);
});
for (const event of ["click", "pointerdown", "contextmenu"]) for (const mode of ["shift", "alt", "none"]) test(`content.js ${event} always cancels hover with selected modifier held ${mode}`, async () => {
  const p = createContent({ prefs: { hoverActivation: mode } }); await flush(); const a = p.anchor(); baseline(p, a); move(p, a, mode); p.timer();
  p.document.emit(event, { target: a, shiftKey: true, altKey: true, isTrusted: false }); assert.equal(p.ports[0].closed, false);
  const e = p.document.emit(event, { target: a, shiftKey: true, altKey: true }); assert.equal(e.defaultPrevented, false);
  assert.equal(p.ports[0].closed, true); assert.equal(p.tip(), undefined); key(p, "keydown", "Shift"); key(p, "keydown", "Alt"); assert.equal(p.timers.length, 1);
});
test("content.js none mode owned-panel incidental modifiers/focus/composition never dismiss its tooltip", async () => {
  const p = createContent({ prefs: { hoverActivation: "none" } }); await flush(); const a = p.anchor(); baseline(p, a); move(p, a, "none"); p.timer(); p.ports[0].reply(reply);
  p.manual(a.href); const host = p.hosts.get("debait-panel-host"), before = p.tip();
  for (const name of ["Shift", "Alt", "Control", "Meta", "a"]) { key(p, "keydown", name, { composedPath: () => [host.__content, host] }); key(p, "keyup", name); }
  p.document.emit("focus", { target: focus(p, "input") }); p.window.emit("compositionstart");
  assert.equal(p.tip(), before); assert.equal(p.timers.length, 1); assert.equal(p.observers[0].active, true);
});
test("content.js unsafe event path/editing ancestor veto and unknown modifier state cannot throw-start stationary Alt", async () => {
  for (const flags of [{ composedPath: () => [null] }, { composedPath: () => Array(101).fill({}) }, { composedPath: () => [{ isContentEditable: true }, {}] }, { getModifierState() { throw new Error("unknown modifier"); } }]) {
    const p = createContent({ prefs: { hoverActivation: "alt" } }); await flush(); baseline(p, p.anchor()); key(p, "keydown", "Alt", flags); assert.equal(p.timers.length, 0);
  }
});
