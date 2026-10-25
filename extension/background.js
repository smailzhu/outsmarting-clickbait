// Service worker: settings, CORS-free multi-provider LLM calls, context menu,
// and link PREVIEW (debait a page before you open it).
//
// providers.js / prompt.esm.js / extract.js are synced from ../shared via
// `npm run sync`.

import { resolveProvider, callProvider, PROVIDERS, validateConfiguration, providerCapabilities, customError } from "./providers.js";
import { buildPrompt, parseResult } from "./prompt.esm.js";
import { extractArticle } from "./extract.js";
import { isOptionsSender, testConnection } from "./connection-test.js";
import "./profiles.js";
import "./messages.gen.js";
import "./i18n-runtime.js";

const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", keys: {}, profiles: {}, language: "",
  // Preview rate controls (see Options). 0 = unlimited.
  previewMinIntervalMs: 1500,
  dailyCap: 200,
  customInstructions: "",
};

let configurationGeneration = 0;
let settingsMigration;
function migrateSettings() {
  if (!settingsMigration) settingsMigration = (async () => {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    const s = globalThis.DebaitProfiles.migrate({ ...DEFAULTS, ...stored }, Object.keys(PROVIDERS));
    if (JSON.stringify(stored.profiles) !== JSON.stringify(s.profiles) ||
        ["key", "base", "model"].some((field) => stored[field] !== s[field])) {
      await chrome.storage.sync.set({ profiles: s.profiles, key: s.key, base: s.base, model: s.model });
    }
  })();
  return settingsMigration;
}
async function settings() {
  await migrateSettings();
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return globalThis.DebaitProfiles.migrate({ ...DEFAULTS, ...stored }, Object.keys(PROVIDERS));
}

function configuration(s) {
  try {
    if (!PROVIDERS[s.provider]) throw new Error(globalThis.DebaitI18n.t("errUnknownProvider", [s.provider]));
    if (providerCapabilities(s.provider).keyRequired && !s.key) throw new Error(globalThis.DebaitI18n.t("errNoKey", [s.provider]));
    return validateConfiguration(resolveProvider({ provider: s.provider, base: s.base, model: s.model, key: s.key }));
  } catch (e) {
    if (s.provider === "custom") throw new Error(globalThis.DebaitI18n.t("errCustomSettings"));
    throw e;
  }
}

function providerFailure(error, s) {
  if (s.provider !== "custom") return error;
  return Object.assign(new Error(globalThis.DebaitI18n.t("customError_" +
    (["http", "quota", "response", "empty", "timeout", "network"].includes(error.code) ? error.code : "network"))),
    { code: error.code, status: error.status, retryAfterMs: error.retryAfterMs });
}

async function complete(prompt) {
  await globalThis.DebaitI18n.init();
  await migrateSettings();
  const generation = configurationGeneration;
  const s = await settings();
  if (generation !== configurationGeneration) throw new Error(globalThis.DebaitI18n.t("errStale"));
  const cfg = configuration(s);
  let result;
  try { result = await callProvider(cfg, prompt, { browser: true }); }
  catch (e) {
    if (generation !== configurationGeneration) throw new Error(globalThis.DebaitI18n.t("errStale"));
    throw providerFailure(e, s);
  }
  if (generation !== configurationGeneration) throw new Error(globalThis.DebaitI18n.t("errStale"));
  const parsed = s.provider === "custom" ? parseResult(result) : null;
  if (s.provider === "custom" && (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.parse_error)) {
    throw providerFailure(customError("response"), s);
  }
  return result;
}

// ---- preview: fetch a target URL, extract, debait, cache ------------------
const CACHE = new Map(); // url -> { at, result }
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const inflight = new Map(); // url -> Promise

// Rate limiting so bursty hovering can't exceed provider quota (esp. free
// tiers): one LLM preview at a time, a min spacing between them, a per-day cap,
// and a cooldown after a 429 (respecting the provider's retry delay).
let previewBusy = false;
let lastPreviewAt = 0;
let cooldownUntil = 0;

function backoffMsFrom(message) {
  const m = /ret[-_ ]?(?:delay|after)"?\s*[:=]\s*"?(\d+)\s*s?/i.exec(String(message || ""));
  const secs = m ? Number(m[1]) : 0;
  return Math.min(Math.max(secs * 1000 || 30000, 5000), 5 * 60 * 1000); // 5s..5min
}

const todayKey = () => new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

// Per-day preview attempt/reservation counter, persisted in storage.local (survives SW restarts).
async function getUsage() {
  const { debaitUsage } = await chrome.storage.local.get({ debaitUsage: { day: "", count: 0 } });
  if (debaitUsage.day !== todayKey()) return { day: todayKey(), count: 0 };
  return debaitUsage;
}
async function fetchAndExtract(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ct) && ct) throw new Error(`not HTML (${ct.split(";")[0]})`);
    return extractArticle(await res.text(), url);
  } finally {
    clearTimeout(t);
  }
}

