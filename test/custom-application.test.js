import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { resolveProvider, callProvider, PROVIDERS, validateConfiguration, providerCapabilities, customError } from "../shared/providers.js";
import { buildPrompt, parseResult } from "../shared/prompt.js";
import { extractArticle } from "../shared/extract.js";
import "../shared/profiles.js";
import { panelDom } from "./helpers/panel-page.js";

const output = JSON.stringify({ choices: [{ message: { content: '{"honest_title":"Fixture"}' } }] });
const articleHtml = `<article>${"A factual local article. ".repeat(20)}</article>`;
const response = () => ({ ok: true, status: 200, text: async () => output });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const initial = (key = "") => ({ provider: "custom", profiles: { custom: { key, base: "http://localhost:8000/v1", model: "fixture" } }, previewMinIntervalMs: 0, minIntervalMs: 0, dailyCap: 1 });

function dom() {
  const { document } = panelDom();
  const hosts = { get: (id) => document.getElementById(id) };
  class DOMParser { parseFromString() { return { querySelector: () => null, body: { textContent: "article ".repeat(50), querySelectorAll: () => [] } }; } }
  return { document, DOMParser, hosts };
}

function userscript(values = initial(), { info = { scriptHandler: "Tampermonkey", version: "4.18.0", sandboxMode: "dom" }, fetchImpl = async () => response(), lang = "en", fastTimeout = false, requestImpl = Request, chromium = true } = {}) {
  const store = structuredClone(values), menus = [], fetchCalls = [], gmCalls = [], writes = [], pageCalls = [];
  const nodes = dom(); let nextPrompt = null;
  // Proxies model native browser API identity for this Node VM. Node's Fetch
  // implementation is JS, unlike Chromium's native isolated-realm APIs. Browser
  // realm/control enforcement is explicitly NOT proven by this simulation.
  const nativeFetch = new Proxy(async (...args) => { fetchCalls.push(args); return fetchImpl(...args); }, {});
  const context = vm.createContext({ ...nodes, URL, navigator: { language: lang, userAgent: chromium ? "Mozilla/5.0 Chrome/120.0" : "Firefox/120.0" }, location: { href: "https://article.example/" },
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 900 },
    unsafeWindow: { fetch: (...args) => { pageCalls.push(args); assert.fail("never use page transport"); } },
    fetch: nativeFetch, Request: new Proxy(requestImpl, {}), AbortController: new Proxy(AbortController, {}),
    setTimeout: (fn, ms) => setTimeout(fn, fastTimeout && ms === 60000 ? 10 : ms), clearTimeout,
    GM_info: info,
    GM_getValue: (key, fallback) => Object.hasOwn(store, key) ? structuredClone(store[key]) : fallback,
    GM_setValue: (key, value) => { writes.push(key); store[key] = structuredClone(value); },
    GM_registerMenuCommand: (name, fn) => menus.push({ name, fn }),
    GM_xmlhttpRequest: (req) => {
      gmCalls.push(req);
      if (req.method === "GET") queueMicrotask(() => req.onload({ status: 200, responseText: articleHtml }));
      else queueMicrotask(() => req.onload({ status: 200, responseText: output }));
    },
    prompt: () => nextPrompt, alert() {},
  });
  const source = readFileSync(new URL("../userscript/debait.user.js", import.meta.url), "utf8").replace(/\}\)\(\);\s*$/, 'globalThis.api = { preview, snapshot, configuration, callProvider, CFG, previewCache, previewInflight, run, t };\n})();');
  vm.runInContext(source, context);
  const menu = (label, value) => { nextPrompt = value; const found = menus.find((item) => item.name.includes(label)); assert.ok(found, label); found.fn(); };
  return { api: context.api, context, store, menus, fetchCalls, gmCalls, pageCalls, writes, menu, hosts: nodes.hosts,
    count: () => Number(store.usageCount || 0), changeKey: (key) => menu("set API key", key) };
}

