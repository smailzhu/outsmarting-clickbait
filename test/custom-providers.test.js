import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { resolveProvider, callProvider, buildRequest, buildModelsRequest, listModels, fetchCustomText } from "../shared/providers.js";
import { complete, chooseBackend, listModels as cliModels } from "../src/llm.js";
import { testConnection } from "../extension/connection-test.js";

const cfg = (values = {}) => resolveProvider({ provider: "custom", base: "https://fixture.example/v1/", model: "model", ...values });
const response = (text = "OK") => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: text } }] }) });
const sentinel = "SECRET ARTICLE https://secret.example/?key=SECRET";
async function withFetch(fetchImpl, fn) { const old = globalThis.fetch; globalThis.fetch = fetchImpl; try { return await fn(); } finally { globalThis.fetch = old; } }
function clean(error) { assert.ok(!JSON.stringify({ message: error.message, ...error }).includes("SECRET")); return true; }
async function server(handler) {
  const s = http.createServer(handler);
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  return { base: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((resolve) => { s.close(resolve); s.closeAllConnections(); }) };
}
function cli(args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.js", ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (b) => stdout += b); child.stderr.on("data", (b) => stderr += b);
    child.on("error", reject); child.on("close", (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}
function envWithoutProviders() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.endsWith("_API_KEY") && !key.startsWith("DEBAIT_")));
}

test("custom explicit validation, parsed loopback normalization, and zero sends for invalid settings", async () => {
  for (const base of ["http://LOCALHOST:3000/v1", "http://127.0.0.1:12/v1", "http://127.42.3.4/v1", "http://[::1]:8000/v1", "http://127.1/v1", "http://2130706433/v1", "http://0x7f000001/v1", "https://remote.example/v1"]) {
    assert.equal(cfg({ base, key: " k " }).key, "k", base);
  }
  for (const base of ["http://localhost.example/v1", "http://localhost.evil/v1", "http://127.0.0.1.example/v1", "http://128.0.0.1/v1", "http://[::2]/v1", "http://remote.example/v1"]) {
    assert.throws(() => cfg({ base, key: "SECRET" }), (e) => e.code === "https" && clean(e));
    assert.equal(cfg({ base, key: "" }).key, ""); // intentional unencrypted content exposure
  }
  const invalid = [{ base: "" }, { model: " " }, { base: null }, { model: 1 }, { key: {} },
    { base: "ftp://fixture.example" }, { base: "not-url" }, { base: "https://user:SECRET@fixture.example" },
    { base: "https://fixture.example/v1?key=SECRET" }, { base: "https://fixture.example/v1#SECRET" },
    { base: "https://fixture.example/v1?" }, { base: "https://fixture.example/v1#" },
    { base: "https://fixture.example/v1/chat/completions/" }];
  await withFetch(() => assert.fail("invalid custom must not send"), async () => {
    for (const values of invalid) {
      assert.throws(() => cfg(values), clean);
      await assert.rejects(callProvider({ id: "custom", base: "", model: "model", ...values }, sentinel), clean);
      assert.equal((await testConnection({ provider: "custom", base: "https://fixture.example", model: "model", ...values })).code, "settings");
    }
  });
  assert.equal(cfg({ base: " https://FIXTURE.example/v1/// ", model: " model ", key: " " }).base, "https://fixture.example/v1");
});

test("custom completion and unsaved connection test have correct initial options, optional auth and bounded controls", async () => {
  for (const key of ["", "k"]) {
    const c = cfg({ key });
    const captured = [];
    await withFetch(async (url, opts) => { captured.push({ url, opts }); return response(); }, async () => {
      assert.equal(await callProvider(c, "article"), "OK");
      assert.deepEqual(await testConnection({ provider: "custom", ...c }), { ok: true, code: "success" });
    });
    assert.equal(captured.length, 2);
    for (const { url, opts } of captured) {
      assert.equal(url, "https://fixture.example/v1/chat/completions");
      assert.equal(opts.method, "POST"); assert.equal(opts.credentials, "omit"); assert.equal(opts.redirect, "error");
      assert.ok(opts.signal instanceof AbortSignal);
      assert.equal(opts.headers.authorization, key ? "Bearer k" : undefined);
      const body = JSON.parse(opts.body); assert.equal(body.model, "model"); assert.equal(body.temperature, 0.2);
      assert.equal(body.messages[0].role, "system");
    }
    assert.equal(JSON.parse(captured[1].opts.body).max_tokens, 128);
    assert.ok(!captured[1].opts.body.includes("article"));
  }
});

