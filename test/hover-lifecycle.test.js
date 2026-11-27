import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorker, deferred, flush } from "./helpers/hover-worker.js";
import { createContent, bridge } from "./helpers/content-page.js";
import { loadPreviewLocale } from "./helpers/preview-locales.js";

for (const stage of ["headers", "body", "usage", "reservation"]) for (const mutation of ["href-revert", "remove-reinsert", "base"]) {
  test(`content-hover: active ${mutation} cancellation propagates during ${stage}`, async () => {
    const wait = deferred(); const option = { headers: "headers", body: "body", usage: "usageGet", reservation: "reservation" }[stage];
    const worker = createWorker({ [option]: () => wait.promise }); const ipc = bridge(worker);
    const page = createContent({ prefs: { requireAltForHover: true }, connect: ipc.connect }); await flush(); const a = page.anchor("relative");
    page.mouse("mouseover", a, { altKey: true }); page.mouse("mousemove", a, { screenX: 11, altKey: true }); page.timer(); ipc.flush(); await flush();
    assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 0);
    if (mutation === "href-revert") page.mutate([{ type: "attributes", target: a, attributeName: "href" }]);
    if (mutation === "remove-reinsert") page.mutate([{ type: "childList", removedNodes: [a] }]);
    if (mutation === "base") { page.setBase("https://changed.example/"); page.mutate([{ type: "attributes", target: {}, attributeName: "href" }]); }
    const job = [...worker.inspect.inflight.values()][0];
    ipc.flush(); assert.equal(job.abort.signal.aborted, true);
    if (["headers", "body"].includes(stage)) assert.equal(worker.fetchCalls[0].options.signal.aborted, true);
    wait.resolve(); await flush(); ipc.flush(); assert.equal(worker.providerCalls.length, 0); assert.equal(page.tip(), undefined);
    assert.equal(worker.count(), stage === "reservation" ? 1 : 0); assert.equal(worker.inspect.busy(), false);
    assert.ok(page.observers.every((o) => !o.active)); assert.equal(worker.inspect.inflight.size, 0);
  });
}
for (const required of [true, false]) for (const lifecycle of ["scroll", "pointerdown", "contextmenu", "blur", "hidden", "pagehide", "setting", "mouseout"]) {
  test(`content-hover: coupled ${lifecycle} cancellation and stationary layout gate ${required}`, async () => {
    const wait = deferred(); const worker = createWorker({ body: () => wait.promise }); const ipc = bridge(worker);
    const page = createContent({ prefs: { requireAltForHover: required }, connect: ipc.connect }); await flush(); const a = page.anchor();
    page.mouse("mouseover", a, { altKey: true }); page.mouse("mousemove", a, { screenX: 11, altKey: true }); page.timer(); ipc.flush(); await flush();
    if (lifecycle === "hidden") { page.document.visibilityState = "hidden"; page.document.emit("visibilitychange"); page.document.visibilityState = "visible"; }
    else if (lifecycle === "setting") page.change({ previewDwellMs: 0 });
    else if (["pointerdown", "contextmenu", "mouseout"].includes(lifecycle)) page.document.emit(lifecycle, { target: a, screenX: 11, screenY: 10 });
    else page.window.emit(lifecycle);
    ipc.flush(); const b = page.anchor("https://article.example/b");
    for (const type of ["mouseover", "mousemove", "mousemove", "mouseover"]) page.mouse(type, b, { screenX: 11, clientX: 800, altKey: true });
    assert.equal(page.timers.length, 1); wait.resolve(); await flush(); ipc.flush(); assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 0);
    assert.equal(page.tip(), undefined);
    page.mouse("mousemove", b, { screenX: 12, altKey: true }); assert.equal(page.timers.length, 2); page.timer(); ipc.flush(); await flush(); ipc.flush();
    assert.equal(worker.providerCalls.length, 1); assert.ok(page.tip().includes("Fixture"));
  });
}
for (const required of [true, false]) test(`content-hover: element blur retains worker interest; window blur withdraws it ${required}`, async () => {
  const wait = deferred(), worker = createWorker({ body: () => wait.promise }), ipc = bridge(worker);
  const page = createContent({ prefs: { requireAltForHover: required }, connect: ipc.connect }); await flush();
  const a = page.anchor(), child = page.child(a);
  page.mouse("mouseover", a, { altKey: true }); page.mouse("mousemove", a, { screenX: 11, altKey: true });
  page.timer(); ipc.flush(); await flush();
  const job = [...worker.inspect.inflight.values()][0], before = page.tip();
  for (const isTrusted of [true, false]) {
    page.document.emit("blur", { target: child, isTrusted }); ipc.flush();
    assert.equal(page.ports[0].closed, false); assert.equal(job.abort.signal.aborted, false);
    assert.equal(worker.fetchCalls[0].options.signal.aborted, false);
    assert.equal(worker.inspect.inflight.size, 1); assert.equal(page.tip(), before);
  }
  page.window.emit("blur"); ipc.flush();
  assert.equal(page.ports[0].closed, true); assert.equal(job.abort.signal.aborted, true);
  assert.equal(worker.fetchCalls[0].options.signal.aborted, true); assert.equal(worker.inspect.inflight.size, 0);
  wait.resolve(); await flush(); ipc.flush();
  assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 0);
  assert.equal(worker.count(), 0); assert.equal(worker.inspect.busy(), false); assert.equal(page.tip(), undefined);
});

