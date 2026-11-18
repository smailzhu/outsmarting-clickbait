import vm from "node:vm";
import { readFileSync } from "node:fs";

function eventTarget() {
  const listeners = new Map(), added = [], removed = [];
  return {
    listeners, added, removed,
    addEventListener(type, fn, phase = false) {
      added.push({ type, fn, phase });
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn, phase = false) {
      if (listeners.get(type)?.delete(fn)) removed.push({ type, fn, phase });
    },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
}

// Selector-aware connected DOM, including actual header parsing and replacement.
// Layout/native trusted events are not simulated.
export function panelDom() {
  let document;
  const navigations = [];
  function node(tag = "div", root = false) {
    const attrs = {}, el = {
      ...eventTarget(), tagName: root ? undefined : tag.toUpperCase(), children: [], parentElement: null,
      style: {}, shadowRoot: null, activeElement: null, focusCalls: 0,
      get isConnected() { return this === document || !!this.parentElement?.isConnected || !!this.host?.isConnected; },
      get id() { return attrs.id || ""; }, set id(v) { attrs.id = String(v); },
      get className() { return attrs.class || ""; }, set className(v) { attrs.class = String(v); },
      getAttribute(k) { return Object.hasOwn(attrs, k) ? attrs[k] : null; },
      setAttribute(k, v) { attrs[k] = String(v); }, removeAttribute(k) { delete attrs[k]; },
      get textContent() { return (this.text || "") + this.children.map((c) => c.textContent).join(""); },
      set textContent(v) { this.replaceChildren(); this.text = String(v); },
      get innerHTML() { return this.html || ""; },
      set innerHTML(html) {
        this.replaceChildren(); this.html = html; this.text = "";
        const stack = [this], decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        for (const m of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)([^>]*)>|([^<]+)/g)) {
          if (m[1]) { if (stack.length > 1) stack.pop(); }
          else if (m[2]) {
            const child = node(m[2]);
            for (const a of m[3].matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)")?/g)) child.setAttribute(a[1], decode(a[2] || ""));
            stack.at(-1).appendChild(child);
            if (!["br", "input", "img", "hr"].includes(m[2])) stack.push(child);
          } else if (m[4]) { const child = node("#text"); child.textContent = decode(m[4]); stack.at(-1).appendChild(child); }
        }
      },
      replaceChildren() { for (const c of this.children) c.parentElement = null; this.children = []; },
      appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; },
      append(...children) { children.forEach((c) => this.appendChild(c)); },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; },
      attachShadow() { const shadow = node("#shadow", true); shadow.host = this; this.shadowRoot = shadow; return shadow; },
      getRootNode() { return this.parentElement ? this.parentElement.getRootNode() : this; },
      matches(selector) {
        if (selector === ":popover-open") return !!this.popoverOpen;
        const m = /^([\w-]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/.exec(selector);
        if (!m) throw new Error(`Unsupported fixture selector: ${selector}`);
        return (!m[1] || this.tagName === m[1].toUpperCase()) && (!m[2] || this.className.split(/\s+/).includes(m[2])) && (!m[3] || this.getAttribute(m[3]) !== null && (m[4] === undefined || this.getAttribute(m[3]) === m[4]));
      },
      querySelectorAll(selector) { return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      get closeButton() { return this.querySelector(".x"); },
      focus() { this.focusCalls++; document.activeElement = this; },
      click() {
        this.dispatchEvent({ type: "click", target: this }); this.onclick?.();
        if (this.tagName === "A" && this.getAttribute("href") !== null) navigations.push({ href: this.href, target: this.target, rel: this.rel });
      },
      cloneNode() { return { innerText: "Factual article. ".repeat(50), querySelectorAll: () => [] }; },
    };
    for (const key of ["href", "target", "rel", "protocol"]) Object.defineProperty(el, key, {
      get() { if (key === "protocol") return attrs.href ? new URL(attrs.href).protocol : ""; return attrs[key] || ""; },
      set(v) { attrs[key] = key === "href" ? new URL(String(v)).href : String(v); },
    });
    return el;
  }
  document = node("#document", true);
  document.documentElement = node("html"); document.appendChild(document.documentElement);
  document.body = node("body"); document.documentElement.appendChild(document.body);
  document.activeElement = document.body; document.fullscreenElement = null; document.title = "Original";
  document.createElement = node;
  document.getElementById = (id) => {
    const seen = new Set();
    const walk = (el) => {
      if (seen.has(el)) return null;
      seen.add(el);
      if (el.id === id) return el;
      for (const child of el.children) { const found = walk(child); if (found) return found; }
      return null;
    };
    return walk(document);
  };
  return { document, window: eventTarget(), node, navigations };
}

