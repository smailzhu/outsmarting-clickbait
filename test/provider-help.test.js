import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

export const helpUrls = {
  anthropic: "https://console.anthropic.com/settings/keys",
  gemini: "https://aistudio.google.com/apikey", groq: "https://console.groq.com/keys",
  openrouter: "https://openrouter.ai/settings/keys", xai: "https://console.x.ai/",
  together: "https://api.together.ai/settings/api-keys", nvidia: "https://build.nvidia.com/",
};
test("provider-help.js exposes only the seven frozen literal official destinations", () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(new URL("../extension/provider-help.js", import.meta.url), "utf8"), context);
  const helper = context.DebaitProviderHelp, urls = helper.PROVIDER_HELP_URLS;
  assert.ok(Object.isFrozen(helper)); assert.ok(Object.isFrozen(urls));
  assert.deepEqual(JSON.parse(JSON.stringify(urls)), helpUrls);
  const domains = ["anthropic.com", "google.com", "groq.com", "openrouter.ai", "x.ai", "together.ai", "nvidia.com"];
  Object.values(urls).forEach((raw, i) => {
    const u = new URL(raw); assert.equal(u.protocol, "https:");
    assert.ok(u.hostname.endsWith("." + domains[i]) || u.hostname === domains[i]);
    assert.equal(u.username + u.password + u.search + u.hash, "");
  });
  for (const id of ["openai", "deepseek", "mistral", "custom", "ollama", "", "unknown", "constructor", "toString", "__proto__"]) assert.equal(Object.hasOwn(urls, id), false);
});