test("hover-worker: IPC dispatch boundary is observed, not instantaneous client reversal", async () => {
  const wait = deferred(); const worker = createWorker({ reservation: () => wait.promise }); const ipc = bridge(worker);
  const page = createContent({ prefs: { requireAltForHover: true }, connect: ipc.connect }); await flush(); const a = page.anchor();
  page.mouse("mouseover", a); page.key("keydown", { key: "Alt" }); page.timer(); ipc.flush(); await flush();
  page.key("keyup", { key: "Alt" }); // Disconnect deliberately stays in IPC transit.
  wait.resolve(); await flush(); assert.equal(worker.providerCalls.length, 1); assert.equal(worker.count(), 1);
  ipc.flush(); await flush(); ipc.flush(); assert.equal(page.tip(), undefined); assert.equal(worker.inspect.CACHE.size, 1);
});

for (const event of ["mouseout", "pointerdown", "contextmenu", "scroll", "blur", "pagehide"]) test(`content-hover: canceled dwell ${event} causes zero worker requests`, async () => {
  const worker = createWorker(); const ipc = bridge(worker); const page = createContent({ prefs: { requireAltForHover: true }, connect: ipc.connect }); await flush(); const a = page.anchor();
  page.mouse("mouseover", a); page.key("keydown", { key: "Alt" });
  if (["mouseout", "pointerdown", "contextmenu"].includes(event)) page.document.emit(event, { target: a, relatedTarget: null, screenX: 10, screenY: 10 });
  else page.window.emit(event);
  page.timer(0, true); ipc.flush(); await flush(); assert.equal(page.ports.length, 0); assert.equal(worker.fetchCalls.length, 0); assert.equal(worker.providerCalls.length, 0); assert.equal(worker.writes.length, 0);
});

for (const type of ["keyup", "mouseout", "pointerdown"]) test(`content-hover: captured ${type} withdraws worker interest despite page bubble stopPropagation`, async () => {
  const wait = deferred(), worker = createWorker({ body: () => wait.promise }), ipc = bridge(worker);
  const page = createContent({ prefs: { requireAltForHover: true }, connect: ipc.connect, beforeLoad({ document, window }) {
    document.addEventListener(type, (e) => e.stopPropagation());
    window.addEventListener(type, (e) => e.stopImmediatePropagation());
  } });
  await flush(); const a = page.anchor();
  page.mouse("mouseover", a, { altKey: true }); page.mouse("mousemove", a, { screenX: 11, altKey: true }); page.timer(); ipc.flush(); await flush();
  assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 0);
  const job = [...worker.inspect.inflight.values()][0];
  const event = type === "keyup" ? page.key(type, { key: "Alt", target: a }) :
    page.document.emit(type, { target: a, relatedTarget: null, screenX: 11, screenY: 10 });
  assert.equal(event.defaultPrevented, false); assert.equal(page.ports[0].closed, true);
  ipc.flush(); assert.equal(job.abort.signal.aborted, true); assert.equal(worker.fetchCalls[0].options.signal.aborted, true);
  wait.resolve(); await flush(); ipc.flush();
  assert.equal(worker.providerCalls.length, 0); assert.equal(worker.count(), 0); assert.equal(worker.inspect.inflight.size, 0);
  assert.equal(worker.inspect.busy(), false); assert.equal(page.tip(), undefined);
});