async function preview(url) {
  await globalThis.DebaitI18n.init();
  await migrateSettings();
  const generation = configurationGeneration;
  const stale = () => generation !== configurationGeneration;
  const discarded = () => ({ stale: true, url });
  const s = await settings();
  if (stale()) return discarded();
  // Non-secret, memory-only generation isolates key/profile changes too.
  const cacheKey = `${generation}\n${url}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.result;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  if (Date.now() < cooldownUntil) {
    return { rate_limited: true, retryIn: Math.ceil((cooldownUntil - Date.now()) / 1000), url };
  }
  const p = (async () => {
    const article = await fetchAndExtract(url);
    if (stale()) return discarded();
    if (!article.text || article.text.length < 200) {
      return { thin_fetch: true, originalTitle: article.originalTitle, description: article.description, url };
    }
    if (previewBusy || Date.now() - lastPreviewAt < (s.previewMinIntervalMs || 0)) {
      return { throttled: true, originalTitle: article.originalTitle, url };
    }
    previewBusy = true;
    try {
      const cfg = configuration(s); // no count for invalid/missing settings
      const usage = await getUsage(); // cap rechecked under single-call protection
      if (stale()) return discarded();
      if (Date.now() < cooldownUntil) return { rate_limited: true, retryIn: Math.ceil((cooldownUntil - Date.now()) / 1000), url };
      if (s.dailyCap > 0 && usage.count >= s.dailyCap) {
        return { capped: true, used: usage.count, cap: s.dailyCap, originalTitle: article.originalTitle, url };
      }
      const prompt = buildPrompt(article, { language: s.language, customInstructions: s.customInstructions });
      lastPreviewAt = Date.now();
      // Durable reservation before sending. Fail closed on storage failure;
      // cancellation after reservation conservatively consumes one unit.
      await chrome.storage.local.set({ debaitUsage: { day: usage.day, count: usage.count + 1 } });
      if (stale()) return discarded();
      const text = await callProvider(cfg, prompt, { browser: true });
      if (stale()) return discarded();
      const result = parseResult(text);
      if (cfg.id === "custom" && (!result || typeof result !== "object" || Array.isArray(result) || result.parse_error)) throw customError("response");
      return { ...result, originalTitle: article.originalTitle, url };
    } catch (e) {
      if (stale()) return discarded();
      if (e.status === 429 || /\b429\b|quota|rate|RESOURCE_EXHAUSTED/i.test(String(e?.message))) {
        cooldownUntil = Date.now() + (e.retryAfterMs || backoffMsFrom(e.message));
      }
      if (s.provider === "custom" && e.message === globalThis.DebaitI18n.t("errCustomSettings")) throw e;
      throw providerFailure(e, s);
    } finally { previewBusy = false; }
  })();
  inflight.set(cacheKey, p);
  try {
    const result = await p;
    if (stale()) return discarded();
    if (!result.stale && !result.throttled && !result.rate_limited && !result.capped) CACHE.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (e) {
    if (stale()) return discarded();
    throw e;
  } finally { inflight.delete(cacheKey); }
}

let connectionTestBusy = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "debait:testConnection") {
    // Never accept credentials/test requests from content scripts or web pages.
    if (!isOptionsSender(sender, chrome.runtime)) {
      sendResponse({ ok: false, code: "denied" });
      return;
    }
    if (connectionTestBusy) {
      sendResponse({ ok: false, code: "busy" });
      return;
    }
    connectionTestBusy = true;
    testConnection(msg.settings)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, code: "network" }))
      .finally(() => { connectionTestBusy = false; });
    return true;
  }
  if (msg?.type === "debait:complete") {
    complete(msg.prompt).then((text) => sendResponse({ ok: true, text })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === "debait:preview") {
    preview(msg.url).then((result) => sendResponse({ ok: true, result })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await globalThis.DebaitI18n.init();
  chrome.contextMenus.create({ id: "debait-run", title: globalThis.DebaitI18n.t("ctxDebaitPage"), contexts: ["page", "selection"] });
  chrome.contextMenus.create({
    id: "debait-link", title: globalThis.DebaitI18n.t("ctxDebaitLink"), contexts: ["link"],
    targetUrlPatterns: ["https://*/*", "http://*/*"],
  });
  // First install only: open Options for provider configuration. Not on updates.
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage?.();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  let message;
  if (info.menuItemId === "debait-run") {
    message = { type: "debait:run" };
  } else if (info.menuItemId === "debait-link") {
    try {
      const url = new URL(info.linkUrl);
      if (!["https:", "http:"].includes(url.protocol)) return;
      message = { type: "debait:runLink", url: url.href };
    } catch { return; }
  } else { return; }
  // Display one panel in the top frame, even when the link is inside an iframe.
  // Restricted tabs may have no content script; never navigate as a fallback.
  chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {});
});

// Keep the context-menu label in sync with the chosen interface language.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "sync" && ["provider", "profiles", "keys", "key", "base", "model", "language", "customInstructions"].some((field) => changes[field])) {
    configurationGeneration++;
    CACHE.clear();
  }
  if (area === "sync" && changes.uiLang) {
    await globalThis.DebaitI18n.init();
    for (const [id, key] of [["debait-run", "ctxDebaitPage"], ["debait-link", "ctxDebaitLink"]]) {
      try { await chrome.contextMenus.update(id, { title: globalThis.DebaitI18n.t(key) }); } catch {}
    }
  }
});
