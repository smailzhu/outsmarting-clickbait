import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHoverStorage } from "./helpers/hover-storage.js";
import { createPage, lockedControls, deferred } from "./helpers/options-page.js";
import { createWorker, flush } from "./helpers/hover-worker.js";
import { createContent } from "./helpers/content-page.js";
const K = "hoverActivationProvenanceV1";
function writer(backend) {
  const context = vm.createContext({ chrome: { storage: backend.storage }, navigator: backend.navigator });
  for (const file of ["hover-activation.js", "hover-provenance.js"]) vm.runInContext(readFileSync(new URL(`../extension/${file}`, import.meta.url), "utf8"), context);
  return context.DebaitHoverProvenance;
}
const metadata = (backend) => backend.writes.filter((item) => item.area === "local" && Object.hasOwn(item.data, K));
const migrations = (backend) => backend.writes.filter((item) => item.area === "sync");
async function mode(backend) {
  const c = createContent({ sharedStorage: backend }); await flush();
  return vm.runInContext("hoverPolicy", c.context);
}
for (const order of ["options-first", "background-first", "simultaneous"]) test(`hover-provenance.js actual consumers fresh migration before second content/restart ${order}`, async () => {
  const backend = createHoverStorage(); let p, w;
  if (order === "options-first") { p = createPage({ sharedStorage: backend }); await flush(); w = createWorker({ sharedStorage: backend }); }
  else if (order === "background-first") { w = createWorker({ sharedStorage: backend }); await w.context.migrateSettings(); p = createPage({ sharedStorage: backend }); }
  else { p = createPage({ sharedStorage: backend }); w = createWorker({ sharedStorage: backend }); }
  await flush(); await w.context.migrateSettings();
  assert.equal(p.nodes.hoverActivation.value, "shift"); assert.equal(p.nodes.save.disabled, false);
  assert.equal(backend.local[K], "fresh"); assert.equal(metadata(backend).length, 1);
  const firstMigration = backend.writes.findIndex((item) => item.area === "sync");
  assert.ok(firstMigration > backend.writes.findIndex((item) => Object.hasOwn(item.data, K)));
  assert.ok(migrations(backend).every(({ data }) => Object.keys(data).sort().join() === ["profiles", "key", "base", "model"].sort().join()));
  assert.ok(backend.reads.filter((r) => r.area === "sync" && Array.isArray(r.keys)).every((r) => r.keys.join() === "hoverActivation,requireAltForHover,provider,profiles,keys,key,base,model,language,customInstructions,uiLang,previewDwellMs,previewMinIntervalMs,dailyCap"));
  assert.equal((await mode(backend)).mode, "shift");
  const restarted = createWorker({ sharedStorage: backend }); await restarted.context.migrateSettings();
  assert.equal((await mode(backend)).mode, "shift"); assert.equal(metadata(backend).length, 1);
  await backend.storage.sync.set({ profiles: { oldPublished03: {} }, uiLang: "zh_TW" });
  assert.equal((await mode(backend)).mode, "shift", "late published 0.3 evidence-only sync stays locally fresh");
  await backend.storage.sync.set({ requireAltForHover: false }); assert.equal((await mode(backend)).mode, "none");
  await backend.storage.sync.set({ hoverActivation: "alt" }); assert.equal((await mode(backend)).mode, "alt");
  assert.ok(backend.lockCalls.every((call) => call.name === "debait-hover-provenance-v1" && call.mode === "exclusive" && call.origin === "chrome-extension://fixture-extension"));
});
test("hover-provenance.js deferred own event requires post-write raw durability, deduplicated shared lock", async () => {
  const backend = createHoverStorage({ deferEvents: true }); const a = writer(backend), b = writer(backend);
  const one = a.ensureInitialized(); assert.equal(a.ensureInitialized(), one);
  const [ta, tb] = await Promise.all([one, b.ensureInitialized()]);
  assert.equal(a.isApplicable(ta), true); assert.equal(b.isApplicable(tb), true);
  assert.equal(metadata(backend).length, 1); assert.equal(backend.reads.filter((r) => r.area === "local").length, 3);
  backend.flushEvents(); assert.equal(a.isApplicable(ta), true);
  await backend.storage.local.remove([K]); backend.flushEvents(); assert.equal(a.isApplicable(ta), false); assert.equal(b.isApplicable(tb), false);
});
for (const value of ["fresh", "existing", "Fresh", null, undefined, {}, false]) test(`hover-provenance.js preserves present malformed marker ${JSON.stringify(value)}`, async () => {
  const backend = createHoverStorage({ local: { [K]: value }, sync: { requireAltForHover: false } }); const p = writer(backend);
  const token = await p.ensureInitialized(); assert.equal(p.isApplicable(token), true); assert.equal(metadata(backend).length, 0);
  await backend.storage.sync.remove(["requireAltForHover"]);
  assert.equal((await mode(backend)).mode, value === "existing" ? "alt" : "shift");
});
test("hover-provenance.js local/sync/full clear and another-device snapshot limitations", async () => {
  const backend = createHoverStorage(); await writer(backend).ensureInitialized();
  await backend.storage.sync.set({ profiles: {} }); await backend.storage.sync.clear(); assert.equal((await mode(backend)).mode, "shift");
  await backend.storage.sync.set({ profiles: {} }); await backend.storage.local.clear(); assert.equal((await mode(backend)).ready, false);
  await writer(backend).ensureInitialized(); assert.equal(backend.local[K], "existing"); assert.equal((await mode(backend)).mode, "alt");
  await backend.storage.sync.clear(); assert.equal((await mode(backend)).mode, "alt");
  await backend.storage.local.clear(); await writer(backend).ensureInitialized(); assert.equal(backend.local[K], "fresh");
  const another = createHoverStorage({ sync: { profiles: {} } }); await writer(another).ensureInitialized(); assert.equal(another.local[K], "existing");
});
for (const failure of ["locks", "request", "callback", "local-read", "sync-read", "write", "post-write-read"]) test(`hover-provenance.js actual Options locked/worker manual in-memory continuation ${failure}`, async () => {
  const backend = createHoverStorage({ sync: { provider: "custom", key: "", base: "http://localhost:8000/v1", model: "fixture", hoverActivation: "alt", previewMinIntervalMs: 0, dailyCap: 0 }, locks: failure !== "locks",
    beforeGet(area, keys) {
      if (!Array.isArray(keys)) return;
      if (failure === "local-read" && area === "local" || failure === "sync-read" && area === "sync" || failure === "post-write-read" && area === "local" && metadata(backend).length) throw new Error("fixture read");
    }, beforeSet(area, data) { if (failure === "write" && Object.hasOwn(data, K)) throw new Error("fixture write"); } });
  if (failure === "request") backend.navigator.locks.request = () => Promise.reject(new Error("fixture request"));
  if (failure === "callback") backend.navigator.locks.request = async (name, options, fn) => { await fn(); throw new Error("fixture callback rejection"); };
  const w = createWorker({ sharedStorage: backend });
  const manual = await w.manual(); assert.equal(manual.ok, true); assert.equal(manual.result.honest_title, "Fixture");
  const hover = w.port(); hover.start("https://article.example/b"); await flush(); assert.equal(hover.replies[0].ok, true);
  const complete = await new Promise((resolve) => w.runtime.onMessage.emit({ type: "debait:complete", prompt: "fixture" }, {}, resolve));
  assert.equal(complete.ok, true); assert.equal(w.providerCalls.length, 3); assert.equal(w.count(), 2);
  assert.equal(backend.sync.profiles, undefined, "unmigrated legacy credentials remain unpersisted");
  assert.equal(migrations(backend).length, 0); assert.equal(w.providerCalls[0][0].model, "fixture");
  const readCount = backend.reads.length; await w.context.migrateSettings(); await w.context.migrateSettings(); assert.equal(backend.reads.length, readCount, "skip memoized without request retries");
  const p = createPage({ sharedStorage: backend }); await flush(); assert.ok(lockedControls.every((id) => p.nodes[id].disabled));
  assert.equal(p.nodes.status.textContent, "optHoverInitFailed"); assert.equal(p.messages.length, 0); assert.deepEqual(p.consoleOutput, []);
  await p.nodes.save.dispatch("click"); await p.nodes.testConnection.dispatch("click"); assert.equal(migrations(backend).length, 0);
  // Authoritative mode+dwell remains independently usable in content despite writer failure.
  const c = createContent({ sharedStorage: backend }); await flush();
  c.change({ hoverActivation: "alt", previewDwellMs: 500 });
  assert.equal(vm.runInContext("hoverPolicy.ready", c.context), true);
});
test("hover-provenance.js failure memoizes same epoch, fresh context can initialize after failed write", async () => {
  let fail = true;
  const backend = createHoverStorage({ beforeSet: () => { if (fail) throw new Error("write"); } }); const first = writer(backend);
  const attempt = first.ensureInitialized(); await assert.rejects(attempt); fail = false;
  assert.equal(first.ensureInitialized(), attempt); await assert.rejects(first.ensureInitialized());
  await writer(backend).ensureInitialized(); assert.equal(backend.local[K], "fresh"); assert.equal(metadata(backend).length, 1);
});
for (const phase of ["lock", "local-read", "sync-read", "write", "post-write-read"]) test(`hover-provenance.js removal invalidates pending epoch during ${phase}, no repair/migration`, async () => {
  const wait = deferred(); let blocked = false;
  const backend = createHoverStorage({
    beforeGet(area) {
      const eligible = phase === "local-read" && area === "local" || phase === "sync-read" && area === "sync" || phase === "post-write-read" && area === "local" && metadata(backend).length;
      if (eligible && !blocked) { blocked = true; return wait.promise; }
    }, beforeSet(area) { if (phase === "write" && area === "local") { blocked = true; return wait.promise; } } });
  if (phase === "lock") { const request = backend.navigator.locks.request; backend.navigator.locks.request = (name, options, fn) => request(name, options, async () => { blocked = true; await wait.promise; return fn(); }); }
  const w = createWorker({ sharedStorage: backend }); await flush(); assert.equal(blocked, true);
  backend.emit({ [K]: {} }, "local"); delete backend.local[K];
  wait.resolve(); await w.context.migrateSettings(); await flush();
  assert.equal(migrations(backend).length, 0);
  assert.ok(metadata(backend).length <= (phase === "write" || phase === "post-write-read" ? 1 : 0));
  const attempts = backend.attempts.length; await w.context.migrateSettings(); assert.equal(backend.attempts.length, attempts);
});
test("hover-provenance.js cached token invalidates during provider read, Options readiness and Save", async () => {
  const wait = deferred();
  const backend = createHoverStorage({ beforeGet: (area, keys) => area === "sync" && !Array.isArray(keys) ? wait.promise : undefined });
  const w = createWorker({ sharedStorage: backend }); await flush(); const migration = w.context.migrateSettings(); await flush();
  await backend.storage.local.remove([K]); wait.resolve(); await migration; assert.equal(migrations(backend).length, 0);
  const optionsWait = deferred(); const p = createPage({ initial: {}, beforeUsage: () => optionsWait.promise }); await flush();
  await p.backend.storage.local.remove([K]); optionsWait.resolve(); await flush();
  assert.ok(lockedControls.every((id) => p.nodes[id].disabled)); assert.equal(p.nodes.status.textContent, "optHoverInitFailed");
});
test("hover-provenance.js classification merges only newer relevant fields and respects marker arrival just before write", async () => {
  for (const arrival of ["evidence", "marker", "removal"]) {
    const wait = deferred(); const backend = createHoverStorage({ beforeGet: (area) => area === "sync" ? wait.promise : undefined }); const p = writer(backend);
    const attempt = p.ensureInitialized(); await flush();
    if (arrival === "evidence") await backend.storage.sync.set({ uiLang: null });
    else if (arrival === "marker") await backend.storage.local.set({ [K]: "malformed-preserved" });
    else backend.emit({ [K]: {} }, "local");
    wait.resolve();
    if (arrival === "removal") { await assert.rejects(attempt); assert.equal(metadata(backend).length, 0); }
    else { await attempt; assert.equal(backend.local[K], arrival === "evidence" ? "existing" : "malformed-preserved"); assert.equal(metadata(backend).length, 1); }
  }
});