export function setupPanel(kind, { full = false, lang = "en", spoofLauncher = false } = {}) {
  const dom = panelDom(), { document, window } = dom;
  if (spoofLauncher) { const b = dom.node("button"); b.id = "debait-btn"; document.body.appendChild(b); }
  const pending = [], messages = [], menus = [], writes = [];
  const store = { provider: "openai", key_openai: "fixture", profiles: {}, language: "" };
  const request = (...args) => new Promise((resolve, reject) => pending.push({ resolve, reject, args }));
  const label = 'Close "panel"';
  const translate = (key, subs = []) => {
    const args = Array.isArray(subs) ? subs : [subs];
    return key === "closeTitle" ? label : key === "sourceLabel" ? `Source: ${args[0]}`
      : key === "openRequestedArticleAria" ? `Open requested article on ${args[0]} (new tab)` : key === "openRequestedArticle" ? "Open requested article" : key;
  };
  const context = vm.createContext({ ...dom, URL, location: { href: "https://example.com/current" },
    navigator: { language: lang, userAgent: "Chrome/120.0" }, setTimeout, clearTimeout, AbortController,
    t: translate, verdict: (v) => v, extractPage: () => ({ text: "body", originalTitle: "Original" }),
    buildPrompt: () => "prompt", callProvider: request, parseResult: JSON.parse, CFG: {},
    snapshot: () => ({}), configuration: (s) => s, stale: () => false,
    DebaitI18n: { init: async () => {}, t: translate, verdict: (v) => v },
    DebaitPrompt: { buildPrompt: (a) => { messages.push({ article: a }); return "prompt"; }, parseResult: JSON.parse },
    chrome: { storage: { sync: { get: async () => ({}) }, onChanged: { addListener() {} } },
      runtime: { sendMessage: request, onMessage: { addListener() {} } } },
    GM_getValue: (key, fallback) => Object.hasOwn(store, key) ? structuredClone(store[key]) : fallback,
    GM_setValue: (key, value) => { writes.push(key); store[key] = structuredClone(value); },
    GM_registerMenuCommand: (name, fn) => menus.push({ name, fn }), prompt: () => null, alert() {},
    GM_xmlhttpRequest: (req) => new Promise(() => pending.push({
      args: [req], resolve: (text) => req.onload({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content: text } }] }) }),
      reject: () => req.onerror(),
    })),
  });
  let source = readFileSync(new URL(kind === "extension" ? "../../extension/content.js" : "../../userscript/debait.user.js", import.meta.url), "utf8");
  const hooks = "globalThis.api = { run, render, renderResult, closePanel, panel, safeSourceUrl, shouldClosePanelOnEscape, readPanelEscapeContext" + (kind === "extension" ? ", runLink" : ", addButton, t") + " };";
  if (full) source = kind === "userscript" ? source.replace(/\}\)\(\);\s*$/, hooks + "\n})();") : source + "\n" + hooks;
  else {
    const start = source.indexOf('const PANEL_ID = "debait-panel-host";');
    const end = source.indexOf(kind === "extension" ? "chrome.runtime.onMessage.addListener" : "// ---- Alt+hover link preview", start);
    source = source.slice(start, end) + "\n" + hooks;
  }
  vm.runInContext(source, context);
  const hosts = { get: (id) => document.getElementById(id), get size() { return ["debait-panel-host", "debait-tooltip"].filter((id) => document.getElementById(id)).length; } };
  const content = () => hosts.get("debait-panel-host")?.__content;
  const finish = (index, result) => {
    if (result instanceof Error) pending[index].reject(result);
    else pending[index].resolve(kind === "extension" ? { ok: true, text: JSON.stringify(result) } : JSON.stringify(result));
  };
  return { ...dom, context, api: context.api, hosts, pending, messages, menus, store, writes, content,
    close: () => content().closeButton.click(), finish,
    finishPreview: (index, result) => pending[index].resolve({ ok: true, result }),
    flush: () => new Promise((r) => setImmediate(r)),
    key: (facts = {}) => {
      const event = { type: "keydown", isTrusted: true, key: "Escape", composedPath: () => [document.body, document, window],
        preventDefault() { throw new Error("key interception"); }, stopPropagation() { throw new Error("key interception"); }, stopImmediatePropagation() { throw new Error("key interception"); }, ...facts };
      document.dispatchEvent(event); window.dispatchEvent(event); return event;
    },
  };
}
