import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createWorker, deferred, flush } from "./helpers/hover-worker.js";
const url = "https://article.example/a";

test("hover-port: sender and schema restrictions", async () => {
  const p = createWorker();
  const sender = { id: p.runtime.id, tab: { id: 1 }, frameId: 0, url: "https://page.example/" };
  for (const options of [{ name: "other" }, ...[{ id: "other" }, { tab: null }, { tab: { id: 1.5 } }, { frameId: undefined },
    { frameId: 1 }, { url: "chrome-extension://fixture/options.html" }, { url: "file:///a" }, { url: "invalid" }].map((s) => ({ sender: { ...sender, ...s } }))]) {
    const port = p.port(options); port.start(); assert.equal(port.closed, true); assert.equal(port.replies.length, 1);
    assert.equal(port.replies[0].ok, false); assert.equal(port.onMessage.all.size, 0);
  }
  for (const message of [null, [], "start", {}, { type: "other", url }, { type: "start", url: "file:///a" },
    { type: "start", url: "bad" }, { type: "start", url, owner: 1 }, { type: "start", url, cancel: true }]) {
    const port = p.port(); port.onMessage.emit(message); assert.equal(port.closed, true); assert.equal(port.replies[0].error, "errGeneric");
  }
  p.port().disconnect(); await flush(); assert.equal(p.fetchCalls.length, 0); assert.equal(p.providerCalls.length, 0); assert.equal(p.inspect.inflight.size, 0);
});

