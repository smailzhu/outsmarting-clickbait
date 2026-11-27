import { createHoverStorage } from "./hover-storage.js";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { parseOptionsHtml } from "./options-dom.js";

export const editableControls = ["uiLang", "provider", "key", "base", "model", "language", "customInstructions",
  "hoverActivation", "previewDwellMs", "previewMinIntervalMs", "dailyCap"];
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
  beforeApply, translate = (key) => key, applyStaticLabels = false, realI18n = false,
  connectedDOM = realI18n, htmlSource, sharedStorage, local = {}, locks = true } = {}) {
  const backend = sharedStorage || createHoverStorage({ sync: initial, local, locks,
    beforeGet: (area, keys) => area === "sync" ? beforeRead?.() : !Array.isArray(keys) ? beforeUsage?.() : undefined,
    beforeSet: (area, data) => area === "sync" ? beforeWrite?.(data, backend.attempts.filter((item) => item.area === "sync").length) : undefined });
  const store = backend.sync, nodes = {}, writes = [], attempts = [], messages = [], pending = [], timers = [], consoleOutput = [], navigations = [], fetchCalls = [];
  const calls = { syncGet: 0, syncSet: 0, localGet: 0, localSet: 0, i18nInit: 0, i18nApply: 0 };
  const window = eventTarget();
  const document = {
    body: {}, activeElement: null, getElementById: (id) => nodes[id],
    documentElement: { style: { properties: {}, setProperty(key, value) { this.properties[key] = value; } } },
  };
  document.activeElement = document.body;
  const html = htmlSource ?? readFileSync(new URL("../../extension/options.html", import.meta.url), "utf8");
  const fields = [...lockedControls, ...editableControls.map((id) => `${id}Modified`), "otherProvidersModified",
    "usage", "connectionStatus", "status", "reportLink", "saveBar", "baseHint", "modelHint", "discardHint", "keyHelp", "keyHelpText", "keyHelpLink"];
  function createElement(tagName, attributes) {
    const id = attributes.id;
    let value = "", text = "", disabled = Object.hasOwn(attributes, "disabled");
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || "";
    let checked = /\bchecked\b/.test(tag);
    const select = html.match(new RegExp(`<select\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    const values = select ? [...select[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]) : null;
    if (values) value = values[0];
    const node = {
      ...eventTarget(), tagName, children: [], parentElement: null,
      get checked() { return checked; },
      set checked(next) { checked = Boolean(next); },
      dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase()), value])),
      textWrites: 0, focusCalls: 0, height: 64,
      getAttribute(name) { return Object.hasOwn(attributes, name) ? attributes[name] : null; },
      hasAttribute(name) { return Object.hasOwn(attributes, name); },
      setAttribute(name, value) { attributes[name] = String(value); },
      removeAttribute(name) { delete attributes[name]; },
      get hidden() { return Object.hasOwn(attributes, "hidden"); },
      set hidden(next) { if (next) attributes.hidden = ""; else delete attributes.hidden; },
      get value() { return value; },
      set value(next) {
        value = String(next);
        if (values && !values.includes(value)) value = "";
        if (/type="number"/.test(tag) && (value.trim() !== value || (value !== "" && !Number.isFinite(Number(value))))) value = "";
        if (/<input/.test(tag) && !/type="number"/.test(tag)) value = value.replace(/[\r\n]/g, "");
      },
      get textContent() { return text + this.children.map((child) => child.textContent).join(""); },
      set textContent(next) {
        for (const child of this.children) child.parentElement = null;
        this.children = []; text = String(next); this.textWrites++;
      },
      get disabled() { return disabled; },
      set disabled(next) { disabled = next; if (disabled && document.activeElement === this) document.activeElement = document.body; },
      focus() { if (!disabled) { document.activeElement = this; this.focusCalls++; } },
      getBoundingClientRect() { return { height: this.height }; },
    };
    for (const key of ["href", "target", "rel"]) Object.defineProperty(node, key, {
      get() { return attributes[key] || ""; },
      set(value) { attributes[key] = key === "href" ? new URL(String(value)).href : String(value); },
    });
    node.click = async () => {
      if (disabled) return;
      await node.dispatchEvent({ type: "click", target: node });
      if (tagName === "a" && node.hasAttribute("href")) navigations.push({ href: node.href, target: node.target, rel: node.rel });
    };
    if (id) nodes[id] = node;
    return node;
  }
  if (connectedDOM) {
    const tree = parseOptionsHtml(html, createElement);
    document.getElementById = tree.getElementById;
    document.querySelectorAll = tree.querySelectorAll;
    document.elements = tree.elements;
    document.body = tree.elements().find((node) => node.tagName === "body");
    const style = document.documentElement.style;
    document.documentElement = tree.elements().find((node) => node.tagName === "html");
    document.documentElement.style = style;
    document.activeElement = document.body;
  } else for (const id of fields) {
    const tag = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || "";
    const attrs = Object.fromEntries([...tag.matchAll(/([^\s=<>/]+)(?:\s*=\s*"([^"]*)")?/g)].map((m) => [m[1], m[2] || ""]));
    createElement(tag.match(/^<(\w+)/)?.[1] || "span", { ...attrs, id });
  }
  if (!connectedDOM) {
    nodes.keyHelp.children = [nodes.keyHelpText, nodes.keyHelpLink];
    for (const child of nodes.keyHelp.children) child.parentElement = nodes.keyHelp;
  }
  let i18n = {
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
    document, window, structuredClone, URL, navigator: backend.navigator,
    fetch: (...args) => { fetchCalls.push(args); throw new Error("unexpected fetch"); },
    chrome: {
      storage: {
        ...backend.storage,
        sync: {
          get: async (keys) => { calls.syncGet++; return backend.storage.sync.get(keys); },
          set: async (data) => {
            calls.syncSet++;
            const serialized = structuredClone(data);
            attempts.push({ data: serialized, reference: data });
            await backend.storage.sync.set(serialized);
            writes.push(serialized);
          },
        },
        local: {
          get: async (keys) => { calls.localGet++; return backend.storage.local.get(keys); },
          set: async (data) => { calls.localSet++; return backend.storage.local.set(data); },
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
  if (realI18n) {
    for (const file of ["messages.gen.js", "i18n-runtime.js"]) vm.runInContext(readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8"), context);
    i18n = context.DebaitI18n;
    const init = i18n.init, apply = i18n.apply;
    i18n.init = async () => { calls.i18nInit++; await beforeI18n?.(); return init(); };
    i18n.apply = (...args) => { calls.i18nApply++; beforeApply?.(); return apply(...args); };
  }
  for (const file of ["profiles.js", "provider-help.js", "hover-activation.js", "hover-provenance.js", "options.js"]) vm.runInContext(readFileSync(new URL(`../../extension/${file}`, import.meta.url), "utf8"), context);
  return {
    nodes, document, window, context, store, backend, local: backend.local, writes, attempts, messages, pending, timers, i18n, calls, resizeObservers, consoleOutput, navigations, fetchCalls,
    resolveReply: (reply) => pending[0].resolve(reply),
    switchTo: async (id) => { nodes.provider.value = id; await nodes.provider.dispatch("input"); await nodes.provider.dispatch("change"); },
    selectActivation: async (mode) => { nodes.hoverActivation.value = mode; await nodes.hoverActivation.dispatch("change"); },
    edit: async (id, value, type = "input") => { nodes[id].value = value; await nodes[id].dispatch(type); },
    fireTimer: (id, evenIfCancelled = false) => { if (!timers[id].cancelled || evenIfCancelled) timers[id].fn(); },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}
