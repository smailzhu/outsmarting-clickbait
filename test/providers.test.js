import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvider, buildRequest, parseResponse, buildModelsRequest, parseModels, listModels, PROVIDERS } from "../shared/providers.js";

test("resolveProvider fills defaults and trims trailing slash", () => {
  const c = resolveProvider({ provider: "openai", base: "https://x.test/v1/", key: "k" });
  assert.equal(c.format, "openai");
  assert.equal(c.base, "https://x.test/v1");
  assert.equal(c.model, PROVIDERS.openai.model);
});

test("resolveProvider rejects unknown providers", () => {
  assert.throws(() => resolveProvider({ provider: "nope" }), /Unknown provider/);
});

test("openai request shape", () => {
  const c = resolveProvider({ provider: "openai", key: "sk-1" });
  const r = buildRequest(c, "hi");
  assert.ok(r.url.endsWith("/chat/completions"));
  assert.equal(r.headers.authorization, "Bearer sk-1");
  const body = JSON.parse(r.body);
  assert.equal(body.messages[1].content, "hi");
});

test("anthropic request shape + browser header", () => {
  const c = resolveProvider({ provider: "anthropic", key: "sk-ant" });
  const r = buildRequest(c, "hi", { browser: true });
  assert.ok(r.url.endsWith("/messages"));
  assert.equal(r.headers["x-api-key"], "sk-ant");
  assert.equal(r.headers["anthropic-dangerous-direct-browser-access"], "true");
  const body = JSON.parse(r.body);
  assert.equal(body.system.length > 0, true);
  assert.equal(body.messages[0].content, "hi");
});

test("gemini request shape puts key + model in URL", () => {
  const c = resolveProvider({ provider: "gemini", key: "g-key", model: "gemini-1.5-flash" });
  const r = buildRequest(c, "hi");
  assert.match(r.url, /models\/gemini-1\.5-flash:generateContent\?key=g-key/);
  const body = JSON.parse(r.body);
  assert.equal(body.contents[0].parts[0].text, "hi");
});

test("openai-compatible gateways reuse openai format", () => {
  for (const id of ["groq", "openrouter", "deepseek", "xai", "mistral", "together", "ollama"]) {
    assert.equal(PROVIDERS[id].format, "openai", `${id} should be openai format`);
  }
});

test("parseResponse extracts text per format", () => {
  assert.equal(parseResponse("openai", { choices: [{ message: { content: "A" } }] }), "A");
  assert.equal(parseResponse("anthropic", { content: [{ text: "B" }] }), "B");
  assert.equal(parseResponse("gemini", { candidates: [{ content: { parts: [{ text: "C" }] } }] }), "C");
});

test("buildModelsRequest targets the right endpoint per format", () => {
  assert.match(buildModelsRequest(resolveProvider({ provider: "openai", key: "k" })).url, /\/models$/);
  const anth = buildModelsRequest(resolveProvider({ provider: "anthropic", key: "k" }));
  assert.equal(anth.headers["x-api-key"], "k");
  assert.match(anth.url, /\/models\?limit=/);
  assert.match(buildModelsRequest(resolveProvider({ provider: "gemini", key: "gk" })).url, /\/models\?pageSize=1000&key=gk/);
});

test("parseModels extracts ids per format", () => {
  assert.deepEqual(parseModels("openai", { data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o" }] }), ["gpt-4o-mini", "gpt-4o"]);
  assert.deepEqual(
    parseModels("gemini", { models: [{ name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }] }),
    ["gemini-flash-latest"]
  );
});

test("xai default is no longer the retired grok-2", () => {
  assert.notEqual(PROVIDERS.xai.model, "grok-2-latest");
});

test("openai-format request omits Authorization when there is no key (Ollama)", () => {
  const c = resolveProvider({ provider: "ollama" });
  const r = buildRequest(c, "hi");
  assert.equal(r.headers.authorization, undefined);
  assert.ok(r.url.endsWith("/chat/completions"));
});

test("openai-format request includes Authorization when a key is set", () => {
  const r = buildRequest(resolveProvider({ provider: "openai", key: "sk-x" }), "hi");
  assert.equal(r.headers.authorization, "Bearer sk-x");
});

test("listModels paginates and replaces the cursor (no accumulation, terminates)", async () => {
  const realFetch = global.fetch;
  const calls = [];
  const mk = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
  global.fetch = async (url) => {
    calls.push(url);
    return url.includes("pageToken")
      ? mk({ models: [{ name: "models/b" }] }) // last page: no nextPageToken
      : mk({ models: [{ name: "models/a" }], nextPageToken: "T1" });
  };
  try {
    const models = await listModels(resolveProvider({ provider: "gemini", key: "k" }));
    assert.deepEqual(models, ["a", "b"]);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes("pageToken=T1"));
    // cursor replaced, not accumulated:
    assert.equal((calls[1].match(/pageToken/g) || []).length, 1);
  } finally {
    global.fetch = realFetch;
  }
});
