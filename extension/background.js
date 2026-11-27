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
import "./hover-activation.js";
import "./hover-provenance.js";
import "./messages.gen.js";
import "./i18n-runtime.js";

const DEFAULTS = {
  provider: "openai", base: "", model: "", key: "", keys: {}, profiles: {}, language: "",
  // Preview rate controls (see Options). 0 = unlimited.
  previewMinIntervalMs: 1500,
  dailyCap: 200,
  customInstructions: "",
};

// Caught startup attempt establishes provenance even without opening Options.
const hoverInitialization = globalThis.DebaitHoverProvenance.ensureInitialized().catch(() => null);

let configurationGeneration = 0;
let settingsMigration;
function migrateSettings() {
  if (!settingsMigration) settingsMigration = (async () => {
    const token = await hoverInitialization;
    if (!globalThis.DebaitHoverProvenance.isApplicable(token)) return;
    const stored = await chrome.storage.sync.get(DEFAULTS);
    const s = globalThis.DebaitProfiles.migrate({ ...DEFAULTS, ...stored }, Object.keys(PROVIDERS));
    if (JSON.stringify(stored.profiles) !== JSON.stringify(s.profiles) ||
        ["key", "base", "model"].some((field) => stored[field] !== s[field])) {
      if (!globalThis.DebaitHoverProvenance.isApplicable(token)) return;
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
const CACHE = new Map(); // generation + URL -> { at, result }
const CACHE_TTL = 30 * 60 * 1000; // 30 min
const inflight = new Map(); // generation + URL -> owner-aware job

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
async function fetchAndExtract(url, { signal, checkpoint }) {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, credentials: "omit" });
    let stopped = checkpoint();
    if (stopped) return stopped;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(ct) && ct) throw new Error(`not HTML (${ct.split(";")[0]})`);
    const body = await res.text();
    stopped = checkpoint();
    return stopped || extractArticle(body, url);
  } catch (e) {
    const stopped = checkpoint();
    if (stopped) return stopped;
    throw e;
  } finally {
    // Also close unread bodies on stale checkpoints or HTTP/type errors.
    // Aborting after a fully read response is harmless.
    ctrl.abort();
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

function checkpoint(job) {
  if (job.canceled || (!job.dispatched && job.subscribers.size === 0)) return { canceled: true };
  if (job.generation !== configurationGeneration) return { stale: true, url: job.url };
  return null;
}
function releaseBusy(job) {
  if (job.ownsBusy) { job.ownsBusy = false; previewBusy = false; }
}
function withdraw(owner) {
  owner.active = false;
  const job = owner.job;
  owner.job = null;
  if (!job) return;
  job.subscribers.delete(owner.subscriber);
  if (job.subscribers.size || job.dispatched) return;
  job.canceled = true;
  job.abort.abort();
  if (inflight.get(job.key) === job) inflight.delete(job.key);
  // An unabortable usage read cannot write after its checkpoint. A pending
  // durable reservation must retain serialization until the write settles.
  if (!job.reservationPending) releaseBusy(job);
}

async function preparePreview(job) {
  const { url } = job;
  const check = () => checkpoint(job);
  let stopped = check();
  if (stopped) return stopped;
  const stored = await chrome.storage.sync.get(DEFAULTS);
  stopped = check();
  if (stopped) return stopped;
  const s = globalThis.DebaitProfiles.migrate({ ...DEFAULTS, ...stored }, Object.keys(PROVIDERS));
  const hit = CACHE.get(job.key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.result;
  let setupRequired = false;
  try { configuration(s); } catch { setupRequired = true; }
  stopped = check();
  if (stopped) return stopped;
  if (setupRequired) return { setup_required: true };
  if (Date.now() < cooldownUntil) return { rate_limited: true, retryIn: Math.ceil((cooldownUntil - Date.now()) / 1000), url };
  stopped = check();
  if (stopped) return stopped;
  const article = await fetchAndExtract(url, { signal: job.abort.signal, checkpoint: check });
  stopped = check();
  if (stopped) return stopped;
  if (article.canceled || article.stale) return article;
  if (!article.text || article.text.length < 200) {
    return { thin_fetch: true, originalTitle: article.originalTitle, description: article.description, url };
  }
  if (previewBusy || Date.now() - lastPreviewAt < (s.previewMinIntervalMs || 0)) {
    return { throttled: true, originalTitle: article.originalTitle, url };
  }
  previewBusy = true;
  job.ownsBusy = true;
  try {
    const cfg = configuration(s);
    const usage = await getUsage();
    stopped = check();
    if (stopped) return stopped;
    if (Date.now() < cooldownUntil) return { rate_limited: true, retryIn: Math.ceil((cooldownUntil - Date.now()) / 1000), url };
    if (s.dailyCap > 0 && usage.count >= s.dailyCap) {
      return { capped: true, used: usage.count, cap: s.dailyCap, originalTitle: article.originalTitle, url };
    }
    const prompt = buildPrompt(article, { language: s.language, customInstructions: s.customInstructions });
    stopped = check();
    if (stopped) return stopped;
    lastPreviewAt = Date.now();
    job.reservationPending = true;
    // A committed reservation cannot be undone reliably, even if interest
    // disappears during this await. No rollback or post-dispatch refund.
    await chrome.storage.local.set({ debaitUsage: { day: usage.day, count: usage.count + 1 } });
    job.reservationPending = false;
    stopped = check();
    if (stopped) return stopped;
    job.dispatched = true;
    let text;
    try { text = await callProvider(cfg, prompt, { browser: true }); }
    catch (e) {
      stopped = check();
      if (stopped) return stopped;
      if (e.status === 429 || /\b429\b|quota|rate|RESOURCE_EXHAUSTED/i.test(String(e?.message))) {
        cooldownUntil = Date.now() + (e.retryAfterMs || backoffMsFrom(e.message));
      }
      throw providerFailure(e, s);
    }
    stopped = check();
    if (stopped) return stopped;
    const result = parseResult(text);
    if (cfg.id === "custom" && (!result || typeof result !== "object" || Array.isArray(result) || result.parse_error)) throw customError("response");
    return { ...result, originalTitle: article.originalTitle, url };
  } catch (e) {
    stopped = check();
    if (stopped) return stopped;
    if (s.provider === "custom" && e.message !== globalThis.DebaitI18n.t("errCustomSettings")) throw providerFailure(e, s);
    throw e;
  } finally {
    job.reservationPending = false;
    releaseBusy(job);
  }
}

async function previewOwned(url, owner) {
  try {
    await globalThis.DebaitI18n.init();
    if (!owner.active) return { canceled: true };
    await migrateSettings();
    if (!owner.active) return { canceled: true };
    // Migration can publish configuration changes. Capture only afterward.
    const generation = configurationGeneration;
    const key = `${generation}\n${url}`;
    let job = inflight.get(key);
    if (!job) {
      job = { key, url, generation, subscribers: new Set(), abort: new AbortController(),
        dispatched: false, canceled: false, promise: null, ownsBusy: false, reservationPending: false };
      inflight.set(key, job);
      // Install and attach before preparation can reach its first await.
      job.promise = Promise.resolve().then(() => preparePreview(job)).then((result) => {
        const stopped = checkpoint(job);
        if (stopped) return stopped;
        if (!result.canceled && !result.stale && !result.throttled && !result.rate_limited && !result.capped && !result.setup_required && CACHE.get(key)?.result !== result) {
          CACHE.set(key, { at: Date.now(), result });
        }
        return result;
      }).catch((e) => {
        const stopped = checkpoint(job);
        if (stopped) return stopped;
        throw e;
      }).finally(() => {
        if (inflight.get(key) === job) inflight.delete(key);
        releaseBusy(job);
      });
    }
    owner.job = job;
    job.subscribers.add(owner.subscriber);
    const result = await job.promise;
    return owner.active ? result : { canceled: true };
  } catch (e) {
    if (!owner.active) return { canceled: true };
    throw e;
  } finally {
    owner.job?.subscribers.delete(owner.subscriber);
    owner.job = null;
  }
}
function preview(url) {
  // A manual token stays interested until this call settles; hover withdrawal
  // can never cancel a manual request, in either arrival order.
  return previewOwned(url, { subscriber: {}, active: true, job: null });
}

function httpURL(value) {
  if (typeof value !== "string") return null;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
chrome.runtime.onConnect.addListener((port) => {
  const owner = { subscriber: port, active: true, job: null };
  let used = false, replied = false;
  const detach = () => {
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
  };
  const onDisconnect = () => { withdraw(owner); detach(); };
  const close = () => { onDisconnect(); try { port.disconnect(); } catch {} };
  const reply = (message) => {
    if (replied || !owner.active) return;
    replied = true;
    try { port.postMessage(message); } catch {}
  };
  const reject = () => { reply({ ok: false, error: globalThis.DebaitI18n.t("errGeneric") }); close(); };
  const onMessage = (message) => {
    if (used) return reject();
    used = true;
    if (!message || typeof message !== "object" || Array.isArray(message) ||
        Object.keys(message).length !== 2 || Object.keys(message).some((key) => !["type", "url"].includes(key)) || message.type !== "start" || !httpURL(message.url)) return reject();
    previewOwned(httpURL(message.url), owner).then((result) => {
      if (!result.canceled) reply({ ok: true, result });
    }).catch(() => reply({ ok: false, error: globalThis.DebaitI18n.t("errGeneric") })).finally(close);
  };
  // Attach before validation/initialization: pending cold owners are cancelable.
  port.onDisconnect.addListener(onDisconnect);
  port.onMessage.addListener(onMessage);
  const sender = port.sender;
  if (port.name !== "debait:hover" || sender?.id !== chrome.runtime.id ||
      !Number.isInteger(sender?.tab?.id) || sender.frameId !== 0 || !httpURL(sender.url)) reject();
});

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