function extension(values = initial(), fetchImpl = async () => response()) {
  const store = structuredClone(values), local = {}, fetchCalls = []; let changed;
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, resolveProvider, callProvider, PROVIDERS, validateConfiguration, providerCapabilities, customError, buildPrompt, parseResult, extractArticle,
    DebaitProfiles: globalThis.DebaitProfiles, DebaitI18n: { init: async () => {}, t: (key) => key },
    fetch: async (...args) => { fetchCalls.push(args); return fetchImpl(...args); },
    chrome: { storage: { sync: { get: async (defaults) => ({ ...defaults, ...structuredClone(store) }), set: async (s) => { const changes = Object.fromEntries(Object.entries(s).filter(([key, value]) => JSON.stringify(store[key]) !== JSON.stringify(value)).map(([key, value]) => [key, { newValue: value }])); Object.assign(store, structuredClone(s)); if (Object.keys(changes).length) await changed(changes, "sync"); } },
      local: { get: async (defaults) => ({ ...defaults, ...structuredClone(local) }), set: async (s) => Object.assign(local, structuredClone(s)) },
      onChanged: { addListener: (fn) => changed = fn } },
      runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} } }, contextMenus: { onClicked: { addListener() {} } } },
  });
  const source = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInContext(source + '\nglobalThis.api = { preview, settings, CACHE, inflight };', context);
  return { api: context.api, context, store, local, fetchCalls, count: () => local.debaitUsage?.count || 0,
    changeKey: async (key) => { store.profiles.custom.key = key; store.key = key; await changed({ profiles: { newValue: structuredClone(store.profiles) } }, "sync"); } };
}

async function app(kind, values = initial(), provider = async () => response(), article = async () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => articleHtml })) {
  if (kind === "userscript") return userscript(values, { fetchImpl: provider });
  const old = globalThis.fetch; globalThis.fetch = provider;
  const p = extension(values, article); await p.api.settings(); // complete migration before testing preview
  p.restore = () => globalThis.fetch = old;
  return p;
}

for (const kind of ["extension", "userscript"]) {
  test(`${kind}: keyless custom counts exactly once, cache is free, cap blocks a new attempt`, async () => {
    let calls = 0; const p = await app(kind, initial(), async () => { calls++; return response(); });
    try {
      assert.equal((await p.api.preview("https://article.example/a")).honest_title, "Fixture");
      assert.equal(p.count(), 1); assert.equal(calls, 1);
      assert.equal((await p.api.preview("https://article.example/a")).honest_title, "Fixture"); assert.equal(p.count(), 1);
      assert.equal((await p.api.preview("https://article.example/b")).capped, true); assert.equal(calls, 1);
      if (kind === "userscript") { assert.equal(p.fetchCalls[0][1].credentials, "omit"); assert.equal(p.fetchCalls[0][1].redirect, "error"); assert.equal(p.fetchCalls[0][1].headers.authorization, undefined); assert.equal(p.gmCalls.filter((r) => r.method === "POST").length, 0); }
    } finally { p.restore?.(); }
  });

  test(`${kind}: failures count, invalid custom does not, and sanitized 429 starts cooldown`, async () => {
    let p = await app(kind, initial(), async () => { throw new Error("SECRET https://secret.example ARTICLE"); });
    try { await assert.rejects(p.api.preview("https://article.example/a"), (e) => !e.message.includes("SECRET")); assert.equal(p.count(), 1); assert.equal((await p.api.preview("https://article.example/b")).capped, true); } finally { p.restore?.(); }
    const invalid = initial(); invalid.profiles.custom.model = "";
    p = await app(kind, invalid, () => assert.fail("invalid should not send"));
    try { await assert.rejects(p.api.preview("https://article.example/a")); assert.equal(p.count(), 0); } finally { p.restore?.(); }
    p = await app(kind, initial(), async () => ({ ok: false, status: 429, headers: { get: () => "5" }, text: () => assert.fail("error body not read") }));
    try { await assert.rejects(p.api.preview("https://article.example/a"), (e) => e.status === 429); assert.equal(p.count(), 1); assert.equal((await p.api.preview("https://article.example/b")).rate_limited, true); assert.equal(p.count(), 1); } finally { p.restore?.(); }
  });

  test(`${kind}: concurrency cannot overshoot cap; same generation deduplicates`, async () => {
    let settle, calls = 0;
    const p = await app(kind, initial(), async () => { calls++; return new Promise((resolve) => settle = resolve); });
    try {
      const a = p.api.preview("https://article.example/a"), duplicate = p.api.preview("https://article.example/a");
      await flush(); const other = await p.api.preview("https://article.example/b"); assert.equal(other.throttled, true); assert.equal(calls, 1); assert.equal(p.count(), 1);
      settle(response()); await a; await duplicate; assert.equal(calls, 1); assert.equal((await p.api.preview("https://article.example/c")).capped, true);
    } finally { p.restore?.(); }
  });

  test(`${kind}: key/profile change isolates cache and delayed completion is discarded without retry`, async () => {
    const values = initial(); values.dailyCap = 0;
    let settle, calls = 0;
    const p = await app(kind, values, async () => { calls++; return calls === 3 ? new Promise((resolve) => settle = resolve) : response(); });
    try {
      await p.api.preview("https://article.example/a"); await p.changeKey("dummy-one");
      await p.api.preview("https://article.example/a"); assert.equal(calls, 2); assert.equal(p.count(), 2);
      const late = p.api.preview("https://article.example/b"); await flush(); await p.changeKey(""); settle(response());
      assert.equal((await late).stale, true); assert.equal(calls, 3); assert.equal(p.count(), 3);
      const cache = kind === "extension" ? p.api.CACHE : p.api.previewCache;
      assert.ok(![...cache.keys()].join().includes("dummy-one"));
      assert.ok(![...cache.keys()].some((key) => key.includes("/b")));
      await p.api.preview("https://article.example/b"); assert.equal(calls, 4);
    } finally { p.restore?.(); }
  });
}