test("custom errors never expose upstream text or exceptions, 429 has safe bounded backoff", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await withFetch(async () => ({ ok: false, status, headers: { get: () => "999999" }, text: () => assert.fail("do not read error payload") }), async () => {
      await assert.rejects(callProvider(cfg(), sentinel), (e) => e.status === status && clean(e) && (status !== 429 || e.code === "quota" && e.retryAfterMs === 300000));
    });
  }
  const failures = [async () => { throw new Error(sentinel); }, async () => { throw Object.assign(new Error(sentinel), { code: "http" }); },
    async () => ({ ok: true, text: async () => { throw new Error(sentinel); } }),
    async () => ({ ok: true, text: async () => sentinel }), async () => response({ secret: sentinel }), async () => response("")];
  for (const fixture of failures) await withFetch(fixture, () => assert.rejects(callProvider(cfg(), sentinel), clean));
  for (const value of ["SECRET", "-1", "Infinity", "0", null]) {
    await withFetch(async () => ({ ok: false, status: 429, headers: { get: () => value } }), () => assert.rejects(callProvider(cfg(), sentinel), (e) => e.retryAfterMs === 30000 && clean(e)));
  }
});

test("custom streaming HTTP errors abort immediately without reading the body or losing safe status/backoff", async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    let signal;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(sentinel)); } });
    const res = new Response(body, { status, headers: { "retry-after": "5" } });
    res.text = () => assert.fail("do not consume a streaming error body");
    try {
      await assert.rejects(fetchCustomText(buildRequest(cfg(), sentinel), { timeoutMs: 1000, fetchImpl: async (_url, opts) => {
        signal = opts.signal; return res;
      } }), (e) => e.status === status && e.code === (status === 429 ? "quota" : "http") && e.retryAfterMs === 5000 && clean(e));
      assert.equal(signal.aborted, true, "release the transport before clearing its deadline");
      assert.equal(body.locked, false, "never acquire a reader for the error body");
    } finally { await body.cancel(); }
  }
});

test("custom deadline spans stalled headers and body, clears timer on every path", async () => {
  for (const body of [false, true]) {
    let signal;
    await withFetch(async (_url, opts) => {
      signal = opts.signal;
      const stall = () => new Promise(() => {}); // even a broken fixture cannot evade deadline
      return body ? { ok: true, text: stall } : stall();
    }, () => assert.rejects(callProvider(cfg(), sentinel, { timeoutMs: 10 }), (e) => e.code === "timeout" && clean(e)));
    assert.equal(signal.aborted, true);
  }
  for (const failure of [false, true]) {
    let signal;
    await fetchCustomText(buildRequest(cfg(), "test"), { timeoutMs: 15, fetchImpl: async (_u, opts) => {
      signal = opts.signal; if (failure) throw new Error(sentinel); return response();
    } }).catch(clean);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(signal.aborted, false); // cleared, not a later abort after completion/error
  }
});