// Real Options Save, shared raw storage and queued hover IPC: mode changes are
// not provider configuration changes once first-Save normalization has settled.
for (const [from, to] of [["shift", "alt"], ["alt", "shift"], ["shift", "none"], ["none", "alt"]]) {
  test(`options.js mode-only Save preserves actual worker warm cache ${from}->${to}`, async () => {
    const { createPage } = await import("./helpers/options-page.js");
    const worker = createWorker({ initial: { hoverActivation: from, requireAltForHover: from !== "none", language: "", customInstructions: "", uiLang: "" } });
    const options = createPage({ sharedStorage: worker.backend }); await flush(); await worker.context.migrateSettings();
    // Explicit baseline Save settles normal profile/key-map mirrors BEFORE cache warming.
    await options.nodes.save.click(); await flush();
    const beforeFields = structuredClone(worker.store);
    const first = await worker.manual(); assert.equal(first.ok, true);
    const entry = [...worker.inspect.CACHE.values()][0], at = entry.at, cachedResult = entry.result;
    const before = { generation: worker.inspect.generation(), fetch: worker.fetchCalls.length, provider: worker.providerCalls.length, count: worker.count() };
    worker.setClock(101000);
    const events = []; worker.backend.storage.onChanged.addListener((changes, area) => { if (area === "sync") events.push(structuredClone(changes)); });
    await options.selectActivation(to); await options.nodes.save.click(); await flush();
    assert.deepEqual(worker.store, { ...beforeFields, hoverActivation: to, requireAltForHover: to !== "none" });
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]).sort(), (from === "none" || to === "none" ? ["hoverActivation", "requireAltForHover"] : ["hoverActivation"]).sort());
    const next = await worker.manual(); assert.equal(next.ok, true);
    assert.deepEqual({ generation: worker.inspect.generation(), fetch: worker.fetchCalls.length, provider: worker.providerCalls.length, count: worker.count() }, before);
    assert.equal([...worker.inspect.CACHE.values()][0].at, at); assert.equal([...worker.inspect.CACHE.values()][0].result, cachedResult);
    const restarted = createWorker({ sharedStorage: worker.backend }); assert.equal(restarted.inspect.CACHE.size, 0, "restart loses in-memory cache");
  });
}
for (const from of ["shift", "alt", "none"]) test(`options.js mode Save cancels hover without losing shared manual preparation owner ${from}`, async () => {
  const { createPage } = await import("./helpers/options-page.js"); const wait = deferred();
  const worker = createWorker({ initial: { hoverActivation: from }, body: () => wait.promise });
  const options = createPage({ sharedStorage: worker.backend }); await flush(); await options.nodes.save.click();
  const ipc = bridge(worker), content = createContent({ sharedStorage: worker.backend, connect: ipc.connect }); await flush(); const a = content.anchor();
  content.mouse("mouseover", a); content.mouse("mousemove", a, { screenX: 11, shiftKey: from === "shift", altKey: from === "alt" }); content.timer(); ipc.flush(); await flush();
  const manual = worker.manual(a.href); await flush(); const job = [...worker.inspect.inflight.values()][0];
  assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 0);
  await options.selectActivation(from === "none" ? "shift" : "none"); await options.nodes.save.click(); ipc.flush();
  assert.equal(content.ports[0].closed, true); assert.equal(job.abort.signal.aborted, false); assert.equal(worker.inspect.inflight.size, 1);
  wait.resolve(); const response = await manual; await flush(); ipc.flush();
  assert.equal(response.ok, true); assert.equal(response.result.honest_title, "Fixture");
  assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 1); assert.equal(worker.count(), 1); assert.equal(content.tip(), undefined);
});
test("options.js first Save normalizing key-map fields may legitimately invalidate existing worker cache", async () => {
  const { createPage } = await import("./helpers/options-page.js"); const worker = createWorker();
  const options = createPage({ sharedStorage: worker.backend }); await flush(); await worker.manual();
  assert.equal(worker.inspect.CACHE.size, 1); const generation = worker.inspect.generation();
  await options.selectActivation("shift"); await options.nodes.save.click(); await flush();
  assert.ok(worker.inspect.generation() > generation); assert.equal(worker.inspect.CACHE.size, 0);
});