test("extension: settings change during delayed article fetch discards before provider/count", async () => {
  let settle;
  const p = await app("extension", initial(), () => assert.fail("stale must not send"), async () => new Promise((resolve) => settle = resolve));
  try {
    const late = p.api.preview("https://article.example/a"); await flush(); await p.changeKey("dummy");
    settle({ ok: true, headers: { get: () => "text/html" }, text: async () => articleHtml });
    assert.equal((await late).stale, true); assert.equal(p.count(), 0);
  } finally { p.restore(); }
});

test("actual userscript: unsupported manager/version/sandbox/Fetch controls fail before any custom send or count", async () => {
  const cases = [null, {}, { scriptHandler: "Violentmonkey", version: "5.0", sandboxMode: "dom" },
    { scriptHandler: "Tampermonkey", version: "4.17", sandboxMode: "dom" },
    { scriptHandler: "Tampermonkey", version: "4.18", sandboxMode: "raw" }, { scriptHandler: "Tampermonkey", version: "5.0", sandboxMode: "js" },
    { scriptHandler: "Tampermonkey", version: "unknown", sandboxMode: "dom" }];
  for (const key of ["", "dummy"]) for (const info of cases) {
    const p = userscript(initial(key), { info });
    await assert.rejects(p.api.preview("https://article.example/a"), /DOM|隔離/);
    assert.equal(p.fetchCalls.length, 0); assert.equal(p.count(), 0); assert.equal(p.gmCalls.filter((r) => r.method === "POST").length, 0); assert.equal(p.pageCalls.length, 0);
  }
  for (const opts of [{ requestImpl: class { constructor() { this.credentials = "include"; this.redirect = "follow"; } } }, { chromium: false }]) {
    const p = userscript(initial(), opts); await assert.rejects(p.api.preview("https://article.example/a")); assert.equal(p.fetchCalls.length, 0); assert.equal(p.count(), 0);
  }
});

