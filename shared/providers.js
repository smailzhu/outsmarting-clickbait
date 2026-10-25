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

export const SYSTEM =
  "You are a precise editor. Respond with exactly the requested format, nothing else.";

// Capability overrides are centralized here; native providers require keys,
// support discovery and participate in auto-selection unless overridden.
export const PROVIDERS = {
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

export function providerCapabilities(id) {
  const def = PROVIDERS[id];
  return { keyRequired: def?.keyRequired !== false, discovery: def?.discovery !== false,
    autoSelect: def?.autoSelect !== false };
}

export const CUSTOM_DISCOVERY_ERROR = "Custom / OpenAI-compatible supports Chat Completions only; model discovery is unsupported. Set an explicit base URL and model.";

class CustomProviderError extends Error {}

export function customError(code, status, retryAfterMs) {
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

export function validateCustom({ base, model, key = "" } = {}) {
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

export function validateConfiguration(cfg) {
  const validated = cfg.id === "custom" ? validateCustom(cfg) : cfg;
  if (providerCapabilities(validated.id).keyRequired && !validated.key) {
    throw new Error(`No API key for provider "${validated.id}".`);
  }
  return validated;
}

export function resolveProvider({ provider, base, model, key } = {}) {
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
export function buildRequest(cfg, prompt, { browser = false, maxOutputTokens } = {}) {
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

export function parseResponse(format, data) {
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
export function buildModelsRequest(cfg, { browser = false } = {}) {
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

export function parseModels(format, data) {
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

export async function listModels(cfg, { browser = false, maxPages = 20 } = {}) {
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
export async function fetchCustomText(req, { fetchImpl = globalThis.fetch, timeoutMs = 60000, AbortControllerImpl = globalThis.AbortController } = {}) {
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

export async function callProvider(cfg, prompt, { browser = false, timeoutMs = 60000 } = {}) {
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