test("real native-fetch fixture: keyed/keyless completion and redirects never reach a target", async () => {
  let targetHits = 0;
  const target = await server((_req, res) => { targetHits++; res.end("forbidden"); });
  const calls = [];
  const source = await server((req, res) => {
    if (req.url === "/target") { targetHits++; res.end("forbidden"); return; }
    calls.push(req.url);
    if (req.url.startsWith("/redirect")) {
      const [, , origin, status] = req.url.split("/");
      res.writeHead(Number(status), { Location: origin === "same" ? "/target" : `${target.base}/target` }); res.end(sentinel); return;
    }
    assert.equal(req.url, "/v1/chat/completions");
    let body = ""; req.on("data", (b) => body += b); req.on("end", () => {
      assert.equal(JSON.parse(body).model, "fixture");
      assert.ok([undefined, "Bearer dummy"].includes(req.headers.authorization));
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
  });
  try {
    for (const key of ["", "dummy"]) assert.equal(await callProvider(cfg({ base: `${source.base}/v1`, model: "fixture", key }), sentinel), "OK");
    for (const status of [301, 302, 307, 308]) for (const origin of ["same", "cross"]) {
      await assert.rejects(callProvider(cfg({ base: `${source.base}/redirect/${origin}/${status}`, key: "dummy" }), sentinel), clean);
      assert.equal(targetHits, 0);
    }
    assert.ok(!calls.some((path) => path.endsWith("/models")));
  } finally { await source.close(); await target.close(); }
});

test("CLI custom explicit-only selection, native/env precedence and local discovery rejection", async () => {
  const old = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (key.endsWith("_API_KEY") || key.startsWith("DEBAIT_")) delete process.env[key];
    for (const values of [{ CUSTOM_API_KEY: "dummy" }, { DEBAIT_API_KEY: "dummy" }, { CUSTOM_API_KEY: "dummy", DEBAIT_API_KEY: "dummy" }]) {
      Object.assign(process.env, values); assert.equal(chooseBackend(), "codex");
      delete process.env.CUSTOM_API_KEY; delete process.env.DEBAIT_API_KEY;
    }
    process.env.OPENAI_API_KEY = "dummy"; process.env.GROQ_API_KEY = "dummy"; assert.equal(chooseBackend(), "openai");
    process.env.DEBAIT_PROVIDER = "custom"; assert.equal(chooseBackend(), "custom");
    process.env.DEBAIT_BACKEND = "codex"; assert.equal(chooseBackend(), "codex");
    process.env.DEBAIT_BASE_URL = "http://localhost:8000/v1"; process.env.DEBAIT_MODEL = "fixture";
    process.env.CUSTOM_API_KEY = "owned"; process.env.DEBAIT_API_KEY = "generic";
    await withFetch(async (_url, opts) => { assert.equal(opts.headers.authorization, "Bearer owned"); return response(); }, () => complete("test", { backend: "custom" }));
    await withFetch(() => assert.fail("discovery must not fetch"), async () => {
      assert.throws(() => buildModelsRequest({ id: "custom" }), /discovery is unsupported/);
      await assert.rejects(listModels({ id: "custom" }), /discovery is unsupported/);
      delete process.env.DEBAIT_BASE_URL; delete process.env.DEBAIT_MODEL;
      await assert.rejects(cliModels("custom"), /discovery is unsupported/);
    });
  } finally { process.env = old; }
  for (const configured of [false, true]) {
    const env = envWithoutProviders();
    if (configured) Object.assign(env, { DEBAIT_BASE_URL: "https://fixture.invalid/v1", DEBAIT_MODEL: "fixture", CUSTOM_API_KEY: "dummy" });
    const r = await cli(["--models", "custom"], env); assert.equal(r.code, 2); assert.match(r.stderr, /discovery is unsupported/);
  }
  const endpoint = await server((req, res) => {
    assert.equal(req.url, "/v1/chat/completions"); assert.equal(req.headers.authorization, undefined);
    res.end(JSON.stringify({ choices: [{ message: { content: '{"honest_title":"Local result"}' } }] }));
  });
  try {
    const env = { ...envWithoutProviders(), DEBAIT_PROVIDER: "openai", DEBAIT_BACKEND: "codex", DEBAIT_BASE_URL: `${endpoint.base}/v1`, DEBAIT_MODEL: "fixture" };
    const r = await cli(["--stdin", "--backend", "custom", "--json"], env, "<article>local fixture</article>");
    assert.equal(r.code, 0, r.stderr); assert.equal(JSON.parse(r.stdout).result.honest_title, "Local result");
    for (const field of ["DEBAIT_BASE_URL", "DEBAIT_MODEL"]) {
      const invalid = { ...env }; delete invalid[field]; const r = await cli(["--stdin", "--backend", "custom"], invalid, "<article>fixture</article>");
      assert.equal(r.code, 3); assert.match(r.stderr, /explicit/);
    }
  } finally { await endpoint.close(); }
});

test("CLI custom malformed model output is sanitized instead of logged as parse_error raw", async () => {
  const { debait } = await import("../src/summarize.js");
  const old = { ...process.env };
  try {
    Object.assign(process.env, { DEBAIT_BASE_URL: "http://localhost:8000/v1", DEBAIT_MODEL: "fixture" });
    delete process.env.CUSTOM_API_KEY; delete process.env.DEBAIT_API_KEY;
    await withFetch(async () => response(sentinel), () => assert.rejects(debait({ text: "local article" }, { backend: "custom" }), clean));
  } finally { process.env = old; }
});

test("real native-fetch streaming HTTP error closes the response before its deadline", async () => {
  let closed;
  const responseClosed = new Promise((resolve) => closed = resolve);
  const fixture = await server((_req, res) => {
    res.on("close", closed);
    res.writeHead(429, { "content-type": "text/plain", "retry-after": "5" });
    res.write(sentinel); // headers arrive, but the error body never ends
  });
  let timer;
  try {
    await assert.rejects(callProvider(cfg({ base: `${fixture.base}/v1` }), sentinel, { timeoutMs: 5000 }),
      (e) => e.code === "quota" && e.status === 429 && e.retryAfterMs === 5000 && clean(e));
    await Promise.race([responseClosed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("HTTP error response remained open after rejection")), 1000);
    })]);
  } finally { clearTimeout(timer); await fixture.close(); }
});

test("real native-fetch deadlines cancel delayed headers and stalled successful body", async () => {
  const fixture = await server((req, res) => {
    if (req.url.startsWith("/headers")) return; // no headers until abort
    res.writeHead(200, { "content-type": "application/json" }); res.write('{"choices":['); // deliberately never end
  });
  try {
    for (const stage of ["headers", "body"]) await assert.rejects(callProvider(cfg({ base: `${fixture.base}/${stage}` }), sentinel, { timeoutMs: 30 }), (e) => e.code === "timeout" && clean(e));
  } finally { await fixture.close(); }
});