test("actual userscript: custom safe errors and full-body deadline, no GM/page fallback", async () => {
  for (const fixture of [async () => { throw new Error("SECRET ARTICLE https://secret.example"); },
    async () => ({ ok: true, text: async () => { throw new Error("SECRET"); } }),
    async () => ({ ok: true, text: async () => "SECRET" }), async () => ({ ok: true, text: async () => '{}' }),
    ...[401, 403, 404, 429, 500].map((status) => async () => ({ ok: false, status, text: () => assert.fail("no raw error body") }))]) {
    const p = userscript(initial("dummy"), { fetchImpl: fixture });
    await assert.rejects(p.api.preview("https://article.example/a"), (e) => !e.message.includes("SECRET"));
    assert.equal(p.count(), 1); assert.equal(p.gmCalls.filter((r) => r.method === "POST").length, 0);
  }
  for (const body of [false, true]) {
    const p = userscript(initial(), { fastTimeout: true, fetchImpl: async () => body ? { ok: true, text: () => new Promise(() => {}) } : new Promise(() => {}) });
    await assert.rejects(p.api.preview("https://article.example/a"), /timed out/); assert.equal(p.count(), 1); assert.equal(p.fetchCalls[0][1].signal.aborted, true);
  }
});

test("actual userscript: streaming HTTP errors abort before rejecting with safe status/backoff", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("SECRET ARTICLE https://secret.example")); } });
    const res = new Response(body, { status, headers: { "retry-after": "5" } });
    res.text = () => assert.fail("never consume the streaming error body");
    const p = userscript(initial("dummy"), { fetchImpl: async () => res });
    try {
      await assert.rejects(p.api.preview("https://article.example/a"), (e) => e.status === status &&
        e.code === (status === 429 ? "quota" : "http") && e.retryAfterMs === 5000 && !e.message.includes("SECRET"));
      assert.equal(p.fetchCalls[0][1].signal.aborted, true);
      assert.equal(body.locked, false);
      assert.equal(p.count(), 1);
      assert.equal(p.gmCalls.filter((r) => r.method === "POST").length, 0);
      assert.equal(p.pageCalls.length, 0);
    } finally { await body.cancel(); }
  }
});

test("actual userscript: first menu switch migration, empty owned credentials, save/clear/reload and native GM regression", async () => {
  const p = userscript({ provider: "gemini", base: "https://legacy.example", model: "legacy", key_gemini: "", key_openai: "owned" });
  assert.equal(p.store.profiles.gemini.key, ""); assert.equal(p.store.profiles.gemini.base, "https://legacy.example");
  p.menu("choose provider", "custom"); assert.equal(p.api.CFG.key, ""); assert.equal(p.api.CFG.base, ""); assert.equal(p.api.CFG.model, "");
  p.menu("set base", "http://localhost:8000/v1"); p.menu("set model", "fixture"); p.changeKey("dummy");
  p.menu("choose provider", "openai"); assert.equal(p.api.CFG.key, "owned"); assert.equal(p.api.CFG.base, "https://api.openai.com/v1");
  await p.api.callProvider("native"); assert.equal(p.gmCalls.at(-1).method, "POST"); assert.equal(p.gmCalls.at(-1).headers.Authorization, "Bearer owned"); assert.equal(p.fetchCalls.length, 0);
  p.menu("choose provider", "custom"); assert.equal(p.api.CFG.key, "dummy"); p.changeKey("");
  p.store.key_custom = "obsolete"; const reload = userscript(p.store); assert.equal(reload.api.CFG.key, "");
  reload.menu("choose provider", "gemini"); assert.equal(reload.api.CFG.key, ""); assert.equal(reload.api.CFG.model, "legacy");
  reload.menu("choose provider", "custom"); assert.equal(reload.api.CFG.key, "");
});

test("actual userscript: custom guidance/menu translations exist and unsupported guidance is localized", async () => {
  for (const lang of ["en", "zh-TW", "nan-Hanlo"]) {
    const p = userscript(initial(), { lang, info: null });
    for (const key of ["customProvider", "customGuidance", "errCustomSettings", "errCustomTransport", "promptCustomModel", "promptCustomBase", "customError_network", "errStale"]) assert.notEqual(p.api.t(key), key);
    await assert.rejects(p.api.preview("https://article.example/a"), (e) => e.message === p.api.t("errCustomTransport"));
  }
});

