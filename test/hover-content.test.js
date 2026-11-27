import { test } from "node:test";
import assert from "node:assert/strict";
import { createContent, deferred, flush } from "./helpers/content-page.js";
import { loadPreviewLocale, setupOnly, maliciousSetup } from "./helpers/preview-locales.js";
import { panelDom } from "./helpers/panel-page.js";

function enter(p, a, altKey = false) {
  p.mouse("mouseover", a, { altKey });
  p.mouse("mousemove", a, { screenX: 11, altKey });
}
const result = { ok: true, result: { honest_title: "<Fixture>", clickbait_score: 80, summary: "safe" } };

test("content-hover: initial prefs read cannot overwrite newer per-field changes", async () => {
  for (const [changed, read, expectedAlt, expectedDwell] of [
    [{ requireAltForHover: false }, { requireAltForHover: true, previewDwellMs: 30 }, false, 30],
    [{ requireAltForHover: undefined }, { requireAltForHover: false, previewDwellMs: 40 }, true, 40],
    [{ previewDwellMs: 0 }, { requireAltForHover: false, previewDwellMs: 500 }, false, 0],
    [{ requireAltForHover: false }, { requireAltForHover: true, previewDwellMs: 100 }, false, 100],
  ]) {
    const wait = deferred(); const p = createContent({ initialRead: () => wait.promise }); p.change(changed); wait.resolve(read); await flush();
    const a = p.anchor(); enter(p, a, expectedAlt); assert.equal(p.timers.length, 1); assert.equal(p.timers[0].delay, expectedDwell);
    if (expectedAlt) { p.key("keyup", { key: "Alt" }); assert.equal(p.timers[0].canceled, true); }
  }
  const wait = deferred(); const p = createContent({ initialRead: () => wait.promise }); p.change({ hoverActivation: "none", previewDwellMs: 500 }); wait.reject(new Error("read")); await flush();
  enter(p, p.anchor()); assert.equal(p.timers.length, 1);
  const failed = createContent({ initialRead: () => Promise.reject(new Error("read")) }); await flush(); enter(failed, failed.anchor()); assert.equal(failed.timers.length, 0);
});
for (const value of [undefined, null, true, "false", 0, [], {}]) test(`content-hover: fail-safe saved boolean ${JSON.stringify(value)}`, async () => {
  const p = createContent({ prefs: { requireAltForHover: value } }); await flush(); const a = p.anchor(); enter(p, a); assert.equal(p.timers.length, 0); p.key("keydown", { key: "Alt" }); assert.equal(p.timers.length, 1);
});
test("content-hover: required and stationary Alt exactly once", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(), child = p.child(a);
  p.mouse("mouseover", a); assert.equal(p.timers.length, 0); p.key("keydown", { key: "Alt" }); assert.equal(p.timers.length, 1);
  p.key("keydown", { key: "Alt", repeat: true }); p.mouse("mouseover", child, { altKey: true }); p.mouse("mousemove", child, { screenX: 20, altKey: true });
  p.document.emit("mouseout", { target: a, relatedTarget: child }); assert.equal(p.timers.length, 1); assert.equal(p.timers[0].canceled, false);
  p.timer(); assert.equal(p.ports.length, 1); p.ports[0].reply(result); assert.ok(p.tip().includes("&lt;Fixture&gt;"));
  p.key("keydown", { key: "Alt" }); p.mouse("mousemove", a, { screenX: 21, altKey: true }); assert.equal(p.timers.length, 1);
  p.key("keyup", { key: "Alt" }); assert.equal(p.tip(), undefined); assert.equal(p.observers[0].active, false);
  p.key("keydown", { key: "Alt", repeat: true }); assert.equal(p.timers.length, 1); p.key("keyup", { key: "Alt" }); p.key("keydown", { key: "Alt" }); assert.equal(p.timers.length, 2);
});
for (const required of [true, false]) for (const first of ["mouseover", "mousemove"]) test(`content-hover: movement bootstrap and event ordering ${required}/${first}`, async () => {
  const p = createContent({ prefs: { requireAltForHover: required } }); await flush(); const a = p.anchor(), child = p.child(a);
  p.mouse(first, a, { altKey: true }); assert.equal(p.timers.length, 0);
  p.mouse(first === "mouseover" ? "mousemove" : "mouseover", a, { altKey: true }); assert.equal(p.timers.length, 0);
  p.mouse("mousemove", child, { altKey: true, screenX: 11 }); assert.equal(p.timers.length, 1);
  p.mouse("mouseover", a, { altKey: true, screenX: 11 }); p.mouse("mousemove", a, { altKey: true, screenX: 12 }); assert.equal(p.timers.length, 1);
  p.timer(); p.ports[0].reply(result); p.mouse("mousemove", child, { altKey: true, screenX: 13 }); assert.equal(p.ports.length, 1); assert.equal(p.timers.length, 1);
});
test("content-hover: off mode and dwell zero", async () => {
  const p = createContent({ prefs: { requireAltForHover: false, previewDwellMs: 0 } }); await flush(); const a = p.anchor(); enter(p, a);
  assert.equal(p.timers.length, 1); assert.equal(p.timers[0].delay, 0); assert.equal(p.ports.length, 0);
  p.key("keydown", { key: "Alt" }); p.key("keyup", { key: "Alt" }); assert.equal(p.timers[0].canceled, false); p.timer(); assert.equal(p.ports.length, 1);
  p.ports[0].reply(result); p.key("keyup", { key: "Alt" }); assert.ok(p.tip()); assert.equal(p.timers.length, 1);
});
for (const required of [true, false]) test(`content-hover: layout-induced trusted events are not user action ${required}`, async () => {
  const p = createContent({ prefs: { requireAltForHover: required } }); await flush(); let a = p.anchor(); enter(p, a, true); p.timer();
  const cancellation = [
    () => p.mutate([{ type: "attributes", target: a, attributeName: "href" }]),
    () => p.window.emit("scroll"),
    () => p.document.emit("pointerdown", { screenX: 11, screenY: 10 }),
    () => p.document.emit("contextmenu"),
    () => p.document.emit("mouseout", { target: a, relatedTarget: null }),
    () => p.change({ previewDwellMs: 50 }),
    () => { p.focus(false); p.mouse("mousemove", a, { screenX: 11, altKey: true }); p.focus(true); },
  ];
  for (const cancel of cancellation) {
    cancel(); const before = p.timers.length; a = p.anchor(`https://article.example/${before}`);
    for (let i = 0; i < 3; i++) for (const type of ["mouseover", "mousemove"]) p.mouse(type, a, { screenX: 11, clientX: 700 + i, altKey: true });
    assert.equal(p.timers.length, before);
    p.mouse("mousemove", a, { screenX: 12, altKey: true }); p.mouse("mouseover", a, { screenX: 12, altKey: true }); assert.equal(p.timers.length, before + 1);
    p.timer(); p.mouse("mousemove", a, { screenX: 11, altKey: true });
  }
});
test("content-hover: target transition consumes prior movement before genuine moving entry", async () => {
  const p = createContent({ prefs: { requireAltForHover: false } }); await flush(); const a = p.anchor(), b = p.anchor("https://article.example/b");
  enter(p, a); p.mouse("mouseover", b, { screenX: 12 }); assert.equal(p.timers.length, 2); assert.equal(p.timers[0].canceled, true);
  p.mouse("mouseover", a, { screenX: 12 }); assert.equal(p.timers.length, 2);
  p.mouse("mousemove", a, { screenX: 13 }); assert.equal(p.timers.length, 3);
});
test("content-hover: trust, missing coordinates and target eligibility", async () => {
  const p = createContent({ prefs: { requireAltForHover: false } }); await flush(); const a = p.anchor();
  for (const type of ["mouseover", "mousemove"]) p.mouse(type, a, { isTrusted: false, screenX: 100 });
  p.key("keydown", { key: "Alt", isTrusted: false }); assert.equal(p.timers.length, 0);
  for (const pair of [[undefined, undefined], [NaN, 1], [1, Infinity]]) p.document.emit("mousemove", { target: a, screenX: pair[0], screenY: pair[1] });
  p.mouse("mouseover", a); assert.equal(p.timers.length, 0);
  const bad = [p.anchor("javascript:alert(1)"), p.anchor("https://page.example/#part"), null];
  let screenX = 11;
  for (const target of bad) p.mouse("mouseover", target || { closest: () => null }, { screenX: screenX++ });
  p.focus(false); p.mouse("mouseover", a, { screenX: screenX++ }); p.focus(true);
  p.document.visibilityState = "hidden"; p.mouse("mouseover", a, { screenX: screenX++ }); p.document.visibilityState = "visible";
  p.mouse("mouseover", a, { screenX: screenX - 1 }); assert.equal(p.timers.length, 0); p.mouse("mousemove", a, { screenX }); assert.equal(p.timers.length, 1);
  p.timer(); const host = p.hosts.get("debait-tooltip"); p.mouse("mouseover", a, { screenX: screenX + 1, composedPath: () => [a, host] }); assert.equal(p.tip(), undefined); assert.equal(p.timers.length, 1);
  // Page-supplied ids do not identify our actual owned hosts.
  const pageAnchor = p.anchor("https://article.example/not-owned"); pageAnchor.id = "debait-tooltip"; p.mouse("mousemove", pageAnchor, { screenX: screenX + 2 }); assert.equal(p.timers.length, 2);
});
for (const event of ["blur", "pagehide", "hidden"]) test(`content-hover: lifecycle ${event} resets baseline without revival`, async () => {
  const p = createContent({ prefs: { requireAltForHover: false } }); await flush(); const a = p.anchor(); enter(p, a); p.timer();
  if (event === "hidden") { p.document.visibilityState = "hidden"; p.document.emit("visibilitychange"); p.document.visibilityState = "visible"; p.document.emit("visibilitychange"); }
  else p.window.emit(event);
  p.window.emit("pageshow"); p.window.emit("focus"); assert.equal(p.tip(), undefined); assert.equal(p.ports[0].closed, true);
  p.mouse("mousemove", a, { screenX: 100 }); assert.equal(p.timers.length, 1); p.mouse("mousemove", a, { screenX: 101 }); assert.equal(p.timers.length, 2);
});
test("content-hover: saved changes cancel without auto-start; unrelated changes do not", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); enter(p, a, true); p.timer();
  p.change({ language: "English" }); assert.equal(p.ports[0].closed, false); p.change({ requireAltForHover: true }); assert.equal(p.ports[0].closed, false);
  p.change({ requireAltForHover: false }); assert.equal(p.ports[0].closed, true); p.mouse("mousemove", a, { screenX: 11 }); assert.equal(p.timers.length, 1);
  p.mouse("mousemove", a, { screenX: 12 }); assert.equal(p.timers.length, 2);
});
for (const mutation of ["href-revert", "remove-reinsert", "base", "resolved"]) test(`content-hover: active mutation cancellation ${mutation} during dwell`, async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor("relative"); enter(p, a, true);
  if (mutation === "href-revert") p.mutate([{ type: "attributes", target: a, attributeName: "href" }]);
  if (mutation === "remove-reinsert") p.mutate([{ type: "childList", removedNodes: [a] }]);
  if (mutation === "base") { p.setBase("https://changed.example/"); p.mutate([{ type: "attributes", target: { tagName: "BASE" }, attributeName: "href" }]); }
  if (mutation === "resolved") { a.href = "https://changed.example/"; p.mutate([]); }
  p.timer(0, true); assert.equal(p.ports.length, 0); assert.equal(p.observers[0].active, false);
});
test("content-hover: dwell and reply revalidate even before delayed observer delivery", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); enter(p, a, true); a.href = "https://changed.example/"; p.timer(); assert.equal(p.ports.length, 0);
  enter(p, a, true); p.timer(); a.isConnected = false; p.ports[0].reply(result); assert.equal(p.tip(), undefined);
});
test("content-hover: token and port terminal lifecycle", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); enter(p, a, true); p.timer(); const old = [...p.ports[0].onMessage.all][0];
  p.document.emit("mouseout", { target: a }); p.timer(0, true); assert.equal(p.ports.length, 1);
  p.mouse("mousemove", a, { screenX: 12, altKey: true }); p.timer(); old(result); assert.ok(!p.tip().includes("Fixture"));
  p.ports[1].reply(result); const tip = p.tip(); p.ports[1].unexpected(); assert.equal(p.tip(), tip); assert.equal(p.ports[1].onMessage.all.size, 0);
  p.document.emit("contextmenu"); assert.equal(p.tip(), undefined); assert.ok(p.observers.every((o) => !o.active)); assert.ok(p.timers.every((timer) => timer.canceled));
});
for (const failure of ["connect", "post", "unexpected"]) test(`content-hover: ${failure} failure is terminal and localized`, async () => {
  const p = createContent({ prefs: { requireAltForHover: true }, connectThrows: failure === "connect", postThrows: failure === "post" }); await flush(); const a = p.anchor(); enter(p, a, true); p.timer();
  if (failure === "unexpected") p.ports[0].unexpected(); assert.ok(p.tip().includes("errGeneric"));
  p.key("keydown", { key: "Alt" }); p.mouse("mousemove", a, { screenX: 12, altKey: true }); assert.equal(p.timers.length, 1); assert.equal(p.observers[0].active, true);
  p.key("keyup", { key: "Alt" }); assert.equal(p.tip(), undefined); assert.equal(p.observers[0].active, false);
});
test("content-hover: right-click manual panel remains independent of hover cancellation", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); enter(p, a, true); p.manual(a.href); p.document.emit("contextmenu"); await flush();
  assert.equal(p.messages[0].type, "debait:preview"); p.timer(0, true); assert.equal(p.ports.length, 0);
  p.pendingManual[0](result); await flush(); assert.ok(p.hosts.get("debait-panel-host").__content.innerHTML.includes("Fixture")); assert.equal(p.tip(), undefined);
});