for (const stage of ["init", "migration"]) test(`hover-worker: disconnect during cold ${stage}`, async () => {
  const wait = deferred(); const p = createWorker(stage === "init" ? { init: () => wait.promise } : { migrationSet: () => wait.promise });
  const port = p.port(); port.start(); if (stage === "migration") await flush();
  port.disconnect(); wait.resolve(); await flush();
  assert.equal(p.fetchCalls.length, 0); assert.equal(p.providerCalls.length, 0); assert.equal(port.onMessage.all.size, 0);
});
for (const stage of ["init", "migration"]) test(`hover-worker: canceled cold ${stage} rejection is caught`, async () => {
  const wait = deferred(); const p = createWorker(stage === "init" ? { init: () => wait.promise } : { migrationSet: () => wait.promise });
  const port = p.port(); port.start(); await flush(); port.disconnect(); wait.reject(new Error("SECRET")); await flush();
  assert.equal(port.replies.length, 0); assert.equal(p.providerCalls.length, 0);
});
test("hover-worker: migration changes do not stale the first wanted hover or manual", async () => {
  for (const manual of [false, true]) {
    const p = createWorker(); const port = manual ? null : p.port(); const result = manual ? p.manual() : (port.start(), null);
    await flush(); const reply = manual ? await result : port.replies[0];
    assert.equal(reply.ok, true); assert.equal(reply.result.honest_title, "Fixture"); assert.equal(p.count(), 1);
  }
});
test("hover-port: duplicate timing has no additional work", async () => {
  const wait = deferred(); const p = createWorker({ init: () => wait.promise }); const a = p.port(); a.start(); a.start(); wait.resolve(); await flush();
  assert.equal(p.fetchCalls.length, 0); assert.equal(p.providerCalls.length, 0); assert.equal(a.replies.length, 1);
  const headers = deferred(); const later = createWorker({ headers: () => headers.promise });
  const b = later.port(), c = later.port({ sender: { id: later.runtime.id, tab: { id: 2 }, frameId: 0, url: "https://page.example/" } });
  b.start(); c.start(); await flush(); b.start(); assert.equal(later.fetchCalls.length, 1); assert.equal(later.fetchCalls[0].options.signal.aborted, false);
  headers.resolve(); await flush(); assert.equal(later.providerCalls.length, 1); assert.equal(c.replies[0].ok, true);
});
for (const stage of ["settings", "headers", "body", "usage"]) test(`hover-worker: checkpoint cancellation after ${stage} leaves interval and quota untouched`, async () => {
  const wait = deferred();
  const options = stage === "settings" ? { syncGet: (index) => index === 2 ? wait.promise : undefined }
    : stage === "headers" ? { headers: () => wait.promise } : stage === "body" ? { body: () => wait.promise } : { usageGet: () => wait.promise };
  const p = createWorker(options); const port = p.port(); port.start(); await flush(); const old = [...p.inspect.inflight.values()][0];
  port.disconnect(); assert.equal(p.inspect.inflight.size, 0); assert.equal(p.inspect.busy(), false); assert.equal(old.canceled, true);
  assert.equal(old.abort.signal.aborted, true);
  if (["headers", "body"].includes(stage)) assert.equal(p.fetchCalls[0].options.signal.aborted, true);
  wait.resolve(); await flush(); assert.equal(p.providerCalls.length, 0); assert.equal(p.writes.length, 0); assert.equal(p.inspect.interval(), 0);
  const next = await p.manual(); assert.equal(next.result.honest_title, "Fixture"); assert.equal(p.count(), 1);
  assert.ok(p.timers.every((timer) => timer.canceled));
});
for (const order of ["hover-first", "manual-first", "two-tabs"]) test(`hover-worker: owner isolation ${order}`, async () => {
  const wait = deferred(); const p = createWorker({ headers: () => wait.promise });
  const a = p.port(); let result, b;
  if (order === "hover-first") { a.start(); await flush(); result = p.manual(); }
  if (order === "manual-first") { result = p.manual(); await flush(); a.start(); }
  if (order === "two-tabs") { a.start(); b = p.port({ sender: { id: p.runtime.id, tab: { id: 2 }, frameId: 0, url: "https://page.example/" } }); b.start(); }
  await flush(); assert.equal([...p.inspect.inflight.values()][0].subscribers.size, 2);
  a.disconnect(); assert.equal(p.fetchCalls[0].options.signal.aborted, false); wait.resolve(); await flush();
  const reply = result ? await result : b.replies[0]; assert.equal(reply.ok, true); assert.equal(reply.result.honest_title, "Fixture");
  assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1); assert.equal(p.count(), 1); assert.equal(a.replies.length, 0);
});
for (const replacement of ["manual", "hover"]) test(`hover-worker: canceled replacement ${replacement} is identity safe during usage`, async () => {
  const oldRead = deferred(), newRead = deferred(); let reads = 0;
  const p = createWorker({ usageGet: () => ++reads === 1 ? oldRead.promise : newRead.promise });
  const a = p.port(); a.start(); await flush(); const old = [...p.inspect.inflight.values()][0]; a.disconnect();
  const b = replacement === "hover" ? p.port() : null; const result = b ? (b.start(), null) : p.manual(); await flush();
  const current = [...p.inspect.inflight.values()][0]; assert.notEqual(old, current); assert.equal(p.inspect.busy(), true);
  oldRead.resolve(); await flush(); assert.equal(p.inspect.inflight.get(current.key), current); assert.equal(p.inspect.busy(), true);
  newRead.resolve(); await flush(); assert.equal((result ? await result : b.replies[0]).ok, true); assert.equal(p.count(), 1); assert.equal(p.inspect.busy(), false);
});
for (const interval of [0, 1000]) test(`hover-worker: reservation cancellation remains conservative interval ${interval}`, async () => {
  const wait = deferred(); const p = createWorker({ reservation: () => wait.promise, initial: { previewMinIntervalMs: interval } });
  const a = p.port(); a.start(); await flush(); a.disconnect();
  assert.equal(p.inspect.busy(), true); assert.equal(p.inspect.inflight.size, 0); assert.equal(p.inspect.interval(), 100000);
  assert.equal((await p.manual("https://article.example/b")).result.throttled, true);
  wait.resolve(); await flush(); assert.equal(p.count(), 1); assert.equal(p.providerCalls.length, 0); assert.equal(p.inspect.busy(), false); assert.equal(p.inspect.CACHE.size, 0);
  const next = await p.manual(); assert.equal(next.result.throttled === true, interval > 0); assert.equal(p.providerCalls.length, interval > 0 ? 0 : 1);
});
test("hover-worker: dispatch boundary and abandoned post-dispatch cache", async () => {
  const wait = deferred(); const p = createWorker({ provider: () => wait.promise }); const a = p.port(); a.start(); await flush();
  assert.equal([...p.inspect.inflight.values()][0].dispatched, true); a.disconnect(); assert.equal(p.inspect.inflight.size, 1);
  // The completed target fetch is closed; provider work itself is not aborted.
  assert.equal(p.fetchCalls[0].options.signal.aborted, true);
  const b = p.port(); b.start(); await flush(); b.start(); assert.equal(p.providerCalls.length, 1); assert.equal(p.inspect.inflight.size, 1);
  wait.resolve('{"honest_title":"Fixture"}'); await flush(); assert.equal(p.inspect.CACHE.size, 1); assert.equal(p.count(), 1);
  const next = await p.manual(); assert.equal(next.result.honest_title, "Fixture"); assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1);
});
for (const stage of ["usage", "reservation"]) for (const sync of [false, true]) test(`hover-worker: ${stage} ${sync ? "throw" : "rejection"} fails closed`, async () => {
  const fail = () => { if (sync) throw new Error("SECRET quota 429"); return Promise.reject(new Error("SECRET quota 429")); };
  const p = createWorker(stage === "usage" ? { usageGet: fail } : { reservation: fail }); const a = p.port(); a.start(); await flush();
  assert.equal(a.replies[0].ok, false); assert.equal(a.replies[0].error, "errGeneric"); assert.equal(p.providerCalls.length, 0); assert.equal(p.inspect.busy(), false); assert.equal(p.inspect.CACHE.size, 0);
  assert.equal(p.inspect.interval(), stage === "reservation" ? 100000 : 0);
  // Storage failures are not provider 429 cooldowns.
  const next = await p.manual("https://article.example/b"); assert.equal(next.ok, false);
});
test("hover-worker: failed, stale and canceled work is not cached; hover toggle does not invalidate", async () => {
  const wait = deferred(); const p = createWorker({ provider: () => wait.promise }); const a = p.port(); a.start(); await flush();
  p.change({ requireAltForHover: false, previewDwellMs: 0 }); wait.resolve('{"honest_title":"Fixture"}'); await flush(); assert.equal(a.replies[0].ok, true); assert.equal(p.inspect.CACHE.size, 1);
  const staleWait = deferred(); const q = createWorker({ provider: () => staleWait.promise }); const b = q.port(); b.start(); await flush();
  q.change({ language: "English" }); staleWait.resolve('{"honest_title":"stale"}'); await flush(); assert.equal(b.replies[0].result.stale, true); assert.equal(q.inspect.CACHE.size, 0);
  const failed = createWorker({ provider: () => { throw new Error("SECRET"); } }); const c = failed.port(); c.start(); await flush(); assert.equal(c.replies[0].ok, false); assert.equal(failed.inspect.CACHE.size, 0); assert.equal(failed.count(), 1);
});
test("hover-worker: postMessage failure cleans only that port; manual error contract remains", async () => {
  const wait = deferred(); const p = createWorker({ provider: () => wait.promise }); const a = p.port({ postThrows: true }); a.start(); const manual = p.manual(); await flush();
  wait.resolve('{"honest_title":"Fixture"}'); assert.equal((await manual).ok, true); await flush(); assert.equal(a.closed, true); assert.equal(a.onDisconnect.all.size, 0);
  const fail = createWorker({ init: () => { throw new Error("startup"); } }); const response = await fail.manual(); assert.deepEqual(structuredClone(response), { ok: false, error: "startup" });
});