test("actual userscript: settings change during article fetch discards without a provider attempt", async () => {
  const p = userscript(initial()); let settle;
  p.context.GM_xmlhttpRequest = (req) => { settle = req.onload; };
  const late = p.api.preview("https://article.example/a"); p.changeKey("dummy"); settle({ status: 200, responseText: articleHtml });
  assert.equal((await late).stale, true); assert.equal(p.count(), 0); assert.equal(p.fetchCalls.length, 0);
});

test("extension: durable usage reservation serializes previews, cancels stale sends and fails closed on rejection", async () => {
  let calls = 0;
  const p = await app("extension", initial(), async () => { calls++; return response(); });
  const storage = p.context.chrome.storage.local;
  const originalSet = storage.set;
  try {
    let commit;
    storage.set = (values) => new Promise((resolve) => { commit = async () => { await originalSet(values); resolve(); }; });
    const first = p.api.preview("https://article.example/a"); await flush(); assert.equal(calls, 0);
    const other = await p.api.preview("https://article.example/b"); assert.equal(other.throttled, true);
    await p.changeKey("dummy"); await commit();
    assert.equal((await first).stale, true); assert.equal(calls, 0); assert.equal(p.count(), 1);
    storage.set = originalSet;
    assert.equal((await p.api.preview("https://article.example/c")).capped, true); assert.equal(calls, 0);
    p.local.debaitUsage.count = 0;
    for (const fail of [() => { throw new Error("storage failure"); }, async () => { throw new Error("storage failure"); }]) {
      storage.set = fail; await assert.rejects(p.api.preview("https://article.example/d")); assert.equal(calls, 0); assert.equal(p.count(), 0);
    }
    storage.set = originalSet; await p.api.preview("https://article.example/e"); assert.equal(calls, 1); assert.equal(p.count(), 1);
  } finally { p.restore(); }
});

test("both preview paths count native keyed and Ollama attempts; thin articles remain free", async () => {
  for (const kind of ["extension", "userscript"]) for (const provider of ["openai", "ollama"]) {
    const values = { ...initial(), provider, profiles: { [provider]: { key: provider === "openai" ? "dummy" : "", base: "", model: "" } } };
    let calls = 0; const p = await app(kind, values, async () => { calls++; return response(); });
    try {
      await p.api.preview("https://article.example/a"); assert.equal(p.count(), 1);
      if (kind === "extension") assert.equal(calls, 1); else assert.equal(p.gmCalls.filter((r) => r.method === "POST").length, 1);
    } finally { p.restore?.(); }
  }
  const p = await app("extension", initial(), () => assert.fail("thin article must not send"), async () => ({ ok: true, headers: { get: () => "text/html" }, text: async () => "<article>thin</article>" }));
  try { assert.equal((await p.api.preview("https://article.example/a")).thin_fetch, true); assert.equal(p.count(), 0); } finally { p.restore(); }
});

test("actual userscript native Fetch local redirect fixture: zero target hits for same/cross origin", async () => {
  const { default: http } = await import("node:http");
  async function serve(handler) {
    const s = http.createServer(handler); await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
    return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((resolve) => { s.close(resolve); s.closeAllConnections(); }) };
  }
  let targets = 0, sends = 0;
  const target = await serve((_req, res) => { targets++; res.end("must not be reached"); });
  const origin = await serve((req, res) => {
    if (req.url === "/target") { targets++; res.end("forbidden"); return; }
    sends++; const parts = req.url.split("/");
    res.writeHead(Number(parts[2]), { Location: parts[1] === "same" ? "/target" : `${target.base}/target` }); res.end("SECRET");
  });
  try {
    for (const status of [301, 302, 307, 308]) for (const direction of ["same", "cross"]) {
      const values = initial("dummy"); values.profiles.custom.base = `${origin.base}/${direction}/${status}`;
      const p = userscript(values, { fetchImpl: globalThis.fetch });
      await assert.rejects(p.api.preview("https://article.example/a"), (e) => e.code === "network" && !e.message.includes("SECRET"));
      assert.equal(p.fetchCalls[0][1].redirect, "error"); assert.equal(p.count(), 1); assert.equal(targets, 0);
    }
    assert.equal(sends, 8);
  } finally { await origin.close(); await target.close(); }
});