test("content-hover: rejection consumes movement in required mode and foreground", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); p.mouse("mouseover", a);
  p.mouse("mousemove", a, { screenX: 11 }); p.mouse("mouseover", a, { screenX: 11, altKey: true }); assert.equal(p.timers.length, 0);
  p.mouse("mousemove", a, { screenX: 12, altKey: true }); assert.equal(p.timers.length, 1);
  p.focus(false); p.mouse("mousemove", a, { screenX: 13, altKey: true }); p.focus(true);
  p.mouse("mouseover", a, { screenX: 13, altKey: true }); assert.equal(p.timers.length, 1);
  p.mouse("mousemove", a, { screenX: 14, altKey: true }); assert.equal(p.timers.length, 2);
});
for (const required of [true, false]) test(`content-hover: fresh stationary Alt after DOM cancellation ${required}`, async () => {
  const p = createContent({ prefs: { requireAltForHover: required } }); await flush(); const a = p.anchor(); enter(p, a, true);
  p.mutate([{ type: "attributes", target: a, attributeName: "href" }]); p.mouse("mouseover", a, { screenX: 11, altKey: true });
  p.key("keydown", { key: "Alt", repeat: true }); assert.equal(p.timers.length, 1); p.key("keyup", { key: "Alt" }); p.key("keydown", { key: "Alt" }); assert.equal(p.timers.length, required ? 2 : 1);
});
test("content-hover: owned shadow keydown cannot start hover; stale old disconnect is silent", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); enter(p, a, true); p.timer(); const oldDisconnect = [...p.ports[0].onDisconnect.all][0];
  p.manual(a.href); const host = p.hosts.get("debait-panel-host"); p.key("keyup", { key: "Alt" });
  p.key("keydown", { key: "Alt", composedPath: () => [host.__content, host.shadowRoot, host] }); assert.equal(p.timers.length, 1);
  p.mouse("mousemove", a, { screenX: 12, altKey: true }); p.timer(); const tip = p.tip(); oldDisconnect(); assert.equal(p.tip(), tip);
  p.document.emit("mouseout", { target: p.anchor("https://other.example/"), relatedTarget: null }); assert.equal(p.ports[1].closed, false);
});
test("content-hover: nested scroll uses passive capture and completed/error observers remain live", async () => {
  const p = createContent({ prefs: { requireAltForHover: true } }); await flush(); const a = p.anchor(); enter(p, a, true); p.timer(); p.ports[0].reply(result);
  assert.equal(p.observers[0].active, true); assert.equal(p.observers[0].target, p.document); assert.deepEqual(structuredClone(p.observers[0].options.attributeFilter), ["href"]);
  const scroll = p.window.events.get("scroll")[0]; assert.equal(scroll.options.capture, true); assert.equal(scroll.options.passive, true);
  p.mutate([{ type: "childList", removedNodes: [{ contains: (node) => node === a }] }]); assert.equal(p.tip(), undefined);
  p.mouse("mousemove", a, { screenX: 12, altKey: true }); p.timer(); p.ports[1].unexpected(); assert.ok(p.tip().includes("errGeneric"));
  p.mutate([{ type: "attributes", target: a, attributeName: "href" }]); assert.equal(p.tip(), undefined); assert.ok(p.observers.every((o) => !o.active));
});