for (const stage of ["headers", "body"]) test(`hover-worker: wanted target ${stage} timeout errors and cleans signal/timer`, async () => {
  let signal, aborts = 0;
  const stalled = (s) => new Promise((_, reject) => {
    signal = s; s.addEventListener("abort", () => { aborts++; reject(new Error("target timeout")); }, { once: true });
  });
  const p = createWorker(stage === "headers" ? { headers: stalled } : { body: stalled });
  const a = p.port(); a.start(); await flush(); assert.equal(p.timers.length, 1); assert.equal(p.timers[0].ms, 15000);
  assert.equal(p.fetchCalls[0].options.credentials, "omit"); assert.equal(p.fetchCalls[0].options.redirect, "follow");
  p.timers[0].fn(); await flush(); assert.equal(aborts, 1); assert.equal(signal.aborted, true); assert.equal(a.replies[0].ok, false);
  assert.equal(p.providerCalls.length, 0); assert.equal(p.count(), 0); assert.ok(p.timers[0].canceled); assert.equal(p.inspect.busy(), false);
});
test("hover-worker: target abort listener is removed after body completion", async () => {
  const wait = deferred(); const p = createWorker({ usageGet: () => wait.promise }); const a = p.port(); a.start(); await flush();
  const job = [...p.inspect.inflight.values()][0]; a.disconnect(); assert.equal(job.abort.signal.aborted, true);
  // Full target body already finished: local cleanup closes it and removes the
  // linked listener. The job's later abort does not affect provider transport.
  assert.equal(p.fetchCalls[0].options.signal.aborted, true); assert.ok(p.timers[0].canceled); wait.resolve(); await flush();
  assert.equal(p.providerCalls.length, 0);
});
test("hover-worker: stale headers checkpoint aborts unread target body without provider work", async () => {
  const wait = deferred();
  let bodyReads = 0;
  const p = createWorker({ fetchImpl: async () => {
    await wait.promise;
    return { ok: true, headers: { get: () => "text/html" }, text: async () => { bodyReads++; return "unused"; } };
  } });
  const port = p.port(); port.start(); await flush();
  p.change({ language: "English" });
  wait.resolve(); await flush();
  assert.equal(port.replies[0].result.stale, true);
  assert.equal(p.fetchCalls[0].options.signal.aborted, true);
  assert.equal(bodyReads, 0);
  assert.equal(p.providerCalls.length, 0);
  assert.equal(p.count(), 0);
  assert.equal(p.inspect.inflight.size, 0);
  assert.ok(p.timers.every((timer) => timer.canceled));
});

