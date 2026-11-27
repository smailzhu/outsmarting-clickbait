import { createHoverStorage } from "./hover-storage.js";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { listeners } from "./hover-worker.js";
export { deferred, flush } from "./hover-worker.js";
function eventTarget(parent = () => null) {
  const events = new Map();
  return { events, eventParent: parent,
    addEventListener(type, fn, options) { if (!events.has(type)) events.set(type, []); events.get(type).push({ fn, options }); },
    removeEventListener(type, fn) { events.set(type, (events.get(type) || []).filter((item) => item.fn !== fn)); },
    emit(type, values = {}) {
      const target = values.target || this;
      const path = [target.events ? target : this];
      for (let node = path[0].eventParent?.(); node; node = node.eventParent?.()) path.push(node);
      let stopped = false, immediate = false;
      const e = { type, target, isTrusted: true, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, repeat: false,
        getModifierState: () => false,
        bubbles: !["scroll", "blur", "focus", "visibilitychange"].includes(type), defaultPrevented: false,
        composedPath: () => [...path], stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = immediate = true; },
        preventDefault() { this.defaultPrevented = true; }, ...values };
      const invoke = (node, capture, phase) => {
        e.currentTarget = node; e.eventPhase = phase;
        for (const { fn, options } of [...(node.events.get(type) || [])]) {
          if (immediate) break;
          if ((options === true || !!options?.capture) === capture) fn(e);
        }
      };
      for (const node of path.slice(1).reverse()) {
        invoke(node, true, 1);
        if (stopped) break;
      }
      if (!stopped) {
        invoke(path[0], true, 2);
        if (!immediate) invoke(path[0], false, 2);
        if (e.bubbles) for (const node of path.slice(1)) {
          if (stopped) break;
          invoke(node, false, 3);
        }
      }
      e.currentTarget = null; e.eventPhase = 0;
      return e;
    } };
}
export function createContent({ prefs = {}, initialRead, localRead, local = {}, sharedStorage, connect, postThrows = false, connectThrows = false, beforeLoad } = {}) {
  const backend = sharedStorage || createHoverStorage({ sync: prefs, local });
  const hosts = new Map(), timers = [], observers = [], ports = [], messages = [], pendingManual = [], storage = listeners();
  const location = { href: "https://page.example/" }, window = { ...eventTarget(), innerWidth: 1200, innerHeight: 900 };
  let focused = true, base = location.href;
  function element() {
    const attributes = {};
    const node = { ...eventTarget(() => node.parent || document), tagName: "DIV", shadowRoot: null, isContentEditable: false, isConnected: false, style: {}, innerHTML: "", children: [],
      setAttribute(name, value) { attributes[name] = String(value); },
      getAttribute(name) { return attributes[name] ?? null; },
      removeAttribute(name) { delete attributes[name]; },
      appendChild(child) { child.parent = this; child.isConnected = this.isConnected; this.children.push(child); if (child.id) hosts.set(child.id, child); },
      contains(other) { return !!other && (other === this || this.children.some((child) => child.contains(other))); },
      closest() { return this.anchor || this.parent?.closest?.() || null; },
      remove() { this.isConnected = false; hosts.delete(this.id); },
      attachShadow() { const root = { activeElement: null, host: this, append(...nodes) { for (const n of nodes) { n.root = root; n.parent = node; node.children.push(n); } }, querySelector: () => ({ addEventListener() {} }) }; this.shadowRoot = root; return root; },
      getRootNode() { return this.root; } };
    return node;
  }
  const body = element(); body.isConnected = true;
  body.cloneNode = () => ({ innerText: "article ".repeat(50), querySelectorAll: () => [] });
  const document = { ...eventTarget(() => window), body, activeElement: body, designMode: "off", title: "Fixture", visibilityState: "visible", hasFocus: () => focused,
    getElementById: (id) => hosts.get(id), querySelector: () => null, createElement: element };
  function anchor(href = "https://article.example/a") {
    const a = element(); a.tagName = "A"; a.isConnected = true; a.anchor = a; let raw = href;
    Object.defineProperties(a, { href: { get: () => new URL(raw, base).href, set: (value) => raw = value },
      protocol: { get: () => new URL(raw, base).protocol } });
    return a;
  }
  function fakePort() {
    return { onMessage: listeners(), onDisconnect: listeners(), sent: [], closed: false,
      postMessage(msg) { if (postThrows) throw new Error("post failed"); this.sent.push(msg); },
      disconnect() { if (this.closed) return; this.closed = true; this.onDisconnect.emit(); },
      reply(msg) { this.onMessage.emit(msg); }, unexpected() { this.onDisconnect.emit(); } };
  }
  const context = vm.createContext({ document, window, location, URL,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
      observe(target, options) { this.active = true; this.target = target; this.options = options; }
      disconnect() { this.active = false; }
    },
    setTimeout(fn, delay) { const timer = { fn, delay, canceled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.canceled = true; },
    DebaitI18n: { init: async () => {}, t: (key) => key, verdict: (key) => key },
    DebaitPrompt: { buildPrompt: () => "prompt", parseResult: JSON.parse },
    chrome: { storage: { ...backend.storage,
      sync: { get: (keys) => initialRead ? initialRead(keys) : backend.storage.sync.get(keys) },
      local: { get: (keys) => localRead ? localRead(keys) : backend.storage.local.get(keys) } },
      runtime: { onMessage: listeners(), connect(options) { if (connectThrows) throw new Error("connect failed"); const port = connect ? connect(options) : fakePort(); ports.push(port); return port; },
        sendMessage(message) { messages.push(message); return new Promise((resolve) => pendingManual.push(resolve)); } } },
  });
  backend.storage.onChanged.addListener((...args) => storage.emit(...args));
  beforeLoad?.({ document, window });
  vm.runInContext(readFileSync(new URL("../../extension/hover-activation.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../../extension/content.js", import.meta.url), "utf8"), context);
  return { context, document, window, backend, element, hosts, timers, observers, ports, messages, anchor,
    child(a) { const c = element(); a.appendChild(c); return c; },
    mouse(type, target, { screenX = 10, screenY = 10, clientX = screenX, clientY = screenY, ...rest } = {}) {
      return document.emit(type, { target, screenX, screenY, clientX, clientY, ...rest });
    },
    key(type, values = {}) { return window.emit(type, { ...values }); },
    timer(index = timers.length - 1, stale = false) { const timer = timers[index]; if (timer && (!timer.canceled || stale)) timer.fn(); },
    mutate(records = []) { for (const o of observers) if (o.active) o.callback(records); },
    setBase(value) { base = value; }, focus(value) { focused = value; },
    change(values, area = "sync") { backend.emit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { newValue: v }])), area); },
    remove(fields, area = "sync") { backend.emit(Object.fromEntries(fields.map((field) => [field, {}])), area); },
    manual(url) { context.chrome.runtime.onMessage.emit({ type: "debait:runLink", url }); }, pendingManual,
    tip: () => hosts.get("debait-tooltip")?.__content.innerHTML,
  };
}

// IPC deliveries are independently queued. DOM cancellation must reach the
// worker before its preparation checkpoint to prevent AI dispatch.
export function bridge(worker) {
  const queue = [];
  return { queue, flush() { while (queue.length) queue.shift()(); },
    connect(options) {
      const client = { onMessage: listeners(), onDisconnect: listeners(), closed: false,
        postMessage(message) { queue.push(() => server.onMessage.emit(message)); },
        disconnect() { if (this.closed) return; this.closed = true; queue.push(() => server.disconnect()); } };
      const server = { name: options.name, sender: { id: worker.runtime.id, tab: { id: 1 }, frameId: 0, url: "https://page.example/" },
        onMessage: listeners(), onDisconnect: listeners(), closed: false,
        postMessage(message) { queue.push(() => client.onMessage.emit(message)); },
        disconnect() { if (this.closed) return; this.closed = true; this.onDisconnect.emit(); queue.push(() => client.onDisconnect.emit()); } };
      worker.runtime.onConnect.emit(server);
      return client;
    } };
}
