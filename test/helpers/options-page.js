import vm from "node:vm";
import { readFileSync } from "node:fs";

export const editableControls = ["uiLang", "provider", "key", "base", "model", "language", "customInstructions",
  "previewDwellMs", "previewMinIntervalMs", "dailyCap"];
export const actionControls = ["save", "discard", "testConnection"];
export const lockedControls = [...editableControls, ...actionControls];
export function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function eventTarget() {
  const listeners = new Map();
  const counts = { added: 0, removed: 0 };
  return {
    listeners, counts,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      if (!listeners.get(type).has(fn)) { listeners.get(type).add(fn); counts.added++; }
    },
    removeEventListener(type, fn) { if (listeners.get(type)?.delete(fn)) counts.removed++; },
    dispatchEvent(event) {
      const results = [...(listeners.get(event.type) || [])].map((fn) => fn(event));
      return Promise.all(results);
    },
    dispatch(type) { return this.dispatchEvent({ type }); },
  };
}

// Browser-like seams only: multiple listeners, serialized-at-invocation storage,
// rejected select values, input coercion, disabled focus loss and explicit timers.
export function createPage({ initial = { key: "saved-key" }, beforeRead, beforeWrite, beforeI18n, beforeUsage,
  beforeApply, translate = (key) => key, applyStaticLabels = false } = {}) {
  const store = structuredClone(initial), nodes = {}, writes = [], attempts = [], messages = [], pending = [], timers = [], consoleOutput = [];
  const calls = { syncGet: 0, syncSet: 0, localGet: 0, localSet: 0, i18nInit: 0, i18nApply: 0 };
  const window = eventTarget();
  const document = {
    body: {}, activeElement: null, getElementById: (id) => nodes[id],
    documentElement: { style: { properties: {}, setProperty(key, value) { this.properties[key] = value; } } },
  };
  document.activeElement = document.body;
  const html = readFileSync(new URL("../../extension/options.html", import.meta.url), "utf8");
  const fields = [...lockedControls, "usage", "connectionStatus", "status", "reportLink", "saveBar", "baseHint", "modelHint", "discardHint"];
  for (const id of fields) {
    let value = "", text = "", disabled = lockedControls.includes(id);
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || "";
    const select = html.match(new RegExp(`<select\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    const values = select ? [...select[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]) : null;
    nodes[id] = {
      ...eventTarget(), dataset: {}, textWrites: 0, focusCalls: 0, height: 64,
      get value() { return value; },
      set value(next) {
        value = String(next);
        if (values && !values.includes(value)) value = "";
        if (/type="number"/.test(tag) && (value.trim() !== value || (value !== "" && !Number.isFinite(Number(value))))) value = "";
        if (/<input/.test(tag) && !/type="number"/.test(tag)) value = value.replace(/[\r\n]/g, "");
      },
      get textContent() { return text; },
      set textContent(next) { text = String(next); this.textWrites++; },
      get disabled() { return disabled; },
      set disabled(next) { disabled = next; if (disabled && document.activeElement === this) document.activeElement = document.body; },
      focus() { if (!disabled) { document.activeElement = this; this.focusCalls++; } },
      getBoundingClientRect() { return { height: this.height }; },
    };
  }
  const i18n = {
    lang: "en", t: (key, subs) => translate(key, i18n.lang, subs),
    init: async () => { calls.i18nInit++; await beforeI18n?.(); i18n.lang = store.uiLang || "en"; },
    apply() {
      calls.i18nApply++;
      beforeApply?.();
      if (applyStaticLabels) for (const [id, key] of [["save", "optSave"], ["discard", "optDiscard"], ["discardHint", "optDiscardHint"]]) nodes[id].textContent = i18n.t(key);
    },
  };
  const resizeObservers = [];
  const context = vm.createContext({
    document, window, structuredClone,
    chrome: {
      storage: {
        sync: {
          get: async (defaults) => { calls.syncGet++; await beforeRead?.(); return { ...defaults, ...structuredClone(store) }; },
          set: async (data) => {
            calls.syncSet++;
            const serialized = structuredClone(data);
            attempts.push({ data: serialized, reference: data });
            await beforeWrite?.(serialized, attempts.length);
            writes.push(structuredClone(serialized));
            Object.assign(store, structuredClone(serialized));
          },
        },
        local: {
          get: async (defaults) => { calls.localGet++; await beforeUsage?.(); return defaults; },
          set: async () => { calls.localSet++; },
        },
      },
      runtime: { sendMessage: (data) => { messages.push(structuredClone(data)); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } },
    },
    DebaitI18n: i18n,
    setTimeout(fn, delay) { timers.push({ fn, delay, cancelled: false }); return timers.length - 1; },
    clearTimeout(id) { timers[id].cancelled = true; },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; resizeObservers.push(this); }
      observe(node) { this.node = node; }
    },
    console: Object.fromEntries(["log", "error", "warn", "info", "debug"].map((key) => [key, (...args) => consoleOutput.push(args.join(" "))])),
  });
  for (const file of ["profiles.js", "options.js"]) vm.runInContext(readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8"), context);
  return {
    nodes, document, window, context, store, writes, attempts, messages, pending, timers, i18n, calls, resizeObservers, consoleOutput,
    resolveReply: (reply) => pending[0].resolve(reply),
    switchTo: async (id) => { nodes.provider.value = id; await nodes.provider.dispatch("input"); await nodes.provider.dispatch("change"); },
    edit: async (id, value, type = "input") => { nodes[id].value = value; await nodes[id].dispatch(type); },
    fireTimer: (id, evenIfCancelled = false) => { if (!timers[id].cancelled || evenIfCancelled) timers[id].fn(); },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