for (const dwell of [0, 500]) test(`content.js stationary Shift typing never opens worker port or contacts target at dwell ${dwell}`, async () => {
  for (const subsequent of [null, "a", "Tab", "ArrowDown"]) {
    const worker = createWorker({ initial: { hoverActivation: "shift", previewDwellMs: dwell } }); await worker.context.migrateSettings();
    const ipc = bridge(worker), content = createContent({ sharedStorage: worker.backend, connect: ipc.connect }); await flush(); const a = content.anchor();
    content.mouse("mouseover", a); content.key("keydown", { key: "Shift" });
    if (subsequent) content.key("keydown", { key: subsequent, shiftKey: true });
    content.mouse("mousemove", a, { screenX: 10, shiftKey: true }); content.timer(); ipc.flush(); await flush();
    assert.equal(content.timers.length, 0); assert.equal(content.ports.length, 0);
    assert.equal(worker.fetchCalls.length, 0); assert.equal(worker.providerCalls.length, 0); assert.equal(worker.count(), 0);
  }
});

for (const lang of ["en", "zh_TW", "nan-Hanlo"]) test(`content-hover: coupled ${lang} setup is no-fetch, transient and recovers after Save`, async () => {
  const worker = createWorker({ initial: { provider: "openai", profiles: { openai: {} } } }), ipc = bridge(worker);
  const page = createContent({ prefs: { hoverActivation: "none", previewDwellMs: 0 }, connect: ipc.connect }); await flush();
  const i18n = await loadPreviewLocale(page, lang), a = page.anchor();
  page.mouse("mouseover", a); page.mouse("mousemove", a, { screenX: 11 }); page.timer(); ipc.flush(); await flush(); ipc.flush();
  assert.ok(page.tip().includes(i18n.t("tipSetupHeading"))); assert.ok(page.tip().includes(i18n.t("tipSetupBody")));
  page.document.emit("mouseout", { target: a, relatedTarget: null }); assert.equal(page.tip(), undefined);
  page.mouse("mousemove", a, { screenX: 12 }); page.timer(); ipc.flush(); await flush(); ipc.flush();
  assert.ok(page.tip().includes(i18n.t("tipSetupBody"))); assert.equal(worker.fetchCalls.length, 0); assert.equal(worker.providerCalls.length, 0);
  assert.equal(worker.backend.reads.filter((r) => r.area === "local" && Object.hasOwn(r.keys, "debaitUsage")).length, 0);
  assert.equal(worker.backend.attempts.filter((w) => Object.hasOwn(w.data, "debaitUsage")).length, 0);
  assert.equal(worker.inspect.CACHE.size, 0); assert.equal(worker.inspect.busy(), false); assert.equal(worker.inspect.interval(), 0);
  await worker.backend.storage.sync.set({ profiles: { openai: { key: "fixture" } } });
  page.document.emit("mouseout", { target: a, relatedTarget: null }); page.mouse("mousemove", a, { screenX: 13 });
  page.timer(); ipc.flush(); await flush(); ipc.flush();
  assert.ok(page.tip().includes("Fixture")); assert.equal(worker.fetchCalls.length, 1); assert.equal(worker.providerCalls.length, 1); assert.equal(worker.count(), 1);
});