for (const stage of ["headers", "body"]) test(`hover-worker: last owner disconnect during ${stage} turns abort rejection into canceled`, async () => {
  const stalled = (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("AbortError")), { once: true }));
  const p = createWorker(stage === "headers" ? { headers: stalled } : { body: stalled }); const a = p.port(); a.start(); await flush();
  a.disconnect(); await flush(); assert.equal(a.replies.length, 0); assert.equal(p.inspect.inflight.size, 0); assert.equal(p.inspect.CACHE.size, 0);
  assert.equal(p.providerCalls.length, 0); assert.ok(p.timers[0].canceled);
});
for (const stage of ["usage", "reservation"]) test(`hover-worker: canceled ${stage} rejection is internal and releases owned lease`, async () => {
  const wait = deferred(); const p = createWorker(stage === "usage" ? { usageGet: () => wait.promise } : { reservation: () => wait.promise });
  const a = p.port(); a.start(); await flush(); a.disconnect(); wait.reject(new Error("SECRET")); await flush();
  assert.equal(a.replies.length, 0); assert.equal(p.providerCalls.length, 0); assert.equal(p.inspect.busy(), false); assert.equal(p.inspect.CACHE.size, 0);
});
test("hover-worker: old canceled headers promise cannot erase a replacement during provider dispatch", async () => {
  const oldHeaders = deferred(), provider = deferred(); let fetches = 0;
  const p = createWorker({ headers: () => ++fetches === 1 ? oldHeaders.promise : undefined, provider: () => provider.promise });
  const a = p.port(); a.start(); await flush(); a.disconnect(); const b = p.port(); b.start(); await flush();
  const current = [...p.inspect.inflight.values()][0]; assert.equal(current.dispatched, true); assert.equal(p.inspect.busy(), true);
  oldHeaders.resolve(); await flush(); assert.equal(p.inspect.inflight.get(current.key), current); assert.equal(p.inspect.busy(), true);
  provider.resolve('{"honest_title":"Fixture"}'); await flush(); assert.equal(b.replies[0].ok, true); assert.equal(p.count(), 1);
});
test("hover-worker: settings failure, HTML validation and thin-fetch cache keep limits unchanged", async () => {
  const failed = createWorker({ syncGet: (index) => { if (index === 2) throw new Error("SECRET"); } }); const a = failed.port(); a.start(); await flush();
  assert.equal(a.replies[0].ok, false); assert.equal(failed.fetchCalls.length, 0); assert.equal(failed.providerCalls.length, 0);
  for (const response of [{ ok: false, status: 404 }, { ok: true, headers: { get: () => "application/json" } }]) {
    const p = createWorker({ fetchImpl: async () => response }); const b = p.port(); b.start(); await flush(); assert.equal(b.replies[0].ok, false); assert.equal(p.providerCalls.length, 0); assert.ok(p.timers[0].canceled);
  }
  const thin = createWorker({ fetchImpl: async () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => '<title>Metadata</title><p>short</p>' }) });
  const first = await thin.manual(); assert.equal(first.result.thin_fetch, true); assert.equal(thin.providerCalls.length, 0); assert.equal(thin.count(), 0);
  const second = await thin.manual(); assert.equal(second.result.thin_fetch, true); assert.equal(thin.fetchCalls.length, 1);
});

