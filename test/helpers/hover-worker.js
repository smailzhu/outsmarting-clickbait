import { createHoverStorage } from "./hover-storage.js";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { resolveProvider, PROVIDERS, validateConfiguration, providerCapabilities, customError } from "../../shared/providers.js";
import { buildPrompt, parseResult } from "../../shared/prompt.js";
import { extractArticle } from "../../shared/extract.js";
import "../../shared/profiles.js";
export { deferred } from "./options-page.js";
export const flush = () => new Promise((resolve) => setImmediate(resolve));
export function listeners() {
  const all = new Set();
  return { all, addListener(fn) { all.add(fn); }, removeListener(fn) { all.delete(fn); },
    emit(...args) { for (const fn of [...all]) fn(...args); } };
}
export const html = `<article>${"A factual local article. ".repeat(20)}</article>`;
export function createWorker({ initial = {}, init, syncGet, migrationSet, headers, body, usageGet, reservation, provider,
  clock = 100000, timeout = false, fetchImpl, sharedStorage, local: initialLocal = {}, locks = true, provenanceGet, provenanceSet } = {}) {
  const initialStore = { provider: "custom", profiles: { custom: { key: "", base: "http://localhost:8000/v1", model: "fixture" } },
    previewMinIntervalMs: 0, dailyCap: 0, ...structuredClone(initial) };
  const backend = sharedStorage || createHoverStorage({ sync: initialStore, local: initialLocal, locks,
    beforeGet: (area, keys) => Array.isArray(keys) ? provenanceGet?.(area, keys) : area === "sync" ? syncGet?.(++reads) : usageGet?.(),
    beforeSet: (area, data) => area === "sync" ? migrationSet?.() : Object.hasOwn(data, "hoverActivationProvenanceV1") ? provenanceSet?.(data) : reservation?.(data) });
  const store = backend.sync, local = backend.local, fetchCalls = [], providerCalls = [], writes = [], timers = [], ports = [];
  let reads = 0, now = clock;
  const onConnect = listeners(), onMessage = listeners();
  const runtime = { id: "fixture-extension", onConnect, onMessage, onInstalled: listeners() };
  const context = vm.createContext({ URL, AbortController, resolveProvider, PROVIDERS, validateConfiguration, providerCapabilities, customError,
    buildPrompt, parseResult, extractArticle, DebaitProfiles: globalThis.DebaitProfiles,
    navigator: backend.navigator,
    Date: class extends Date { static now() { return now; } },
    DebaitI18n: { init: async () => { await init?.(); }, t: (key) => key },
    setTimeout(fn, ms) { const timer = { fn, ms, canceled: false }; timers.push(timer); if (timeout) queueMicrotask(fn); return timer; },
    clearTimeout(timer) { timer.canceled = true; },
    callProvider: async (...args) => { providerCalls.push(args); return provider ? provider(...args) : '{"honest_title":"Fixture","clickbait_score":12}'; },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      await headers?.(options.signal);
      return { ok: true, status: 200, headers: { get: () => "text/html" }, text: async () => { await body?.(options.signal); return html; } };
    },
    chrome: { runtime, storage: {
      ...backend.storage,
      local: { ...backend.storage.local,
        set: async (data) => { if (!Object.hasOwn(data, "hoverActivationProvenanceV1")) writes.push(structuredClone(data)); return backend.storage.local.set(data); } },
    }, contextMenus: { onClicked: listeners() } },
  });
  for (const file of ["hover-activation.js", "hover-provenance.js"]) vm.runInContext(readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8"), context);
  const source = readFileSync(new URL("../../extension/background.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  vm.runInContext(source + '\nglobalThis.inspect = { inflight, CACHE, busy: () => previewBusy, interval: () => lastPreviewAt, generation: () => configurationGeneration };', context);
  function port({ name = "debait:hover", sender = { id: runtime.id, tab: { id: 1 }, frameId: 0, url: "https://page.example/" }, postThrows = false } = {}) {
    const p = { name, sender, onMessage: listeners(), onDisconnect: listeners(), replies: [], closed: false,
      postMessage(message) { if (postThrows) throw new Error("closed"); this.replies.push(structuredClone(message)); },
      disconnect() { if (this.closed) return; this.closed = true; this.onDisconnect.emit(); },
      start(url = "https://article.example/a") { this.onMessage.emit({ type: "start", url }); } };
    ports.push(p); onConnect.emit(p); return p;
  }
  function manual(url = "https://article.example/a") {
    return new Promise((resolve) => onMessage.emit({ type: "debait:preview", url }, {}, resolve));
  }
  return { context, runtime, store, local, backend, fetchCalls, providerCalls, writes, timers, ports, port, manual,
    inspect: context.inspect, count: () => local.debaitUsage?.count || 0, setClock: (value) => now = value,
    change: (values) => { Object.assign(store, structuredClone(values)); backend.emit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }])), "sync"); }, flush };
}