test("content-hover: cold unknown policy cannot start; initial readiness consumes movement", async () => {
  const wait = deferred(); const p = createContent({ initialRead: () => wait.promise }); const a = p.anchor(); enter(p, a, true);
  assert.equal(p.timers.length, 0); wait.resolve({ requireAltForHover: false, previewDwellMs: 0 }); await flush();
  p.mouse("mouseover", a, { screenX: 11 }); assert.equal(p.timers.length, 0);
  p.mouse("mousemove", a, { screenX: 12 }); assert.equal(p.timers.length, 1); assert.equal(p.timers[0].delay, 0);
});
test("content-hover: saved removals normalize fail-safe and unrelated area changes are ignored", async () => {
  const p = createContent({ prefs: { requireAltForHover: false, previewDwellMs: 0 } }); await flush(); const a = p.anchor(); enter(p, a); p.timer();
  p.backend.emit({ requireAltForHover: { newValue: true } }, "local"); assert.equal(p.ports[0].closed, false);
  p.change({ requireAltForHover: null }); p.remove(["previewDwellMs"]); assert.equal(p.ports[0].closed, true);
  p.mouse("mousemove", a, { screenX: 12 }); assert.equal(p.timers.length, 1); p.key("keyup", { key: "Alt" }); p.key("keydown", { key: "Alt" }); assert.equal(p.timers.length, 2); assert.equal(p.timers[1].delay, 500);
});