test("hover-worker: cache hits do not extend the existing 30-minute TTL", async () => {
  const p = createWorker(); await p.manual(); const entry = [...p.inspect.CACHE.values()][0];
  p.setClock(100000 + 29 * 60 * 1000); await p.manual(); assert.equal([...p.inspect.CACHE.values()][0].at, entry.at); assert.equal(p.fetchCalls.length, 1);
  p.setClock(100000 + 31 * 60 * 1000); await p.manual(); assert.equal(p.fetchCalls.length, 2); assert.equal(p.providerCalls.length, 2); assert.equal(p.count(), 2);
});

test("hover-worker: listener-path cap, concurrency and provider cooldown remain enforced", async () => {
  const wait = deferred(); const p = createWorker({ initial: { dailyCap: 1 }, provider: () => wait.promise }); const a = p.port(); a.start(); await flush();
  const b = p.port(); b.start("https://article.example/b"); await flush(); assert.equal(b.replies[0].result.throttled, true); assert.equal(p.count(), 1);
  wait.resolve('{"honest_title":"Fixture"}'); await flush(); const c = p.port(); c.start("https://article.example/c"); await flush(); assert.equal(c.replies[0].result.capped, true); assert.equal(p.providerCalls.length, 1);
  const cooldown = createWorker({ provider: () => { throw Object.assign(new Error("quota"), { status: 429, retryAfterMs: 5000 }); } });
  const d = cooldown.port(); d.start(); await flush(); assert.equal(d.replies[0].ok, false); assert.equal(cooldown.count(), 1);
  const e = cooldown.port(); e.start("https://article.example/e"); await flush(); assert.equal(e.replies[0].result.rate_limited, true); assert.equal(cooldown.fetchCalls.length, 1); assert.equal(cooldown.providerCalls.length, 1);
});

