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
  xai:        { format: "openai",    base: "https://api.x.ai/v1",                    model: "grok-2-latest",           keyEnv: "XAI_API_KEY" },
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
  return {
    url: `${base}/chat/completions`,
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
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
export async function callProvider(cfg, prompt, { browser = false } = {}) {
  if (!cfg.key) throw new Error(`No API key for provider "${cfg.id}".`);
  const req = buildRequest(cfg, prompt, { browser });
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = parseResponse(cfg.format, data);
  if (!text) throw new Error("Empty response from provider.");
  return text;
}