test("content-hover: off-mode Alt on owned panel never dismisses an active intent", async () => {
  const p = createContent({ prefs: { requireAltForHover: false } }); await flush(); const a = p.anchor(); enter(p, a); p.timer(); p.ports[0].reply(result);
  p.manual(a.href); const host = p.hosts.get("debait-panel-host"), before = p.tip();
  p.key("keydown", { key: "Alt", composedPath: () => [host.__content, host] }); p.key("keyup", { key: "Alt" }); assert.equal(p.tip(), before); assert.equal(p.timers.length, 1);
});

const captureEvents = ["mouseover", "mousemove", "mouseout", "keydown", "keyup", "pointerdown", "contextmenu", "scroll", "blur", "pagehide", "visibilitychange"];
function pageBubbleBlockers({ document, window }) {
  // Installed before content loads: window bubble stopImmediatePropagation would
  // suppress the old key listeners even on the same event target.
  for (const type of captureEvents) {
    window.addEventListener(type, (e) => e.stopImmediatePropagation());
    document.addEventListener(type, (e) => e.stopPropagation());
  }
}

test("content-hover: window capture observes movement and fresh Alt before page bubble blockers", async () => {
  for (const required of [true, false]) {
    const p = createContent({ prefs: { requireAltForHover: required }, beforeLoad: pageBubbleBlockers }); await flush();
    const a = p.anchor();
    for (const type of ["mouseover", "mousemove", "keydown"]) a.addEventListener(type, (e) => e.stopPropagation());
    for (const type of captureEvents) {
      const capture = p.window.events.get(type).filter((listener) => listener.options?.capture);
      assert.equal(capture.length, 1, `${type} has one window capture listener`);
      assert.ok(!p.document.events.get(type).some((listener) => listener.options?.capture));
    }
    p.mouse("mouseover", a, { altKey: true }); assert.equal(p.timers.length, 0);
    const movement = p.mouse("mousemove", a, { screenX: 11, altKey: true });
    assert.equal(movement.defaultPrevented, false); assert.equal(p.timers.length, 1);
    p.timer(); assert.equal(p.ports.length, 1);
    const release = p.key("keyup", { key: "Alt", target: a }); assert.equal(release.defaultPrevented, false);
    assert.equal(p.ports[0].closed, required);
    p.key("keydown", { key: "Alt", target: a, isTrusted: false }); p.key("keydown", { key: "Alt", target: a, repeat: true }); assert.equal(p.timers.length, 1);
    p.key("keyup", { key: "Alt", target: a }); p.key("keydown", { key: "Alt", target: a }); assert.equal(p.timers.length, required ? 2 : 1);
  }
});

