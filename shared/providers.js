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

// provider id -> { format, base, model, keyEnv }
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
  ollama:     { format: "openai",    base: "http://localhost:11434/v1",              model: "llama3.1",                keyEnv: "OLLAMA_API_KEY" },
};

export function resolveProvider({ provider, base, model, key } = {}) {
  const id = (provider || "openai").toLowerCase();
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
export function buildRequest(cfg, prompt, { browser = false } = {}) {
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
        max_tokens: 1024,
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
        generationConfig: { temperature: 0.2 },
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

export async function callProvider(cfg, prompt, { browser = false, timeoutMs = 60000 } = {}) {
  if (!cfg.key && cfg.id !== "ollama") throw new Error(`No API key for provider "${cfg.id}".`);
  const req = buildRequest(cfg, prompt, { browser });
  const res = await fetchTextWithTimeout(req.url, { method: req.method, headers: req.headers, body: req.body }, timeoutMs);
  if (!res.ok) throw new Error(`API ${res.status}: ${res.text.slice(0, 300)}`);
  const data = parseJson(res.text);
  const text = parseResponse(cfg.format, data);
  if (!text) throw new Error("Empty response from provider.");
  return text;
}