const customProfile = (profile) => ({ provider: "custom", profiles: { custom: { key: "", base: "http://localhost:8000/v1", model: "fixture", ...profile } } });
const setupCases = [
  ["missing OpenAI key", { provider: "openai", profiles: { openai: {} } }],
  ["unknown provider", { provider: "unknown-secret-provider" }],
  ["missing custom base", customProfile({ base: "" })],
  ["missing custom model", customProfile({ model: "" })],
  ...["invalid", "ftp://api.example/v1", "https://user:SECRET@api.example/v1", "https://api.example/v1?key=SECRET",
    "https://api.example/v1#SECRET", "https://api.example/v1/chat/completions"].map((base) => [base, customProfile({ base })]),
  ["remote HTTP with key", customProfile({ base: "http://api.example/v1", key: "sk-SECRET" })],
];
function assertNoSetupWork(p, job) {
  assert.equal(p.fetchCalls.length, 0); assert.equal(p.providerCalls.length, 0);
  assert.equal(p.backend.reads.filter((r) => r.area === "local" && Object.hasOwn(r.keys, "debaitUsage")).length, 0);
  assert.equal(p.backend.attempts.filter((w) => w.area === "local" && Object.hasOwn(w.data, "debaitUsage")).length, 0);
  assert.equal(p.inspect.CACHE.size, 0); assert.equal(p.inspect.interval(), 0); assert.equal(p.inspect.busy(), false);
  if (job) assert.equal(job.ownsBusy, false);
}
for (const [name, initial] of setupCases) test(`hover-worker: setup preflight ${name} is minimal, no-work and never cached`, async () => {
  const wait = deferred(); const p = createWorker({ initial, syncGet: (n) => n === 2 ? wait.promise : undefined });
  const a = p.port(); a.start(); await flush(); const job = [...p.inspect.inflight.values()][0];
  assertNoSetupWork(p, job); wait.resolve(); await flush();
  assert.deepEqual(a.replies, [{ ok: true, result: { setup_required: true } }]); assertNoSetupWork(p, job);
  const b = p.port(); b.start(); await flush(); assert.deepEqual(b.replies, a.replies); assertNoSetupWork(p);
  assert.deepEqual(structuredClone(await p.manual()), a.replies[0]); assertNoSetupWork(p);
  // Initialization/provenance and profile migration writes are intentionally permitted.
  assert.ok(p.backend.writes.some((w) => Object.hasOwn(w.data, "hoverActivationProvenanceV1")));
});
for (const [name, initial] of [
  ["Ollama", { provider: "ollama", profiles: { ollama: {} } }],
  ["loopback custom", customProfile({})],
  ["remote HTTP custom", customProfile({ base: "http://api.example/v1" })],
  ["HTTPS custom", customProfile({ base: "https://api.example/v1" })],
]) test(`hover-worker: configured keyless ${name} passes local preflight and unreachable stays an ordinary error`, async () => {
  const p = createWorker({ initial }); const success = await p.manual(); assert.equal(success.result.honest_title, "Fixture");
  assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1); assert.equal(p.count(), 1);
  const q = createWorker({ initial, provider: () => { throw new Error("network SECRET https://endpoint.example"); } });
  const a = q.port(); a.start(); await flush(); assert.deepEqual(a.replies, [{ ok: false, error: "errGeneric" }]);
  assert.equal(q.fetchCalls.length, 1); assert.equal(q.providerCalls.length, 1); assert.equal(q.count(), 1); assert.equal(q.inspect.CACHE.size, 0);
});
test("hover-worker: current-generation cache wins over preflight and live cooldown without TTL extension", async () => {
  const p = createWorker(); await p.manual(); const entry = [...p.inspect.CACHE.values()][0];
  // A synchronous failing preflight hook proves the cached path never calls it.
  vm.runInContext('configuration = () => { throw new Error("must not validate cache hit"); }; cooldownUntil = Date.now() + 5000;', p.context);
  p.setClock(100001); const reply = await p.manual(); assert.equal(reply.result.honest_title, "Fixture");
  assert.equal([...p.inspect.CACHE.values()][0].at, entry.at); assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1);
});
test("hover-worker: clearing key after provider 429 prioritizes setup over preserved cooldown", async () => {
  const p = createWorker({ initial: { provider: "openai", profiles: { openai: { key: "fixture" } } },
    provider: () => { throw Object.assign(new Error("quota SECRET"), { status: 429, retryAfterMs: 5000 }); } });
  assert.equal((await p.manual()).ok, false);
  const until = vm.runInContext("cooldownUntil", p.context);
  p.change({ profiles: { openai: { key: "" } }, key: "" });
  const a = p.port(); a.start(); await flush(); assert.deepEqual(a.replies, [{ ok: true, result: { setup_required: true } }]);
  assert.equal(vm.runInContext("cooldownUntil", p.context), until); assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1);
  assert.equal(p.count(), 1); assert.equal(p.inspect.CACHE.size, 0);
  p.change({ profiles: { openai: { key: "fixture" } }, key: "fixture" });
  assert.equal((await p.manual()).result.rate_limited, true); assert.equal(p.fetchCalls.length, 1);
});
for (const outcome of ["thin-fetch", "throttled"]) test(`hover-worker: setup precedes ${outcome} without fetching target`, async () => {
  const p = createWorker({ initial: customProfile({ base: "" }), fetchImpl: () => { throw new Error("must not fetch"); } });
  if (outcome === "throttled") vm.runInContext("lastPreviewAt = Date.now();", p.context);
  const interval = p.inspect.interval(); assert.deepEqual(structuredClone(await p.manual()), { ok: true, result: { setup_required: true } });
  assert.equal(p.fetchCalls.length, 0); assert.equal(p.providerCalls.length, 0); assert.equal(p.inspect.interval(), interval); assert.equal(p.count(), 0);
});
test("hover-worker: saved usable configuration recovers from uncached marker on next hover", async () => {
  const p = createWorker({ initial: customProfile({ base: "" }) }); assert.equal((await p.manual()).result.setup_required, true);
  await p.backend.storage.sync.set({ profiles: { custom: { key: "", base: "http://localhost:8000/v1", model: "fixture" } } });
  const a = p.port(); a.start(); await flush(); assert.equal(a.replies[0].result.honest_title, "Fixture");
  assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1); assert.equal(p.count(), 1); assert.equal(p.inspect.CACHE.size, 1);
});
for (const stop of ["cancel", "disconnect", "generation"]) test(`hover-worker: pending unconfigured settings ${stop} cannot emit late setup`, async () => {
  const wait = deferred(); const p = createWorker({ initial: customProfile({ base: "" }), syncGet: (n) => n === 2 ? wait.promise : undefined });
  const a = p.port(); a.start(); await flush(); const job = [...p.inspect.inflight.values()][0];
  if (stop === "cancel") a.onMessage.emit({ type: "cancel" });
  if (stop === "disconnect") a.disconnect();
  if (stop === "generation") p.change({ model: "changed" });
  const before = a.replies.length; wait.resolve(); await flush();
  if (stop === "generation") assert.deepEqual(a.replies, [{ ok: true, result: { stale: true, url } }]);
  else assert.equal(a.replies.length, before);
  assert.ok(!a.replies.some((r) => r.result?.setup_required)); assertNoSetupWork(p, job);
});
for (const failure of [false, true]) test(`hover-worker: post-preflight generation checkpoint on ${failure ? "failure" : "success"}`, async () => {
  const p = createWorker({ initial: customProfile(failure ? { base: "" } : {}) });
  vm.runInContext('const originalConfiguration = configuration; configuration = (s) => { try { return originalConfiguration(s); } finally { configurationGeneration++; } };', p.context);
  const a = p.port(); a.start(); await flush(); assert.deepEqual(a.replies, [{ ok: true, result: { stale: true, url } }]); assertNoSetupWork(p);
});
for (const withdrawHover of [false, true]) test(`hover-worker: cooperative setup marker owners, hover withdrawal ${withdrawHover}`, async () => {
  const wait = deferred(); const p = createWorker({ initial: customProfile({ base: "" }), syncGet: (n) => n === 2 ? wait.promise : undefined });
  const a = p.port(); a.start(); await flush(); const manual = p.manual(); await flush();
  const job = [...p.inspect.inflight.values()][0]; assert.equal(job.subscribers.size, 2);
  if (withdrawHover) { a.disconnect(); assert.equal(job.subscribers.size, 1); assert.equal(job.canceled, false); }
  wait.resolve(); const reply = await manual; await flush(); assert.deepEqual(structuredClone(reply), { ok: true, result: { setup_required: true } });
  assert.deepEqual(a.replies, withdrawHover ? [] : [structuredClone(reply)]); assertNoSetupWork(p, job);
});
for (const status of [401, 403, 429, undefined]) test(`hover-worker: configured remote ${status || "network"} failure remains generic on hover`, async () => {
  const secret = "sk-SECRET https://upstream.example/v1 private upstream body";
  const p = createWorker({ initial: { provider: "openai", profiles: { openai: { key: "fixture" } } },
    provider: () => { throw Object.assign(new Error(secret), { status }); } });
  const a = p.port(); a.start(); await flush(); assert.deepEqual(a.replies, [{ ok: false, error: "errGeneric" }]);
  assert.equal(p.count(), 1); assert.equal(p.inspect.CACHE.size, 0);
  if (status === 429) assert.equal((await p.manual("https://article.example/b")).result.rate_limited, true);
});
test("hover-worker: narrow preflight catch does not convert later configuration/storage/target failures to setup", async () => {
  const p = createWorker();
  vm.runInContext('const originalConfiguration = configuration; let validations = 0; configuration = (s) => { if (++validations === 2) throw new Error("SECRET later defense"); return originalConfiguration(s); };', p.context);
  const a = p.port(); a.start(); await flush(); assert.deepEqual(a.replies, [{ ok: false, error: "errGeneric" }]);
  assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 0); assert.equal(p.count(), 0);
  // Existing settings, usage/reservation and target error regressions above also
  // assert ordinary error boundaries rather than setup-required.
});