test("hover-provenance.js missing post-write durable read fails without fabricating presence or repair", async () => {
  const backend = createHoverStorage({ deferEvents: true, beforeGet(area) {
    if (area === "local" && metadata(backend).length) delete backend.local[K];
  } });
  // Snapshot is captured at invocation. Remove in the set completion seam so the
  // next raw get sees absence; own onChanged is deliberately still deferred.
  const set = backend.storage.local.set;
  backend.storage.local.set = async (data) => { await set(data); delete backend.local[K]; };
  const p = writer(backend); const attempt = p.ensureInitialized(); await assert.rejects(attempt);
  assert.equal(p.isApplicable(null), false); assert.equal(metadata(backend).length, 1);
  assert.equal(p.ensureInitialized(), attempt); await assert.rejects(p.ensureInitialized());
  assert.equal(metadata(backend).length, 1);
});
test("hover-provenance.js rejected initializer never leaks success if callback ran before lock rejection", async () => {
  const backend = createHoverStorage(); const request = backend.navigator.locks.request;
  backend.navigator.locks.request = (name, options, callback) => request(name, options, async () => { await callback(); throw new Error("lock result"); });
  const p = writer(backend); const attempt = p.ensureInitialized(); await assert.rejects(attempt);
  assert.equal(p.ensureInitialized(), attempt); await assert.rejects(p.ensureInitialized()); assert.equal(metadata(backend).length, 1);
  const options = createPage({ sharedStorage: backend }); await flush(); assert.equal(options.nodes.save.disabled, true);
  assert.equal(migrations(backend).length, 0);
});
test("hover-provenance.js failed worker startup with no authoritative preference leaves automatic hover blocked, manual available", async () => {
  const backend = createHoverStorage({ sync: { provider: "custom", key: "", base: "http://localhost:8000/v1", model: "fixture", dailyCap: 0, previewMinIntervalMs: 0 }, locks: false });
  const w = createWorker({ sharedStorage: backend }); const manual = await w.manual(); assert.equal(manual.ok, true);
  const c = createContent({ sharedStorage: backend }); await flush(); const a = c.anchor();
  c.mouse("mouseover", a); c.key("keydown", { key: "Shift" }); c.mouse("mousemove", a, { screenX: 11, shiftKey: true }); c.timer();
  assert.equal(c.ports.length, 0); assert.equal(c.timers.length, 0); assert.equal(migrations(backend).length, 0); assert.equal(metadata(backend).length, 0);
});
for (const readArea of ["sync", "local"]) test(`options.js failed independent initial ${readArea} read remains locked with reload guidance`, async () => {
  let localReads = 0, syncReads = 0;
  const backend = createHoverStorage({ sync: { hoverActivation: "shift" }, local: { [K]: "fresh" }, beforeGet(area, keys) {
    if (!Array.isArray(keys)) return;
    if (area === "local" && ++localReads === 2 && readArea === "local" || area === "sync" && ++syncReads === 1 && readArea === "sync") throw new Error("Options initial raw read");
  } });
  const p = createPage({ sharedStorage: backend }); await flush();
  assert.ok(lockedControls.every((id) => p.nodes[id].disabled)); assert.equal(p.nodes.status.textContent, "optHoverInitFailed"); assert.equal(migrations(backend).length, 0);
});
test("options.js marker removed before Save invocation preserves unsaved draft/baseline and forbids persistence or retries", async () => {
  const p = createPage(); await flush(); const baseline = vm.runInContext("canonical(baseline)", p.context);
  await p.selectActivation("none"); await p.backend.storage.local.remove([K]);
  const attempts = p.backend.attempts.length;
  await p.nodes.save.dispatch("click"); await p.nodes.discard.dispatch("click"); await p.nodes.testConnection.dispatch("click");
  assert.equal(p.backend.attempts.length, attempts); assert.equal(p.nodes.hoverActivation.value, "none");
  assert.equal(vm.runInContext("canonical(baseline)", p.context), baseline); assert.equal(vm.runInContext("dirty", p.context), true);
  assert.equal(p.nodes.status.textContent, "optHoverInitFailed"); assert.equal(p.messages.length, 0);
});

