// Explicit settings-page connection test. Uses the same provider wire formats
// as analysis, but sends no article, custom instructions, or saved settings.
import { buildRequest, parseResponse, resolveProvider } from "./providers.js";

export function isOptionsSender(sender, runtime) {
  return sender?.id === runtime.id &&
    typeof sender.url === "string" &&
    sender.url.split(/[?#]/, 1)[0] === runtime.getURL("options.html");
}

export async function testConnection(values, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  let cfg;
  try {
    if (!values || typeof values !== "object") throw new Error("Invalid settings");
    for (const field of ["provider", "base", "model", "key"]) {
      if (values[field] !== undefined && typeof values[field] !== "string") throw new Error("Invalid field");
    }
    cfg = resolveProvider({
      provider: values.provider?.trim(), base: values.base?.trim(),
      model: values.model?.trim(), key: values.key?.trim(),
    });
    const base = new URL(cfg.base);
    if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error("Invalid base URL");
    }
  } catch {
    return { ok: false, code: "settings" };
  }
  if (!cfg.key && cfg.id !== "ollama") return { ok: false, code: "missing_key" };

  // Thinking tokens can consume the entire generation budget before any text
  // appears. Use controls only for recognized model families; keep aliases and
  // other models on their own defaults rather than guessing a thinking API.
  let maxOutputTokens = cfg.format === "gemini" ? 2048 : 128;
  let thinkingConfig;
  const model = cfg.model.replace(/^models\//, "");
  if (cfg.format === "gemini") {
    if (["gemini-2.5-flash", "gemini-2.5-flash-lite"].includes(model)) {
      thinkingConfig = { thinkingBudget: 0 };
      maxOutputTokens = 128;
    } else if (model === "gemini-2.5-pro") {
      thinkingConfig = { thinkingBudget: 128 };
      maxOutputTokens = 1024;
    } else if (model === "gemini-3-flash-preview") {
      thinkingConfig = { thinkingLevel: "minimal" };
    } else if (["gemini-3-pro-preview", "gemini-3.1-pro-preview"].includes(model)) {
      thinkingConfig = { thinkingLevel: "low" };
    }
  }
  const req = buildRequest(cfg, "Connection test: reply with the single word OK.", {
    browser: true, maxOutputTokens,
  });
  if (thinkingConfig) {
    const body = JSON.parse(req.body);
    body.generationConfig.thinkingConfig = thinkingConfig;
    req.body = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // One request, no retries or model-list calls. Deadline covers body reads.
    const res = await fetchImpl(req.url, {
      method: req.method, headers: req.headers, body: req.body,
      signal: ctrl.signal, credentials: "omit", redirect: "error",
    });
    if (!res.ok) {
      const code = res.status === 401 ? "auth" : res.status === 403 ? "access" :
        res.status === 429 ? "quota" : res.status === 404 ? "model" : "http";
      // Never echo provider responses: they might contain credentials or URLs.
      return { ok: false, code, status: res.status };
    }
    const raw = await res.text(); // network failures belong to the outer catch
    let data, text;
    try {
      data = JSON.parse(raw);
      text = parseResponse(cfg.format, data);
    } catch {
      return { ok: false, code: "response" };
    }
    if (text) return { ok: true, code: "success" };
    const finish = cfg.format === "gemini" ? data?.candidates?.[0]?.finishReason :
      cfg.format === "anthropic" ? data?.stop_reason : data?.choices?.[0]?.finish_reason;
    if (["MAX_TOKENS", "max_tokens", "length"].includes(finish)) return { ok: false, code: "budget" };
    return { ok: false, code: "empty" };
  } catch {
    return { ok: false, code: ctrl.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