test("hover-worker: setup marker cannot release another dispatched job's busy ownership or touch its quota/interval", async () => {
  const wait = deferred(); const p = createWorker({ provider: () => wait.promise }); const first = p.manual(); await flush();
  const job = [...p.inspect.inflight.values()][0], interval = p.inspect.interval(); assert.equal(job.ownsBusy, true);
  const usageReads = p.backend.reads.filter((r) => r.area === "local" && Object.hasOwn(r.keys, "debaitUsage")).length;
  const usageWrites = p.backend.attempts.filter((w) => Object.hasOwn(w.data, "debaitUsage")).length;
  p.change({ profiles: { custom: { base: "", model: "fixture", key: "" } } });
  const next = await p.manual("https://article.example/b"); assert.deepEqual(structuredClone(next.result), { setup_required: true });
  assert.equal(p.inspect.busy(), true); assert.equal(job.ownsBusy, true); assert.equal(p.inspect.interval(), interval);
  assert.equal(p.backend.reads.filter((r) => r.area === "local" && Object.hasOwn(r.keys, "debaitUsage")).length, usageReads);
  assert.equal(p.backend.attempts.filter((w) => Object.hasOwn(w.data, "debaitUsage")).length, usageWrites);
  assert.equal(p.fetchCalls.length, 1); assert.equal(p.providerCalls.length, 1); assert.equal(p.inspect.CACHE.size, 0);
  wait.resolve('{"honest_title":"stale"}'); assert.equal((await first).result.stale, true); assert.equal(p.inspect.busy(), false);
});
for (const failure of [false, true]) test(`hover-worker: synchronous preflight ${failure ? "failure" : "success"} withdrawal checkpoint is silent`, async () => {
  const p = createWorker({ initial: customProfile(failure ? { base: "" } : {}) }), a = p.port();
  p.context.withdrawHover = () => a.disconnect();
  vm.runInContext('const originalConfiguration = configuration; configuration = (s) => { try { return originalConfiguration(s); } finally { withdrawHover(); } };', p.context);
  a.start(); await flush(); assert.deepEqual(a.replies, []); assertNoSetupWork(p); assert.equal(p.inspect.inflight.size, 0);
});
test("hover-worker: settings rejection with invalid configuration is generic, not setup-required", async () => {
  const p = createWorker({ initial: customProfile({ base: "" }), syncGet: (n) => { if (n === 2) throw new Error("SECRET storage"); } });
  const a = p.port(); a.start(); await flush(); assert.deepEqual(a.replies, [{ ok: false, error: "errGeneric" }]); assertNoSetupWork(p);
});