test("options.js per-field events during delayed actual initial raw sync read project newest mode/dwell without defaults evidence", async () => {
  const wait = deferred(); let reads = 0;
  const backend = createHoverStorage({ sync: {}, local: { [K]: "fresh" }, beforeGet(area, keys) {
    if (area === "sync" && Array.isArray(keys) && ++reads === 1) return wait.promise;
  } });
  const p = createPage({ sharedStorage: backend }); await flush();
  await backend.storage.sync.set({ hoverActivation: "none", previewDwellMs: 0, uiLang: "zh_TW" });
  wait.resolve(); await flush();
  assert.equal(p.nodes.hoverActivation.value, "none"); assert.equal(p.nodes.previewDwellMs.value, "0");
  assert.equal(p.nodes.save.disabled, false); assert.equal(p.nodes.status.textContent, ""); assert.equal(backend.local[K], "fresh");
  assert.ok(p.writes.every((data) => !Object.hasOwn(data, "hoverActivation")));
});
test("options.js local epoch invalidation during actual raw read forbids migration and ready baseline", async () => {
  const wait = deferred(); let localReads = 0;
  const backend = createHoverStorage({ local: { [K]: "fresh" }, beforeGet(area) {
    if (area === "local" && ++localReads === 2) return wait.promise;
  } });
  const p = createPage({ sharedStorage: backend }); await flush(); await backend.storage.local.remove([K]); wait.resolve(); await flush();
  assert.equal(migrations(backend).length, 0); assert.equal(vm.runInContext("baseline", p.context), null);
  assert.equal(p.nodes.save.disabled, true); assert.equal(p.nodes.status.textContent, "optHoverInitFailed");
});