for (const dispatched of [false, true]) test(`content-hover: window capture cancellation survives page bubble blockers ${dispatched ? "connected" : "dwell"}`, async () => {
  for (const type of ["keyup", "mouseout", "pointerdown", "contextmenu", "scroll", "blur", "pagehide", "visibilitychange"]) {
    const p = createContent({ prefs: { requireAltForHover: true }, beforeLoad: pageBubbleBlockers }); await flush(); const a = p.anchor();
    a.addEventListener(type, (e) => e.stopPropagation()); enter(p, a, true);
    if (dispatched) p.timer();
    if (["keyup", "mouseout", "pointerdown", "contextmenu"].includes(type)) {
      p.document.emit(type, { target: a, key: "Alt", isTrusted: false, relatedTarget: null, screenX: 11, screenY: 10 });
      assert.equal(p.timers[0].canceled, false, `synthetic ${type}`);
      assert.equal(p.observers[0].active, true, `synthetic ${type}`);
      if (dispatched) assert.equal(p.ports[0].closed, false, `synthetic ${type}`);
    }
    if (type === "visibilitychange") p.document.visibilityState = "hidden";
    const event = type === "keyup" ? p.key(type, { key: "Alt", target: a }) :
      ["blur", "pagehide"].includes(type) ? p.window.emit(type) :
      p.document.emit(type, { target: type === "visibilitychange" ? p.document : a, relatedTarget: null, screenX: 11, screenY: 10 });
    assert.equal(event.defaultPrevented, false, type);
    assert.equal(p.timers[0].canceled, true, type); assert.equal(p.observers[0].active, false, type);
    assert.equal(p.tip(), undefined, type);
    if (dispatched) assert.equal(p.ports[0].closed, true, type);
    else { p.timer(0, true); assert.equal(p.ports.length, 0, type); }
  }
});

