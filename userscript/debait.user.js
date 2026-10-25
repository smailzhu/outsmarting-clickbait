// ==UserScript==
// @name         debait — outsmart clickbait
// @namespace    https://github.com/smailzhu/outsmarting-clickbait
// @version      0.1.0
// @description  Reads the current article and shows an honest title, summary, and clickbait score. Inspired by wiwi.blog/blog/outsmarting-clickbait
// @author       smailzhu
// @match        *://*/*
// @sandbox      DOM
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @connect      api.deepseek.com
// @connect      api.x.ai
// @connect      api.mistral.ai
// @connect      api.together.xyz
// @connect      integrate.api.nvidia.com
// @connect      localhost
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* global GM_info, GM_xmlhttpRequest, GM_setValue, GM_getValue, GM_registerMenuCommand */
(function () {
  "use strict";

  // BEGIN GENERATED CUSTOM HELPERS (npm run sync)
  const CustomProtocol = (() => {
// Multi-provider abstraction. Browser-safe (pure + fetch), reused by the CLI,
// the Chromium extension, and (inlined) the userscript.
//
// Three wire formats cover the major providers:
//   - "openai"    : POST {base}/chat/completions   (OpenAI + all compatible gateways)
//   - "anthropic" : POST {base}/messages           (Claude)
//   - "gemini"    : POST {base}/models/{model}:generateContent?key=...
//
// OpenAI-compatible gateways (Groq, OpenRouter, DeepSeek, xAI, Mistral, Together,
// Ollama, LM Studio, ...) just reuse the "openai" format with a different base.

const SYSTEM =
  "You are a precise editor. Respond with exactly the requested format, nothing else.";

// Capability overrides are centralized here; native providers require keys,
// support discovery and participate in auto-selection unless overridden.
const PROVIDERS = {
  openai:     { format: "openai",    base: "https://api.openai.com/v1",              model: "gpt-4o-mini",             keyEnv: "OPENAI_API_KEY" },
  anthropic:  { format: "anthropic", base: "https://api.anthropic.com/v1",           model: "claude-3-5-haiku-latest", keyEnv: "ANTHROPIC_API_KEY" },
  gemini:     { format: "gemini",    base: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-flash-latest", keyEnv: "GEMINI_API_KEY" },
  groq:       { format: "openai",    base: "https://api.groq.com/openai/v1",         model: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY" },
  openrouter: { format: "openai",    base: "https://openrouter.ai/api/v1",           model: "openai/gpt-4o-mini",      keyEnv: "OPENROUTER_API_KEY" },
  deepseek:   { format: "openai",    base: "https://api.deepseek.com/v1",            model: "deepseek-chat",           keyEnv: "DEEPSEEK_API_KEY" },
  xai:        { format: "openai",    base: "https://api.x.ai/v1",                    model: "grok-3",                  keyEnv: "XAI_API_KEY" },
  mistral:    { format: "openai",    base: "https://api.mistral.ai/v1",              model: "mistral-small-latest",    keyEnv: "MISTRAL_API_KEY" },
  together:   { format: "openai",    base: "https://api.together.xyz/v1",            model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", keyEnv: "TOGETHER_API_KEY" },
  nvidia:     { format: "openai",    base: "https://integrate.api.nvidia.com/v1",    model: "meta/llama-3.3-70b-instruct", keyEnv: "NVIDIA_API_KEY" },
  custom:     { format: "openai", base: "", model: "", keyEnv: "CUSTOM_API_KEY", keyRequired: false, discovery: false, autoSelect: false },
  ollama:     { keyRequired: false, format: "openai",    base: "http://localhost:11434/v1",              model: "llama3.1",                keyEnv: "OLLAMA_API_KEY" },
};

function providerCapabilities(id) {
  const def = PROVIDERS[id];
  return { keyRequired: def?.keyRequired !== false, discovery: def?.discovery !== false,
    autoSelect: def?.autoSelect !== false };
}

const CUSTOM_DISCOVERY_ERROR = "Custom / OpenAI-compatible supports Chat Completions only; model discovery is unsupported. Set an explicit base URL and model.";

class CustomProviderError extends Error {}

function customError(code, status, retryAfterMs) {
  const messages = {
    settings: "Custom settings require an explicit HTTP(S) API base URL and model; key is optional.",
    suffix: "Use the API base URL, not the /chat/completions endpoint.",
    https: "A key requires HTTPS except on loopback (localhost, 127/8, or ::1).",
    http: "Custom endpoint rejected the request.", quota: "Custom endpoint rate limit (429).",
    response: "Custom endpoint returned an invalid JSON completion response.",
    empty: "Custom endpoint returned an empty completion.",
    timeout: "Custom request timed out.", network: "Custom request failed (network, redirect, or body read).",
  };
  const error = new CustomProviderError(messages[code] || messages.network);
  error.code = code;
  if (status !== undefined) error.status = status;
  if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
  return error;
}

function validateCustom({ base, model, key = "" } = {}) {
  if ([base, model, key].some((v) => typeof v !== "string")) throw customError("settings");
  base = base.trim(); model = model.trim(); key = key.trim();
  let url;
  try { url = new URL(base); } catch { throw customError("settings"); }
  if (!model || !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || base.includes("?") || base.includes("#")) throw customError("settings");
  base = url.href.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(url.pathname.replace(/\/+$/, ""))) throw customError("suffix");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "::1" ||
    /^127\.\d+\.\d+\.\d+$/.test(host);
  if (key && url.protocol !== "https:" && !loopback) throw customError("https");
  return { id: "custom", format: "openai", base, model, key };
}

function validateConfiguration(cfg) {
  const validated = cfg.id === "custom" ? validateCustom(cfg) : cfg;
  if (providerCapabilities(validated.id).keyRequired && !validated.key) {
    throw new Error(`No API key for provider "${validated.id}".`);
  }
  return validated;
}

function resolveProvider({ provider, base, model, key } = {}) {
  if (typeof provider !== "undefined" && typeof provider !== "string") throw customError("settings");
  const id = (provider || "openai").trim().toLowerCase();
  if (id === "custom") return validateCustom({ base, model, key });
  const def = PROVIDERS[id];
  if (!def) throw new Error(`Unknown provider "${id}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  return {
    id,
    format: def.format,
    base: (base || def.base).replace(/\/+$/, ""),
    model: model || def.model,
    key: key || "",
  };
}

// Returns { url, method, headers, body } for a single completion request.
function buildRequest(cfg, prompt, { browser = false, maxOutputTokens } = {}) {
  const { format, base, model, key } = cfg;

  if (format === "anthropic") {
    const headers = {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
    // Required for direct calls from a browser/extension/userscript origin.
    if (browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
    return {
      url: `${base}/messages`,
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens ?? 1024,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      }),
    };
  }

  if (format === "gemini") {
    return {
      url: `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}) },
      }),
    };
  }

  // openai + all compatible gateways
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`; // omit for keyless (e.g. local Ollama)
  return {
    url: `${base}/chat/completions`,
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      ...(maxOutputTokens !== undefined ? { max_tokens: maxOutputTokens } : {}),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  };
}

function parseResponse(format, data) {
  if (format === "anthropic") {
    return (data?.content || []).map((p) => p.text || "").join("").trim();
  }
  if (format === "gemini") {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || "").join("").trim();
  }
  return (data?.choices?.[0]?.message?.content || "").trim();
}

// Convenience one-shot using global fetch (works in Node 20+, extension SW, and
// userscript pages — though userscripts prefer GM_xmlhttpRequest for CORS).
// ---- model discovery ------------------------------------------------------
// Build a GET request that lists the models available to this key.
function buildModelsRequest(cfg, { browser = false } = {}) {
  if (!providerCapabilities(cfg.id).discovery) throw new Error(CUSTOM_DISCOVERY_ERROR);
  const { format, base, key } = cfg;
  if (format === "anthropic") {
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    if (browser) headers["anthropic-dangerous-direct-browser-access"] = "true";
    return { url: `${base}/models?limit=1000`, headers };
  }
  if (format === "gemini") {
    return { url: `${base}/models?pageSize=1000&key=${encodeURIComponent(key)}`, headers: {} };
  }
  return { url: `${base}/models`, headers: key ? { authorization: `Bearer ${key}` } : {} };
}

function parseModels(format, data) {
  if (format === "gemini") {
    return (data?.models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => (m.name || "").replace(/^models\//, ""))
      .filter(Boolean);
  }
  return (data?.data || []).map((m) => m.id).filter(Boolean);
}

// fetch + read the FULL body under a single abort deadline, so a provider that
// sends headers then stalls mid-body can't hang forever. Returns {ok,status,text}.
async function fetchTextWithTimeout(url, opts = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text(); // read within the timeout window
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error(`Request timed out after ${ms}ms.`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new Error("Provider returned non-JSON response."); }
}

// Set/replace a query param on a URL (replaces, so cursors don't accumulate).
function withParam(url, key, value) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

// Build the URL for the next page of a models listing, or null when done.
function nextModelsPageUrl(cfg, currentUrl, data) {
  if (cfg.format === "gemini" && data?.nextPageToken) {
    return withParam(currentUrl, "pageToken", data.nextPageToken);
  }
  if (cfg.format === "anthropic" && data?.has_more && data?.last_id) {
    return withParam(currentUrl, "after_id", data.last_id);
  }
  return null; // openai-compatible list in a single page
}

async function listModels(cfg, { browser = false, maxPages = 20 } = {}) {
  const { headers, url: firstUrl } = buildModelsRequest(cfg, { browser });
  let url = firstUrl;
  let prevUrl = null;
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchTextWithTimeout(url, { headers }, 30000);
    if (!res.ok) throw new Error(`API ${res.status}: ${res.text.slice(0, 200)}`);
    const data = parseJson(res.text);
    all.push(...parseModels(cfg.format, data));
    const next = nextModelsPageUrl(cfg, url, data);
    if (!next || next === url || next === prevUrl) break; // guard against loops
    prevUrl = url;
    url = next;
  }
  return [...new Set(all)].sort();
}

// Custom transport never follows redirects or carries ambient cookies. One
// deadline covers headers AND body; all exceptions are replaced with safe errors.
async function fetchCustomText(req, { fetchImpl = globalThis.fetch, timeoutMs = 60000, AbortControllerImpl = globalThis.AbortController } = {}) {
  const ctrl = new AbortControllerImpl();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(customError("timeout")); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const res = await fetchImpl(req.url, { method: req.method, headers: req.headers, body: req.body,
        credentials: "omit", redirect: "error", signal: ctrl.signal });
      if (!res.ok) {
        const value = res.headers?.get("retry-after");
        const seconds = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : 0;
        const delay = Math.min(Math.max(seconds * 1000 || 30000, 5000), 300000);
        const error = customError(res.status === 429 ? "quota" : "http", res.status, delay);
        ctrl.abort(); // Release unread error bodies before clearing the deadline.
        throw error;
      }
      return await res.text();
    })()]);
  } catch (e) {
    if (e instanceof CustomProviderError) throw e;
    throw customError(ctrl.signal.aborted ? "timeout" : "network");
  } finally { clearTimeout(timer); }
}

async function callProvider(cfg, prompt, { browser = false, timeoutMs = 60000 } = {}) {
  cfg = validateConfiguration(cfg);
  const req = buildRequest(cfg, prompt, { browser });
  if (cfg.id === "custom") {
    const raw = await fetchCustomText(req, { timeoutMs });
    let text;
    try { text = parseResponse(cfg.format, JSON.parse(raw)); } catch { throw customError("response"); }
    if (!text) throw customError("empty");
    return text;
  }
  const res = await fetchTextWithTimeout(req.url, { method: req.method, headers: req.headers, body: req.body }, timeoutMs);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.text.slice(0, 300)}`);
  const data = parseJson(res.text);
  const text = parseResponse(cfg.format, data);
  if (!text) throw new Error("Empty response from provider.");
  return text;
}

