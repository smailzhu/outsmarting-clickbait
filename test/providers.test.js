import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvider, buildRequest, parseResponse, buildModelsRequest, parseModels, PROVIDERS } from "../shared/providers.js";

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