for (const required of [true, false]) for (const stage of ["dwell", "connected", "completed"]) test(`content-hover: element blur preserves intent; window blur cancels ${required}/${stage}`, async () => {
  for (const isTrusted of [true, false]) {
    const p = createContent({ prefs: { requireAltForHover: required }, beforeLoad: pageBubbleBlockers }); await flush();
    const a = p.anchor(), child = p.child(a); enter(p, a, true);
    if (stage !== "dwell") p.timer();
    if (stage === "completed") p.ports[0].reply(result);
    const before = p.tip();
    const blur = p.document.emit("blur", { target: child, isTrusted });
    assert.equal(blur.bubbles, false); assert.equal(blur.defaultPrevented, false);
    assert.equal(p.timers[0].canceled, false); assert.equal(p.observers[0].active, true);
    assert.equal(p.tip(), before);
    if (stage === "connected") assert.equal(p.ports[0].closed, false);
    p.mouse("mousemove", a, { screenX: 11, altKey: true }); p.key("keydown", { key: "Alt" });
    assert.equal(p.timers.length, 1);
    if (stage === "dwell") { p.timer(); assert.equal(p.ports.length, 1); }
    p.window.emit("blur");
    assert.equal(p.timers[0].canceled, true); assert.equal(p.observers[0].active, false);
    assert.equal(p.ports[0].closed, true); assert.equal(p.tip(), undefined);
    p.key("keydown", { key: "Alt" }); assert.equal(p.timers.length, 1); // Real window blur clears hovered state.
    p.mouse("mousemove", a, { screenX: 12, altKey: true }); assert.equal(p.timers.length, 1);
    p.mouse("mousemove", a, { screenX: 13, altKey: true }); assert.equal(p.timers.length, 2);
  }
});