test("custom raw model payload is not surfaced by CLI/application parse failures", async () => {
  const bad = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "SECRET ARTICLE https://secret.example" } }] }) });
  for (const kind of ["extension", "userscript"]) {
    const p = await app(kind, initial(), bad);
    try { await assert.rejects(p.api.preview("https://article.example/a"), (e) => !e.message.includes("SECRET")); assert.equal(p.count(), 1); }
    finally { p.restore?.(); }
  }
});

test("actual userscript: authoritative empty profile beats legacy values; native GM still usable under unsupported custom manager", async () => {
  const p = userscript({ provider: "openai", key_openai: "obsolete", base: "https://obsolete.example", model: "obsolete", profiles: { openai: {} } });
  assert.equal(p.api.CFG.key, ""); assert.equal(p.api.CFG.base, "https://api.openai.com/v1"); assert.equal(p.api.CFG.model, PROVIDERS.openai.model);
  p.changeKey("dummy"); p.context.GM_info = { scriptHandler: "Violentmonkey", version: "5.0", sandboxMode: "js" };
  assert.ok(await p.api.callProvider("native")); assert.equal(p.gmCalls.at(-1).method, "POST"); assert.equal(p.fetchCalls.length, 0);
});

test("actual userscript full-page loading state discards delayed stale success and errors", async () => {
  for (const failed of [false, true]) {
    let settle;
    const p = userscript(initial(), { fetchImpl: () => new Promise((resolve,reject) => settle = failed ? reject : resolve) });
    const run = p.api.run(); await flush(); p.changeKey("dummy"); settle(failed ? new Error("SECRET old failure") : response()); await run;
    const html = p.hosts.get("debait-panel-host").__content.innerHTML;
    assert.ok(html.includes(p.api.t("errStale"))); assert.ok(!html.includes("SECRET")); assert.ok(!html.includes("Fixture"));
  }
});

test("actual userscript: capture complete keyed custom initial request and malformed config sends zero", async () => {
  const p = userscript(initial("dummy")); await p.api.preview("https://article.example/a");
  const [url,opts] = p.fetchCalls[0]; assert.equal(url,"http://localhost:8000/v1/chat/completions");
  assert.equal(opts.method,"POST"); assert.equal(opts.headers.authorization,"Bearer dummy");
  assert.equal(opts.credentials,"omit"); assert.equal(opts.redirect,"error"); assert.ok(opts.signal instanceof AbortSignal);
  const body=JSON.parse(opts.body); assert.equal(body.model,"fixture"); assert.equal(body.temperature,0.2); assert.equal(body.messages[0].role,"system"); assert.equal(body.messages[1].role,"user"); assert.ok(body.messages[1].content.includes("ARTICLE TEXT"));
  for (const override of [{ base:"http://localhost.evil/v1", key:"dummy" }, { base:"https://u:SECRET@fixture.example" }, { base:"https://fixture.example?SECRET" }, { base:"https://fixture.example#SECRET" }, { base:"https://fixture.example/chat/completions" }, { base:"file:///tmp/SECRET" }, { model:"" }]) {
    const values=initial(); Object.assign(values.profiles.custom,override); const p=userscript(values);
    await assert.rejects(p.api.preview("https://article.example/a"),(e)=>!e.message.includes("SECRET")); assert.equal(p.fetchCalls.length,0); assert.equal(p.count(),0);
  }
});

test("actual userscript: thin target never spends a provider request or usage unit", async () => {
  const p=userscript(initial());
  p.context.DOMParser=class { parseFromString(){ return { querySelector:()=>null, body:{textContent:'thin',querySelectorAll:()=>[]} }; } };
  assert.equal((await p.api.preview('https://article.example/a')).thin_fetch,true); assert.equal(p.count(),0); assert.equal(p.fetchCalls.length,0);
});
