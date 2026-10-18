import { test } from "node:test";
import assert from "node:assert/strict";
import { isOptionsSender, testConnection } from "../extension/connection-test.js";

const settings = { provider: "openai", key: "test-secret", base: "", model: "" };
const reply = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test("connection tests authorize only this extension's options page", () => {
  const runtime = { id: "abc", getURL: (path) => `chrome-extension://abc/${path}` };
  assert.equal(isOptionsSender({ id: "abc", url: runtime.getURL("options.html") }, runtime), true);
  assert.equal(isOptionsSender({ id: "abc", url: runtime.getURL("options.html#settings") }, runtime), true);
  for (const sender of [null, {}, { id: "other", url: runtime.getURL("options.html") },
    { id: "abc", url: "https://example.com/options.html" },
    { id: "abc", url: runtime.getURL("options.html/evil") }]) {
    assert.equal(isOptionsSender(sender, runtime), false);
  }
});

test("testConnection validates before sending, including keyless Ollama exception", async () => {
  const unexpectedFetch = () => assert.fail("Should not call provider");
  assert.deepEqual(await testConnection({ ...settings, key: " " }, { fetchImpl: unexpectedFetch }),
    { ok: false, code: "missing_key" });
  for (const values of [null, { ...settings, provider: "unknown" }, { ...settings, key: {} },
    { ...settings, base: "not a url" }, { ...settings, base: "file:///tmp/test" },
    { ...settings, base: "https://user:password@example.com/v1" },
    { ...settings, base: "https://example.com/v1?key=test-secret" }]) {
    assert.deepEqual(await testConnection(values, { fetchImpl: unexpectedFetch }),
      { ok: false, code: "settings" });
  }
  let calls = 0;
  const result = await testConnection({ provider: "ollama" }, { fetchImpl: async (url, req) => {
    calls++;
    assert.equal(url, "http://localhost:11434/v1/chat/completions");
    assert.equal(req.headers.authorization, undefined);
    return reply({ choices: [{ message: { content: "OK" } }] });
  } });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test("testConnection uses current form overrides and one capped generation call per format", async () => {
  for (const [provider, response] of [
    ["openai", { choices: [{ message: { content: "OK" } }] }],
    ["anthropic", { content: [{ type: "text", text: "OK" }] }],
    ["gemini", { candidates: [{ content: { parts: [{ text: "OK" }] } }] }],
  ]) {
    let calls = 0;
    const result = await testConnection({ provider, key: " unsaved-secret ", base: "https://gateway.example/v1/", model: "my-model" }, {
      fetchImpl: async (url, req) => {
        calls++;
        assert.ok(url.startsWith("https://gateway.example/v1/"));
        assert.equal(req.method, "POST");
        assert.equal(req.credentials, "omit");
        assert.equal(req.redirect, "error");
        const body = JSON.parse(req.body);
        if (provider === "gemini") {
          assert.ok(url.includes("my-model:generateContent"));
          assert.equal(body.generationConfig.maxOutputTokens, 2048);
        } else {
          assert.equal(body.model, "my-model");
          assert.equal(body.max_tokens, 128);
        }
        assert.ok(JSON.stringify(body).includes("Connection test: reply with the single word OK."));
        return reply(response);
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { ok: true, code: "success" });
  }
});

test("HTTP failures are classified without echoing credentials or upstream data", async () => {
  for (const [status, code] of [[401, "auth"], [403, "access"], [404, "model"], [429, "quota"], [500, "http"]]) {
    const result = await testConnection(settings, { fetchImpl: async () => ({
      ok: false, status, text: async () => { throw new Error("test-secret should not be read"); },
    }) });
    assert.deepEqual(result, { ok: false, code, status });
    assert.ok(!JSON.stringify(result).includes("test-secret"));
  }
});

test("malformed, empty and blocked responses are not reported as success", async () => {
  assert.deepEqual(await testConnection(settings, { fetchImpl: async () => ({
    ok: true, text: async () => "not JSON",
  }) }), { ok: false, code: "response" });
  assert.deepEqual(await testConnection(settings, { fetchImpl: async () => reply({ choices: [] }) }),
    { ok: false, code: "empty" });
  assert.deepEqual(await testConnection(settings, { fetchImpl: async () => {
    throw new Error("https://example.com/?key=test-secret");
  } }), { ok: false, code: "network" });
});

test("body-read failures report a network error, not malformed JSON", async () => {
  const result = await testConnection(settings, { fetchImpl: async () => ({
    ok: true, status: 200, text: async () => { throw new TypeError("terminated test-secret"); },
  }) });
  assert.deepEqual(result, { ok: false, code: "network" });
});

test("Gemini thinking families use bounded model-specific controls, aliases do not guess", async () => {
  for (const [model, limit, thinking] of [
    ["gemini-2.5-flash", 128, { thinkingBudget: 0 }],
    ["gemini-2.5-pro", 1024, { thinkingBudget: 128 }],
    ["gemini-3-flash-preview", 2048, { thinkingLevel: "minimal" }],
    ["gemini-3.1-pro-preview", 2048, { thinkingLevel: "low" }],
    ["gemini-3.8-flash", 2048, undefined],
    ["gemini-3.8-pro", 2048, undefined],
    ["gemini-2.5-flash-new-variant", 2048, undefined],
    ["gemini-flash-latest", 2048, undefined],
    ["custom-model", 2048, undefined],
  ]) {
    let calls = 0;
    const result = await testConnection({ provider: "gemini", key: "test-key", model }, {
      fetchImpl: async (_url, req) => {
        calls++;
        const cfg = JSON.parse(req.body).generationConfig;
        assert.equal(cfg.maxOutputTokens, limit);
        assert.deepEqual(cfg.thinkingConfig, thinking);
        return reply({ candidates: [{ content: { parts: [{ text: "OK" }] } }] });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
  }
});

test("thinking-only token exhaustion does not suggest an invalid key", async () => {
  const result = await testConnection({ provider: "gemini", key: "test-key" }, {
    fetchImpl: async () => reply({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }),
  });
  assert.deepEqual(result, { ok: false, code: "budget" });
});

test("timeout covers body reading as well as fetching", async () => {
  for (const stallInBody of [false, true]) {
    const result = await testConnection(settings, { timeoutMs: 10, fetchImpl: async (_url, { signal }) => {
      const stall = () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted test-secret")), { once: true });
      });
      if (!stallInBody) return stall();
      return { ok: true, status: 200, text: stall };
    } });
    assert.deepEqual(result, { ok: false, code: "timeout" });
  }
});