for (const required of [true, false]) test(`content-hover: element blur preserves first movement baseline ${required}`, async () => {
  const p = createContent({ prefs: { requireAltForHover: required } }); await flush(); const a = p.anchor();
  p.mouse("mouseover", a, { altKey: true }); p.document.emit("blur", { target: a });
  assert.equal(p.timers.length, 0);
  p.mouse("mousemove", a, { screenX: 11, altKey: true }); assert.equal(p.timers.length, 1);
});

test("content-hover: phase fixture models capture, target, bubble and propagation stops", () => {
  const p = createContent({ prefs: { requireAltForHover: true } }), a = p.anchor(), order = [];
  for (const [name, target] of [["window", p.window], ["document", p.document], ["anchor", a]]) {
    for (const capture of [true, false]) target.addEventListener("fixture", (e) => order.push(`${name}:${capture}:${e.eventPhase}`), { capture });
  }
  p.document.emit("fixture", { target: a });
  assert.deepEqual(order, ["window:true:1", "document:true:1", "anchor:true:2", "anchor:false:2", "document:false:3", "window:false:3"]);
  order.length = 0; a.addEventListener("fixture", (e) => e.stopPropagation());
  p.document.emit("fixture", { target: a });
  assert.deepEqual(order, ["window:true:1", "document:true:1", "anchor:true:2", "anchor:false:2"]);
  order.length = 0;
  p.document.emit("fixture", { target: a, bubbles: false });
  assert.deepEqual(order, ["window:true:1", "document:true:1", "anchor:true:2", "anchor:false:2"]);
});

for (const lang of ["en", "zh_TW", "nan-Hanlo"]) test(`content-hover: localized setup priority and real esc in ${lang}`, async () => {
  for (const overrides of [{}, maliciousSetup]) {
    const p = createContent({ prefs: { hoverActivation: "none" } }); await flush();
    const i18n = await loadPreviewLocale(p, lang, overrides), a = p.anchor(); enter(p, a); p.timer();
    p.ports[0].reply({ ok: true, result: setupOnly() });
    const html = p.tip(), dom = panelDom(), rendered = dom.node(); rendered.innerHTML = html;
    assert.ok(rendered.textContent.includes(i18n.t("tipSetupHeading")));
    assert.ok(rendered.textContent.includes(i18n.t("tipSetupBody")));
    assert.ok(!html.includes("tipSetupHeading")); assert.ok(!html.includes("tipSetupBody"));
    for (const tag of ["img", "svg", "a", "button"]) assert.equal(rendered.querySelectorAll(tag).length, 0);
    if (overrides === maliciousSetup) {
      assert.ok(html.includes("&lt;img")); assert.ok(html.includes("&amp;"));
      assert.ok(html.includes('"Heading"')); // Quotes remain safe in text nodes with the actual esc.
    }
    assert.match(p.hosts.get("debait-tooltip").style.cssText, /pointer-events:none/);
  }
});
test("content-hover: invalid intent rejects late setup reply before reading its fields", async () => {
  const p = createContent({ prefs: { hoverActivation: "none" } }); await flush(); const a = p.anchor(); enter(p, a); p.timer();
  a.href = "https://article.example/changed";
  p.ports[0].reply({ ok: true, result: new Proxy({}, { get() { throw new Error("late fields read"); } }) });
  assert.equal(p.tip(), undefined);
});
for (const status of [401, 403, 429, "network"]) test(`content-hover: ${status} worker errors never echo secrets or endpoints`, async () => {
  const p = createContent({ prefs: { hoverActivation: "none" } }); await flush(); const i18n = await loadPreviewLocale(p, "en");
  const a = p.anchor(); enter(p, a); p.timer();
  p.ports[0].reply({ ok: false, error: `${status} sk-SECRET https://endpoint.example private upstream body` });
  assert.ok(p.tip().includes(i18n.t("errGeneric"))); assert.doesNotMatch(p.tip(), /SECRET|https?:|endpoint|upstream|401|403|429/);
});