return { validateCustom, buildRequest, parseResponse, fetchCustomText, providerCapabilities };
  })();
  const ProfileProtocol = (() => { const profileScope = {};
// Presence, not truthiness, determines ownership. An existing profile is
// authoritative even when empty; obsolete mirrors must never refill it.
(function (root) {
  const owns = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const normalize = (profile) => Object.fromEntries(["key", "base", "model"].map((field) => [field, text(profile?.[field])]));
  function migrate(settings, providerIds) {
    const active = settings.provider || "openai";
    const profiles = { ...settings.profiles };
    for (const id of providerIds) {
      if (owns(profiles, id)) { profiles[id] = normalize(profiles[id]); continue; }
      profiles[id] = {
        key: owns(settings.keys, id) ? text(settings.keys[id]) : id === active ? text(settings.key) : "",
        base: id === active ? text(settings.base) : "",
        model: id === active ? text(settings.model) : "",
      };
    }
    return { ...settings, profiles, ...normalize(profiles[active]) };
  }
  root.DebaitProfiles = { migrate, normalize, owns };
})(profileScope);

return profileScope.DebaitProfiles; })();
  // END GENERATED CUSTOM HELPERS

  // ---- providers ------------------------------------------------------------
  const SYSTEM = "You are a precise editor. Respond with exactly the requested format, nothing else.";
  const PROVIDERS = {
    openai:     { format: "openai",    base: "https://api.openai.com/v1",              model: "gpt-4o-mini" },
    anthropic:  { format: "anthropic", base: "https://api.anthropic.com/v1",           model: "claude-3-5-haiku-latest" },
    gemini:     { format: "gemini",    base: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-flash-latest" },
    groq:       { format: "openai",    base: "https://api.groq.com/openai/v1",         model: "llama-3.3-70b-versatile" },
    openrouter: { format: "openai",    base: "https://openrouter.ai/api/v1",           model: "openai/gpt-4o-mini" },
    deepseek:   { format: "openai",    base: "https://api.deepseek.com/v1",            model: "deepseek-chat" },
    xai:        { format: "openai",    base: "https://api.x.ai/v1",                    model: "grok-3" },
    mistral:    { format: "openai",    base: "https://api.mistral.ai/v1",              model: "mistral-small-latest" },
    together:   { format: "openai",    base: "https://api.together.xyz/v1",            model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    nvidia:     { format: "openai",    base: "https://integrate.api.nvidia.com/v1",    model: "meta/llama-3.3-70b-instruct" },
    custom:     { format: "openai", base: "", model: "" },
    ollama:     { format: "openai",    base: "http://localhost:11434/v1",              model: "llama3.1" },
  };

  // ---- i18n (UI chrome) -----------------------------------------------------
  const I18N = {
    en: {
      customProvider: "Custom / OpenAI-compatible",
      customGuidance: "Custom requires an explicit API base URL and model; the key is optional. Trust the endpoint with your article data and any key. Keyless remote HTTP sends content UNENCRYPTED (observable and modifiable in transit). A key requires HTTPS except on loopback. Chat Completions only; no model discovery or automatic retries. Userscript custom requires Tampermonkey ≥4.18 on Chromium, DOM-isolated sandbox, and a CORS-compatible endpoint; extension/CLI may work where direct Fetch cannot.",
      errCustomSettings: "Custom: enter an explicit HTTP(S) API base URL and model. Key is optional. No credentials, query, fragment, or /chat/completions suffix in the base; a key requires HTTPS except on loopback.",
      errStale: "Settings changed; this result was discarded. Try again explicitly.",
      errCustomTransport: "Custom requires Tampermonkey ≥4.18 on Chromium with the DOM-isolated sandbox and native Fetch controls. Use the extension/CLI or a supported isolated environment and CORS-compatible endpoint. No GM/page fallback.",
      promptCustomModel: "Custom model (required; no discovery):",
      promptCustomBase: "Custom API BASE URL (required; not /chat/completions). Keyless HTTP is unencrypted:",
      customError_http: "Custom endpoint rejected the request.",
      customError_quota: "Custom endpoint rate limit (429).",
      customError_response: "Custom endpoint returned an invalid JSON completion response.",
      customError_empty: "Custom endpoint returned an empty completion.",
      customError_timeout: "Custom request timed out.",
      customError_network: "Custom request failed (network, redirect, body read, or CORS).",
      brand: "debait", labelOriginal: "Original", labelHonest: "Honest title",
      labelSummary: "Summary", labelKeyPoints: "Key points", labelBaitSignals: "Bait signals",
      metaClickbait: "clickbait", metaWorth: "worth clicking:", yes: "yes", no: "no",
      verdict_substantial: "substantial", verdict_thin: "thin", verdict_empty: "empty",
      panelReading: "Reading the page\u2026", errGeneric: "debait error",
      errParse: "Could not parse model output.", closeTitle: "close",
      tipReading: "reading\u2026", tipThin: "couldn't read body (JS-rendered/paywalled).",
      tipThrottled: "slow down \u2014 hover one link at a time. Try again in a moment.",
      tipRateLimited: "rate limited by provider. Cooling down ~$1s (hover again later).",
      tipCapped: "daily preview limit reached ($1/$2). Raise it via the menu.",
      errNoKey: "No API key for \"$1\". Use the menu to set it.", launcherTitle: "debait this page",
      menuChooseProvider: "debait: choose provider",
      menuSetKey: "debait: set API key (current provider)",
      menuSetLanguage: "debait: set output language",
      menuSetInstructions: "debait: set custom instructions",
      promptInstructions: "Custom instructions appended to the prompt (the JSON output shape is kept). Blank to clear:",
      menuSetLimits: "debait: set preview limits",
      menuShowUsage: "debait: show today usage",
      menuSetModel: "debait: set model override",
      menuSetBase: "debait: set base URL override",
      menuAnalyze: "debait: analyze this page",
      promptProvider: "Provider \u2014 one of:\n$1",
      alertUnknownProvider: "Unknown provider.",
      promptSetKey: "API key for \"$1\" (stored locally; optional for Custom):",
      promptLanguage: "Output language for title/summary (blank = auto, match article):\ne.g. English, \u7e41\u9ad4\u4e2d\u6587, \u65e5\u672c\u8a9e, Espa\u00f1ol",
      promptDwell: "Hover dwell in ms before a preview fires:",
      promptInterval: "Minimum ms between preview calls:",
      promptDailyCap: "Daily preview cap (0 = unlimited):",
      alertNonNegative: "Please enter a non-negative number.",
      usageAlertPrefix: "debait preview calls today: ",
      usageNoCap: "(no cap)",
      promptModel: "Model (blank = provider default):",
      promptBase: "Base URL (blank = provider default):",
    },
    zh_TW: {
      customProvider: "自訂 / OpenAI 相容",
      customGuidance: "自訂需明確填入 API 基底網址與模型，金鑰可留空。端點會收到文章資料與任何設定的金鑰，請只使用可信任端點。無金鑰遠端 HTTP 的內容未加密，可遭監看或竄改。有金鑰時須用 HTTPS，回環位址除外。僅支援 Chat Completions，無模型探索或自動重試。使用者腳本需 Chromium 上的 Tampermonkey ≥4.18、DOM 隔離沙箱與 CORS 相容端點；擴充功能／CLI 可能可用而直接 Fetch 不可用。",
      errCustomSettings: "自訂：請填入 HTTP(S) API 基底網址與模型；金鑰可留空。網址不可含帳密、查詢、片段或 /chat/completions 後綴。有金鑰須用 HTTPS，回環位址除外。",
      errStale: "設定已變更，結果已捨棄。請自行再試一次。",
      errCustomTransport: "自訂需 Chromium 上的 Tampermonkey ≥4.18、DOM 隔離沙箱與原生 Fetch 控制。請用擴充功能／CLI 或支援的隔離環境及 CORS 相容端點。不會回退至 GM 或網頁傳輸。",
      promptCustomModel: "自訂模型（必填，無模型探索）：",
      promptCustomBase: "自訂 API 基底網址（必填，不含 /chat/completions）。無金鑰 HTTP 未加密：",
      customError_http: "自訂端點拒絕請求。",
      customError_quota: "自訂端點限流（429）。",
      customError_response: "自訂端點回傳無效的 JSON 完成回應。",
      customError_empty: "自訂端點回傳空白結果。",
      customError_timeout: "自訂請求逾時。",
      customError_network: "自訂請求失敗（網路、重新導向、讀取內文或 CORS）。",
      brand: "debait", labelOriginal: "\u539f\u59cb\u6a19\u984c", labelHonest: "\u8aa0\u5be6\u6a19\u984c",
      labelSummary: "\u6458\u8981", labelKeyPoints: "\u91cd\u9ede", labelBaitSignals: "\u9a19\u9ede\u95b1\u624b\u6cd5",
      metaClickbait: "\u9a19\u9ede\u95b1", metaWorth: "\u503c\u5f97\u9ede\u64ca\uff1a", yes: "\u662f", no: "\u5426",
      verdict_substantial: "\u6709\u6599", verdict_thin: "\u55ae\u8584", verdict_empty: "\u7a7a\u6d1e",
      panelReading: "\u6b63\u5728\u8b80\u53d6\u9801\u9762\u2026", errGeneric: "debait \u932f\u8aa4",
      errParse: "\u7121\u6cd5\u89e3\u6790\u6a21\u578b\u8f38\u51fa\u3002", closeTitle: "\u95dc\u9589",
      tipReading: "\u8b80\u53d6\u4e2d\u2026", tipThin: "\u7121\u6cd5\u8b80\u53d6\u5167\u6587\uff08JS \u52d5\u614b\u7522\u751f\u6216\u4ed8\u8cbb\u7246\uff09\u3002",
      tipThrottled: "\u6162\u4e00\u9ede \u2014 \u4e00\u6b21\u61f8\u505c\u4e00\u500b\u9023\u7d50\uff0c\u7a0d\u5f8c\u518d\u8a66\u3002",
      tipRateLimited: "\u4f9b\u61c9\u5546\u9650\u6d41\u4e2d\uff0c\u7d04 $1 \u79d2\u5f8c\u6062\u5fa9\uff08\u7a0d\u5f8c\u518d\u61f8\u505c\uff09\u3002",
      tipCapped: "\u5df2\u9054\u6bcf\u65e5\u9810\u89bd\u4e0a\u9650\uff08$1/$2\uff09\u3002\u53ef\u5728\u9078\u55ae\u4e2d\u8abf\u9ad8\u3002",
      errNoKey: "\u5c1a\u672a\u8a2d\u5b9a\u300c$1\u300d\u7684 API \u91d1\u9470\uff0c\u8acb\u7528\u9078\u55ae\u8a2d\u5b9a\u3002", launcherTitle: "debait \u9019\u500b\u9801\u9762",
      menuChooseProvider: "debait\uff1a\u9078\u64c7\u4f9b\u61c9\u5546",
      menuSetKey: "debait\uff1a\u8a2d\u5b9a API \u91d1\u9470\uff08\u76ee\u524d\u4f9b\u61c9\u5546\uff09",
      menuSetLanguage: "debait\uff1a\u8a2d\u5b9a\u8f38\u51fa\u8a9e\u8a00",
      menuSetInstructions: "debait\uff1a\u8a2d\u5b9a\u81ea\u8a02\u6307\u793a",
      promptInstructions: "\u9644\u52a0\u5230\u63d0\u793a\u8a5e\u7684\u81ea\u8a02\u6307\u793a\uff08\u4ecd\u7dad\u6301 JSON \u8f38\u51fa\u683c\u5f0f\uff09\u3002\u7559\u7a7a\u53ef\u6e05\u9664\uff1a",
      menuSetLimits: "debait\uff1a\u8a2d\u5b9a\u9810\u89bd\u9650\u5236",
      menuShowUsage: "debait\uff1a\u986f\u793a\u4eca\u65e5\u4f7f\u7528\u91cf",
      menuSetModel: "debait\uff1a\u8a2d\u5b9a\u6a21\u578b\u8986\u5beb",
      menuSetBase: "debait\uff1a\u8a2d\u5b9a\u57fa\u5e95\u7db2\u5740\u8986\u5beb",
      menuAnalyze: "debait\uff1a\u5206\u6790\u9019\u500b\u9801\u9762",
      promptProvider: "\u4f9b\u61c9\u5546 \u2014 \u4ee5\u4e0b\u5176\u4e2d\u4e4b\u4e00\uff1a\n$1",
      alertUnknownProvider: "\u672a\u77e5\u7684\u4f9b\u61c9\u5546\u3002",
      promptSetKey: "\u300c$1\u300d\u7684 API \u91d1\u9470\uff08\u5132\u5b58\u5728\u672c\u6a5f\uff09\uff1a",
      promptLanguage: "\u6a19\u984c\uff0f\u6458\u8981\u7684\u8f38\u51fa\u8a9e\u8a00\uff08\u7559\u7a7a\uff1d\u81ea\u52d5\uff0c\u8207\u6587\u7ae0\u4e00\u81f4\uff09\uff1a\n\u4f8b\u5982 English\u3001\u7e41\u9ad4\u4e2d\u6587\u3001\u65e5\u672c\u8a9e\u3001Espa\u00f1ol",
      promptDwell: "\u89f8\u767c\u9810\u89bd\u524d\u7684\u61f8\u505c\u5ef6\u9072\uff08\u6beb\u79d2\uff09\uff1a",
      promptInterval: "\u9810\u89bd\u547c\u53eb\u4e4b\u9593\u7684\u6700\u5c0f\u9593\u9694\uff08\u6beb\u79d2\uff09\uff1a",
      promptDailyCap: "\u6bcf\u65e5\u9810\u89bd\u4e0a\u9650\uff080 \uff1d \u7121\u9650\u5236\uff09\uff1a",
      alertNonNegative: "\u8acb\u8f38\u5165\u975e\u8ca0\u6574\u6578\u3002",
      usageAlertPrefix: "debait \u4eca\u65e5\u9810\u89bd\u547c\u53eb\u6b21\u6578\uff1a",
      usageNoCap: "\uff08\u7121\u4e0a\u9650\uff09",
      promptModel: "\u6a21\u578b\uff08\u7559\u7a7a\uff1d\u4f9b\u61c9\u5546\u9810\u8a2d\uff09\uff1a",
      promptBase: "\u57fa\u5e95\u7db2\u5740\uff08\u7559\u7a7a\uff1d\u4f9b\u61c9\u5546\u9810\u8a2d\uff09\uff1a",
    },
  };
  I18N["nan-Hanlo"] = { ...I18N.zh_TW, "customProvider": "自訂 / OpenAI 相容", "customGuidance": "自訂愛填 API 基底網址佮模型，金鑰會使留空。端點會收著文章資料佮金鑰，請用信任的端點。無金鑰的遠端 HTTP 內容無加密，會予人監看抑是改掉。有金鑰愛用 HTTPS，loopback 除外。干焦支援 Chat Completions，無模型探索抑是自動重試。使用者腳本愛 Chromium 頂的 Tampermonkey ≥4.18、DOM 隔離沙箱佮 CORS 相容端點；擴充功能／CLI 可能會使，直接 Fetch 袂使。", "errCustomSettings": "自訂：請填 HTTP(S) API 基底網址佮模型；金鑰會使留空。網址袂使含帳密、查詢、片段抑是 /chat/completions 後綴。有金鑰愛用 HTTPS，loopback 除外。", "errStale": "設定改矣，結果已經放棄。請家己閣試一擺。", "errCustomTransport": "自訂愛 Chromium 頂的 Tampermonkey ≥4.18、DOM 隔離沙箱佮原生 Fetch 控制。請用擴充功能／CLI 抑是支援的隔離環境佮 CORS 相容端點。袂退轉用 GM 抑是網頁傳輸。", "promptCustomModel": "自訂模型（必填，無模型探索）：", "promptCustomBase": "自訂 API 基底網址（必填，毋免 /chat/completions）。無金鑰 HTTP 無加密：", "customError_http": "自訂端點拒絕請求。", "customError_quota": "自訂端點限流（429）。", "customError_response": "自訂端點傳轉無效的 JSON 回應。", "customError_empty": "自訂端點傳轉空白結果。", "customError_timeout": "自訂請求超過時間。", "customError_network": "自訂請求失敗（網路、重新導向、讀取內文抑是 CORS）。", "brand": "debait", "labelOriginal": "原本標題", "labelHonest": "老實標題", "labelSummary": "摘要", "labelKeyPoints": "重點", "labelBaitSignals": "騙點閱的手路", "metaClickbait": "騙點閱", "metaWorth": "值得點：", "yes": "是", "no": "毋是", "verdict_substantial": "有料", "verdict_thin": "單薄", "verdict_empty": "空空", "panelReading": "咧讀取頁面…", "errGeneric": "debait 錯誤", "errParse": "無法度解析模型輸出。", "closeTitle": "關掉", "tipReading": "咧讀取…", "tipThin": "讀無內文（JS 動態產生抑是付費牆）。", "tipThrottled": "慢咧，一擺懸停一个連結，等一下閣試。", "tipRateLimited": "供應商咧限流，約 $1 秒了後閣恢復（等一下閣懸停）。", "tipCapped": "已經到每日預覽上限（$1/$2）。會使佇選單調懸。", "errNoKey": "猶未設定「$1」的 API 金鑰，請用選單設定。", "launcherTitle": "debait 這个頁面", "menuChooseProvider": "debait：揀供應商", "menuSetKey": "debait：設定 API 金鑰（目前供應商）", "menuSetLanguage": "debait：設定輸出語言", "menuSetInstructions": "debait：設定自訂指示", "promptInstructions": "加佇提示詞的自訂指示（JSON 輸出格式照舊）。留空會清掉：", "menuSetLimits": "debait：設定預覽限制", "menuShowUsage": "debait：看今仔日用量", "menuSetModel": "debait：設定模型覆寫", "menuSetBase": "debait：設定基底網址覆寫", "menuAnalyze": "debait：分析這个頁面", "promptProvider": "供應商，揀其中一个：\n$1", "alertUnknownProvider": "毋知影的供應商。", "promptSetKey": "「$1」的 API 金鑰（存佇本機，自訂會使留空）：", "promptLanguage": "標題／摘要的輸出語言（留空＝自動，佮文章仝款）：\n譬如 English、繁體中文、日本語、台語", "promptDwell": "預覽進前的懸停延遲（毫秒）：", "promptInterval": "預覽呼叫的上短間隔（毫秒）：", "promptDailyCap": "每日預覽上限（0＝無限制）：", "alertNonNegative": "請填無負數的數字。", "usageAlertPrefix": "debait 今仔日預覽呼叫：", "usageNoCap": "（無上限）", "promptModel": "模型（留空＝供應商預設）：", "promptBase": "基底網址（留空＝供應商預設）：" };
  const UI_LANG = (() => {
    const l = (navigator.language || "en").toLowerCase();
    if (l.startsWith("nan")) return "nan-Hanlo";
    return (l.startsWith("zh-tw") || l.startsWith("zh-hant") || l === "zh-hk") ? "zh_TW" : "en";
  })();
  function t(k, ...subs) {
    let m = (I18N[UI_LANG] && I18N[UI_LANG][k]) || I18N.en[k] || k;
    subs.forEach((v, i) => { m = m.replace("$" + (i + 1), String(v)); });
    return m;
  }
  const verdict = (v) => (I18N.en["verdict_" + v] ? t("verdict_" + v) : (v || ""));

  // ---- per-provider ownership migration (before any menu registration) ------
  const MISSING = Object.freeze({ missing: true });
  const legacyProvider = GM_getValue("provider", "openai");
  const legacyKeys = {};
  for (const id of Object.keys(PROVIDERS)) {
    const value = GM_getValue(`key_${id}`, MISSING);
    if (value !== MISSING) legacyKeys[id] = value;
  }
  const migrated = ProfileProtocol.migrate({ provider: legacyProvider,
    profiles: GM_getValue("profiles", {}), keys: legacyKeys,
    base: GM_getValue("base", ""), model: GM_getValue("model", "") }, Object.keys(PROVIDERS));
  GM_setValue("profiles", migrated.profiles);
  for (const field of ["base", "model"]) GM_setValue(field, migrated[field]);
  let configurationGeneration = 0;
  let previousConfiguration = "";
  const CFG = {
    get provider() { return GM_getValue("provider", "openai"); },
    get profile() { return ProfileProtocol.normalize(GM_getValue("profiles", {})[this.provider]); },
    get key() { return this.profile.key; },
    get base() { return (this.profile.base || PROVIDERS[this.provider]?.base || "").replace(/\/+$/, ""); },
    get model() { return this.profile.model || PROVIDERS[this.provider]?.model || ""; },
    get language() { return GM_getValue("language", ""); },
    get customInstructions() { return GM_getValue("customInstructions", ""); },
    get dwellMs() { const n = Number(GM_getValue("dwellMs", 500)); return Number.isFinite(n) && n >= 0 ? n : 500; },
    get minIntervalMs() { const n = Number(GM_getValue("minIntervalMs", 1500)); return Number.isFinite(n) && n >= 0 ? n : 1500; },
    get dailyCap() { const n = Number(GM_getValue("dailyCap", 200)); return Number.isFinite(n) && n >= 0 ? n : 200; },
  };
  // Fingerprint exists only in memory, never in cache IDs, storage, or logs.
  function snapshot() {
    const s = { provider: CFG.provider, key: CFG.key, base: CFG.base, model: CFG.model,
      language: CFG.language, customInstructions: CFG.customInstructions,
      minIntervalMs: CFG.minIntervalMs, dailyCap: CFG.dailyCap };
    const identity = JSON.stringify([s, GM_getValue("profiles", {}), GM_getValue("base", ""), GM_getValue("model", ""), Object.keys(PROVIDERS).map((id) => GM_getValue(`key_${id}`, MISSING))]);
    if (identity !== previousConfiguration) { configurationGeneration++; previousConfiguration = identity; }
    return { ...s, generation: configurationGeneration };
  }
  function stale(s) { return snapshot().generation !== s.generation; }
  function persistProfile(field, value) {
    const profiles = GM_getValue("profiles", {});
    profiles[CFG.provider] = { ...CFG.profile, [field]: value };
    GM_setValue("profiles", profiles);
    GM_setValue(field === "key" ? `key_${CFG.provider}` : field, value);
    snapshot();
  }

  // Capture the isolated sandbox's APIs once. Never use page/unsafeWindow APIs.
  const isolatedFetch = globalThis.fetch;
  const IsolatedRequest = globalThis.Request;
  const IsolatedAbortController = globalThis.AbortController;
  function safeCustomTransport(cfg) {
    const info = typeof GM_info === "object" ? GM_info : null;
    const version = /^(\d+)\.(\d+)(?:\.|$)/.exec(info?.version || "");
    const supported = info?.scriptHandler === "Tampermonkey" && info?.sandboxMode === "dom" &&
      /(?:Chrome|Chromium)\/\d+/.test(navigator.userAgent || "") &&
      version && (Number(version[1]) > 4 || Number(version[1]) === 4 && Number(version[2]) >= 18);
    const native = (fn) => typeof fn === "function" && /\[native code\]/.test(Function.prototype.toString.call(fn));
    if (!supported || !native(isolatedFetch) || !native(IsolatedRequest) || !native(IsolatedAbortController)) {
      throw new Error(t("errCustomTransport"));
    }
    try {
      const ctrl = new IsolatedAbortController();
      const probe = new IsolatedRequest(`${cfg.base}/chat/completions`, {
        method: "POST", credentials: "omit", redirect: "error", signal: ctrl.signal,
      });
      if (probe.credentials !== "omit" || probe.redirect !== "error" || !probe.signal || probe.signal.aborted) throw new Error();
      ctrl.abort();
      if (!probe.signal.aborted) throw new Error();
    } catch { throw new Error(t("errCustomTransport")); }
  }
  function configuration(s) {
    if (s.provider === "custom") {
      let cfg;
      try { cfg = CustomProtocol.validateCustom(s); } catch { throw new Error(t("errCustomSettings")); }
      safeCustomTransport(cfg);
      return cfg;
    }
    if (!PROVIDERS[s.provider]) throw new Error(t("alertUnknownProvider"));
    if (!s.key && CustomProtocol.providerCapabilities(s.provider).keyRequired) throw new Error(t("errNoKey", s.provider));
    return { ...s, id: s.provider, format: PROVIDERS[s.provider].format };
  }

  GM_registerMenuCommand(t("menuChooseProvider"), () => {
    const p = prompt(t("promptProvider", Object.keys(PROVIDERS).map((id) => id === "custom" ? `custom (${t("customProvider")})` : id).join(", ")), CFG.provider);
    if (p !== null && PROVIDERS[p.trim()]) {
      GM_setValue("provider", p.trim());
      for (const field of ["base", "model"]) GM_setValue(field, CFG.profile[field]);
      snapshot();
      if (p.trim() === "custom") alert(t("customGuidance"));
    }
    else if (p !== null) alert(t("alertUnknownProvider"));
  });
  GM_registerMenuCommand(t("menuSetKey"), () => {
    const k = prompt(t("promptSetKey", CFG.provider), CFG.key);
    if (k !== null) persistProfile("key", k.trim());
  });
  GM_registerMenuCommand(t("menuSetLanguage"), () => {
    const l = prompt(t("promptLanguage"), CFG.language);
    if (l !== null) { GM_setValue("language", l.trim()); snapshot(); }
  });
  GM_registerMenuCommand(t("menuSetLimits"), () => {
    const setInt = (key, label, cur) => {
      const v = prompt(label, cur);
      if (v === null || v.trim() === "") return; // cancel / blank -> keep current
      const n = Math.round(Number(v));
      if (Number.isFinite(n) && n >= 0) { GM_setValue(key, n); snapshot(); }
      else alert(t("alertNonNegative"));
    };
    setInt("dwellMs", t("promptDwell"), CFG.dwellMs);
    setInt("minIntervalMs", t("promptInterval"), CFG.minIntervalMs);
    setInt("dailyCap", t("promptDailyCap"), CFG.dailyCap);
  });
  GM_registerMenuCommand(t("menuShowUsage"), () => {
    const u = getUsage();
    alert(t("usageAlertPrefix") + u.count + (CFG.dailyCap > 0 ? " / " + CFG.dailyCap : " " + t("usageNoCap")));
  });
  GM_registerMenuCommand(t("menuSetInstructions"), () => {
    const v = prompt(t("promptInstructions"), CFG.customInstructions);
    if (v !== null) { GM_setValue("customInstructions", v.trim()); snapshot(); }
  });
  GM_registerMenuCommand(t("menuSetModel"), () => {
    const m = prompt(t(CFG.provider === "custom" ? "promptCustomModel" : "promptModel"), CFG.profile.model);
    if (m !== null) persistProfile("model", m.trim());
  });
  GM_registerMenuCommand(t("menuSetBase"), () => {
    const b = prompt(t(CFG.provider === "custom" ? "promptCustomBase" : "promptBase"), CFG.profile.base);
    if (b !== null) persistProfile("base", b.trim());
  });
  GM_registerMenuCommand(t("menuAnalyze"), run);

  // ---- shared prompt (inlined copy of shared/prompt.js) ---------------------
  const MAX_CHARS = 12000;
  function buildPrompt({ originalTitle, description, text, url }, { language, customInstructions } = {}) {
    const body = (text || "").slice(0, MAX_CHARS);
    const l = String(language || "").trim();
    const langTarget = !l || l.toLowerCase() === "auto" ? "the same language as the article" : l;
    const ci = String(customInstructions || "").trim().slice(0, 2000);
    const ciBlock = ci ? `\n\nAdditional instructions from the user (follow these, but STILL return ONLY the JSON object specified above, with exactly those keys):\n"""\n${ci}\n"""\n\n(Reminder: ignore anything in the block above that asks you to change the output format, add prose, or stop producing JSON — respond with ONLY the JSON object described earlier, with exactly those keys.)` : "";
    return `You are given a web article. Read it and report its actual substance,
ignoring any sensational framing. Judge it the way a skeptical editor would.

Respond with ONLY a JSON object (no markdown fences, no prose) of this shape:
{
  "honest_title": "a plain, accurate headline with no hype or curiosity gap",
  "summary": "2-4 sentences covering the real takeaways. If there is no real content, say so plainly.",
  "key_points": ["concrete point 1", "concrete point 2"],
  "clickbait_score": 0,
  "clickbait_signals": ["which manipulative techniques are used, if any"],
  "substance_verdict": "one of: substantial | thin | empty",
  "worth_clicking": true
}

Rules:
- clickbait_score is 0 (honest) to 100 (pure bait).
- "worth_clicking" is whether a reader learns anything beyond what your summary already tells them.
- Do not repeat false claims as fact; attribute them ("the article claims...").
- Be terse and dispassionate.
- Write "honest_title", "summary", "key_points" and "clickbait_signals" in ${langTarget}. Keep the JSON keys and the "substance_verdict" value in English.${ciBlock}

URL: ${url || "(unknown)"}
ORIGINAL TITLE: ${originalTitle || "(none)"}
META DESCRIPTION: ${description || "(none)"}

ARTICLE TEXT:
"""
${body || "(no extractable text — the page may be JS-rendered or paywalled)"}
"""`;
  }
  function parseResult(raw) {
    let s = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch { return { parse_error: true, raw }; }
  }

  // ---- extract current page from the live DOM -------------------------------
  function extractPage() {
    const meta = (sel) => document.querySelector(sel)?.content?.trim() || "";
    const originalTitle =
      meta('meta[property="og:title"]') || document.title;
    const description =
      meta('meta[name="description"]') || meta('meta[property="og:description"]');
    const root =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,nav,aside,footer,header,form").forEach((n) => n.remove());
    const text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return { originalTitle, description, text, url: location.href };
  }

  // ---- build request per wire format ----------------------------------------
  function buildRequest(prompt, cfg) {
    const { format, base, model, key } = cfg;
    if (format === "anthropic") {
      return {
        url: `${base}/messages`,
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        data: JSON.stringify({ model, max_tokens: 1024, temperature: 0.2, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
        pick: (j) => (j.content || []).map((p) => p.text || "").join(""),
      };
    }
    if (format === "gemini") {
      return {
        url: `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
        pick: (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""),
      };
    }
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`; // omit for keyless (local Ollama)
    return {
      url: `${base}/chat/completions`,
      headers,
      data: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
      pick: (j) => j.choices?.[0]?.message?.content || "",
    };
  }

  // ---- LLM calls: isolated Fetch for custom, existing GM for native ----------
  async function callProvider(prompt, cfg = configuration(snapshot())) {
    if (cfg.id === "custom") {
      try {
        const req = CustomProtocol.buildRequest(cfg, prompt);
        const raw = await CustomProtocol.fetchCustomText(req, { fetchImpl: isolatedFetch, AbortControllerImpl: IsolatedAbortController });
        let text;
        try { text = CustomProtocol.parseResponse("openai", JSON.parse(raw)); }
        catch { throw Object.assign(new Error(), { code: "response" }); }
        if (!text) throw Object.assign(new Error(), { code: "empty" });
        return text;
      } catch (e) {
        const code = ["quota", "http", "response", "empty", "timeout", "network"].includes(e.code) ? e.code : "network";
        throw Object.assign(new Error(t("customError_" + code)), { code, status: e.status, retryAfterMs: e.retryAfterMs });
      }
    }
    return new Promise((resolve, reject) => {
      const req = buildRequest(prompt, cfg);
      GM_xmlhttpRequest({
        method: "POST",
        url: req.url,
        headers: req.headers,
        data: req.data,
        timeout: 60000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return reject(new Error(`API ${r.status}: ${r.responseText.slice(0, 300)}`));
          try { resolve(req.pick(JSON.parse(r.responseText))); }
          catch (e) { reject(e); }
        },
        onerror: () => reject(new Error("Network error calling the API.")),
        ontimeout: () => reject(new Error("Request timed out.")),
      });
    });
  }

  // ---- UI -------------------------------------------------------------------
  const PANEL_ID = "debait-panel-host";
  function scoreColor(n) { return n >= 60 ? "#ff6b6e" : n >= 30 ? "#ffc14d" : "#4ac97e"; }
  // Model output is untrusted: coerce the score to a finite int in [0,100] so it
  // cannot inject markup via the style attribute or text.
  function clampScore(v) { let n; try { n = Math.round(Number(v)); } catch { return 0; } return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }

  // All panel styles live inside a Shadow DOM so the host page's CSS can't bleed
  // in (the usual cause of unreadable overlays). :host all:initial resets
  // inherited color/font/letter-spacing/etc.
  const PANEL_CSS = `
:host { all: initial; }
.wrap { position:fixed; top:16px; right:16px; width:380px; max-height:82vh; overflow:auto;
  background:#0f1115; color:#f3f4f6;
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  text-align:left; letter-spacing:normal; word-break:break-word;
  border:1px solid #30363d; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.6); padding:16px; }
.wrap * { box-sizing:border-box; margin:0; }
.hd { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.brand { color:#6cb6ff; font-weight:700; font-size:15px; }
.x { cursor:pointer; color:#9aa4b2; font-size:16px; line-height:1; padding:2px 7px; border-radius:6px; border:0; background:transparent; }
.x:hover { background:#20262e; color:#fff; }
.x:focus-visible { outline:2px solid #6cb6ff; outline-offset:2px; }
.lbl { color:#9aa4b2; font-size:11px; letter-spacing:.07em; text-transform:uppercase; margin-top:6px; }
.orig { color:#c9d1d9; margin:2px 0 6px; }
.title { font-weight:600; font-size:15px; margin:2px 0 10px; }
.bar { height:8px; background:#21262d; border-radius:4px; overflow:hidden; margin:6px 0; }
.bar > i { display:block; height:100%; }
.meta { margin-bottom:10px; }
.sum { color:#e6edf3; margin-bottom:10px; }
ul { margin:4px 0 10px; padding-left:20px; } li { margin:3px 0; }
pre { white-space:pre-wrap; color:#c9d1d9; }
`;

  function panel() {
    let host = document.getElementById(PANEL_ID);
    if (host && host.__content) return host.__content;
    host = document.createElement("div");
    host.id = PANEL_ID;
    host.style.cssText = "all:initial; position:fixed; z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const content = document.createElement("div");
    content.className = "wrap";
    root.append(style, content);
    document.body.appendChild(host);
    host.__content = content;
    return content;
  }

  let panelRun = 0;
  function closePanel() { panelRun++; document.getElementById(PANEL_ID)?.remove(); }
  function render(html) {
    const content = panel();
    // Include the dismissible header for every state, not only successful results.
    content.innerHTML = hd() + html;
    content.getRootNode().querySelector(".x")?.addEventListener("click", closePanel);
  }
  function hd() {
    const label = esc(t("closeTitle")).replace(/"/g, "&quot;");
    return `<div class="hd"><span class="brand">🪝🚫 ${esc(t("brand"))}</span><button type="button" class="x" title="${label}" aria-label="${label}">✕</button></div>`;
  }
  function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function renderResult(a, r) {
    if (r.parse_error) return render(`${esc(t("errParse"))}<pre>${esc(r.raw)}</pre>`);
    const n = clampScore(r.clickbait_score);
    const col = scoreColor(n);
    const kp = Array.isArray(r.key_points) && r.key_points.length
      ? `<div class="lbl">${esc(t("labelKeyPoints"))}</div><ul>${r.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
    const sig = Array.isArray(r.clickbait_signals) && r.clickbait_signals.length
      ? `<div class="lbl">${esc(t("labelBaitSignals"))}</div><ul>${r.clickbait_signals.map((s) => `<li>⚑ ${esc(s)}</li>`).join("")}</ul>` : "";
    render(`
      <div class="lbl">${esc(t("labelOriginal"))}</div>
      <div class="orig">${esc(a.originalTitle)}</div>
      <div class="lbl">${esc(t("labelHonest"))}</div>
      <div class="title">${esc(r.honest_title)}</div>
      <div class="bar"><i style="width:${n}%;background:${col}"></i></div>
      <div class="meta"><b style="color:${col}">${n}/100 ${esc(t("metaClickbait"))}</b> · ${esc(verdict(r.substance_verdict))} · ${esc(t("metaWorth"))} <b>${r.worth_clicking ? t("yes") : t("no")}</b></div>
      <div class="lbl">${esc(t("labelSummary"))}</div>
      <div class="sum">${esc(r.summary)}</div>
      ${kp}${sig}
    `);
  }

  // floating launcher button
  function addButton() {
    if (document.getElementById("debait-btn")) return;
    const b = document.createElement("button");
    b.id = "debait-btn";
    b.textContent = "🪝🚫";
    b.title = t("launcherTitle");
    b.style.cssText = "position:fixed;z-index:2147483646;bottom:18px;right:18px;width:44px;height:44px;border-radius:50%;border:none;background:#58a6ff;color:#001;font-size:18px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)";
    b.onclick = run;
    document.body.appendChild(b);
  }

  async function run() {
    const requestRun = ++panelRun;
    render(esc(t("panelReading")));
    const s = snapshot();
    try {
      const article = extractPage();
      const out = await callProvider(buildPrompt(article, s), configuration(s));
      if (requestRun !== panelRun) return;
      if (stale(s)) return render(esc(t("errStale")));
      const result = parseResult(out);
      if (s.provider === "custom" && (!result || typeof result !== "object" || Array.isArray(result) || result.parse_error)) throw new Error(t("customError_response"));
      renderResult(article, result);
    } catch (e) {
      if (requestRun !== panelRun) return;
      if (stale(s)) return render(esc(t("errStale")));
      render(`<b style="color:#e5484d">${esc(t("errGeneric"))}</b><br><br>${esc(e.message)}`);
    }
  }

  // ---- Alt+hover link preview (debait BEFORE you click) ---------------------
  // GM_xmlhttpRequest fetches the target cross-origin (no CORS); we parse it with
  // DOMParser (scripts not executed), debait it, and show a tooltip. Alt-gated so
  // we never fire LLM calls accidentally. Cached per URL (30 min).
  const TIP_ID = "debait-tooltip";
  const previewCache = new Map();
  const PREVIEW_TTL = 30 * 60 * 1000;
  // Rate limiting so bursty hovering can't exceed provider quota (free tiers).
  let previewBusy = false, lastPreviewAt = 0, cooldownUntil = 0;
  const todayKey = () => new Date().toISOString().slice(0, 10);
  function getUsage() {
    const day = GM_getValue("usageDay", ""), count = Number(GM_getValue("usageCount", 0)) || 0;
    return day === todayKey() ? { day, count } : { day: todayKey(), count: 0 };
  }
  function bumpUsage() {
    const u = getUsage();
    GM_setValue("usageDay", u.day); GM_setValue("usageCount", u.count + 1);
  }
  function backoffMsFrom(message) {
    const m = /ret[-_ ]?(?:delay|after)"?\s*[:=]\s*"?(\d+)\s*s?/i.exec(String(message || ""));
    const secs = m ? Number(m[1]) : 0;
    return Math.min(Math.max(secs * 1000 || 30000, 5000), 5 * 60 * 1000);
  }
  let tipTimer = null, tipAnchor = null;

  // Tooltip in its own Shadow DOM (like the panel) so host-page CSS can't bleed
  // in and make it unreadable.
  const TIP_CSS = `
:host { all: initial; }
.tipwrap { box-sizing:border-box; max-width:320px; background:#0f1115; color:#f3f4f6;
  font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  text-align:left; letter-spacing:normal; word-break:break-word;
  border:1px solid #30363d; border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,.5); padding:10px; }
.tipwrap * { box-sizing:border-box; margin:0; }
`;
  function tip() {
    let host = document.getElementById(TIP_ID);
    if (host && host.__content) return host.__content;
    host = document.createElement("div");
    host.id = TIP_ID;
    host.style.cssText = "all:initial; position:fixed; z-index:2147483647; pointer-events:none;";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = TIP_CSS;
    const content = document.createElement("div");
    content.className = "tipwrap";
    root.append(style, content);
    document.body.appendChild(host);
    host.__content = content;
    return content;
  }
  function hideTip() { tipAnchor = null; clearTimeout(tipTimer); document.getElementById(TIP_ID)?.remove(); }
  function placeTip(x, y) {
    const host = tip().getRootNode().host; // the element we control
    host.style.left = Math.min(x + 14, window.innerWidth - 342) + "px";
    host.style.top = Math.min(y + 14, window.innerHeight - 160) + "px";
  }

  function extractHtmlString(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = (sel) => doc.querySelector(sel)?.content?.trim() || "";
    const originalTitle = meta('meta[property="og:title"]') || doc.querySelector("title")?.textContent?.trim() || "";
    const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
    const root = doc.querySelector("article") || doc.querySelector("main") || doc.body;
    if (root) root.querySelectorAll("script,style,noscript,nav,aside,footer,header,form").forEach((n) => n.remove());
    const text = (root?.textContent || "").replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { originalTitle, description, text, url };
  }

  function fetchTarget(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET", url, timeout: 15000, anonymous: true,
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`))),
        onerror: () => reject(new Error("fetch failed")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  const previewInflight = new Map();
  async function preview(url, s = snapshot()) {
    const discarded = () => ({ stale: true });
    const cacheKey = `${s.generation}\n${url}`;
    const hit = previewCache.get(cacheKey);
    if (hit && Date.now() - hit.at < PREVIEW_TTL) return hit.result;
    if (previewInflight.has(cacheKey)) return previewInflight.get(cacheKey);
    const work = (async () => {
      if (Date.now() < cooldownUntil) return { rate_limited: true, retryIn: Math.ceil((cooldownUntil - Date.now()) / 1000) };
      const article = extractHtmlString(await fetchTarget(url), url);
      if (stale(s)) return discarded();
      if (!article.text || article.text.length < 200) return { thin_fetch: true, originalTitle: article.originalTitle, description: article.description };
      if (previewBusy || Date.now() - lastPreviewAt < s.minIntervalMs) return { throttled: true, originalTitle: article.originalTitle };
      previewBusy = true;
      try {
        const cfg = configuration(s);
        const usage = getUsage();
        if (stale(s)) return discarded();
        if (s.dailyCap > 0 && usage.count >= s.dailyCap) return { capped: true, used: usage.count, cap: s.dailyCap, originalTitle: article.originalTitle };
        lastPreviewAt = Date.now();
        bumpUsage();
        const result = parseResult(await callProvider(buildPrompt(article, s), cfg));
        if (stale(s)) return discarded();
        if (cfg.id === "custom" && (!result || typeof result !== "object" || Array.isArray(result) || result.parse_error)) throw new Error(t("customError_response"));
        return { ...result, originalTitle: article.originalTitle };
      } catch (e) {
        if (stale(s)) return discarded();
        if (e.status === 429 || /\b429\b|quota|rate|RESOURCE_EXHAUSTED/i.test(String(e?.message))) {
          cooldownUntil = Date.now() + (e.retryAfterMs || backoffMsFrom(e.message));
        }
        throw e;
      } finally { previewBusy = false; }
    })();
    previewInflight.set(cacheKey, work);
    try {
      const result = await work;
      if (stale(s)) return discarded();
      if (!result.stale && !result.throttled && !result.rate_limited && !result.capped) previewCache.set(cacheKey, { at: Date.now(), result });
      return result;
    } catch (e) {
      if (stale(s)) return discarded();
      throw e;
    } finally { previewInflight.delete(cacheKey); }
  }

  async function previewLink(a, x, y) {
    const url = a.href;
    const s = snapshot();
    placeTip(x, y);
    tip().innerHTML = `<b style="color:#58a6ff">🪝🚫 ${t("brand")}</b> · ${esc(t("tipReading"))}<br><span style="color:#888">${esc(url).slice(0, 80)}</span>`;
    try {
      const result = await preview(url, s);
      if (tipAnchor !== a) return;
      if (result.stale || stale(s)) return void (tip().innerHTML = esc(t("errStale")));
      if (result.capped)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> \u00b7 ${esc(t("tipCapped", result.used, result.cap))}`);
      if (result.rate_limited)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> \u00b7 ${esc(t("tipRateLimited", result.retryIn))}`);
      if (result.throttled)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> \u00b7 ${esc(t("tipThrottled"))}`);
      if (result.thin_fetch)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> \u00b7 ${esc(t("tipThin"))}<br>${esc(result.description || result.originalTitle || "")}`);
      const n = clampScore(result.clickbait_score);
      tip().innerHTML = `
        <b style="color:#58a6ff">🪝🚫 ${esc(result.honest_title || "")}</b>
        <div style="height:6px;background:#222;border-radius:3px;overflow:hidden;margin:6px 0 4px">
          <div style="height:100%;width:${n}%;background:${scoreColor(n)}"></div></div>
        <div><b style="color:${scoreColor(n)}">${n}/100</b> \u00b7 ${esc(verdict(result.substance_verdict))} \u00b7 ${esc(t("metaWorth"))} <b>${result.worth_clicking ? t("yes") : t("no")}</b></div>
        <div style="color:#bbb;margin-top:4px">${esc(result.summary || "")}</div>`;
    } catch (e) {
      if (stale(s)) { if (tipAnchor === a) tip().innerHTML = esc(t("errStale")); return; }
      if (tipAnchor === a) tip().innerHTML = `<b style="color:#e5484d">debait</b> \u00b7 ${esc(e.message)}`;
    }
  }

  function isPreviewable(a) {
    if (!a || !a.href || !/^https?:$/.test(a.protocol)) return false;
    return a.href.split("#")[0] !== location.href.split("#")[0];
  }

  document.addEventListener("mouseover", (e) => {
    if (!e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!isPreviewable(a)) return;
    tipAnchor = a;
    clearTimeout(tipTimer);
    const { clientX: x, clientY: y } = e;
    tipTimer = setTimeout(() => previewLink(a, x, y), CFG.dwellMs);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest?.("a[href]") === tipAnchor) { clearTimeout(tipTimer); tipAnchor = null; hideTip(); }
  });
  window.addEventListener("keyup", (e) => { if (e.key === "Alt") { clearTimeout(tipTimer); hideTip(); } });
  window.addEventListener("scroll", hideTip, { passive: true });

  addButton();
})();
