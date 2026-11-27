// Extracts the current article from the DOM, asks the background worker to call
// the LLM (CORS-free), and renders an overlay panel. Triggered by the popup or
// context menu via chrome.runtime messages.

function extractPage() {
  const meta = (sel) => document.querySelector(sel)?.content?.trim() || "";
  const originalTitle = meta('meta[property="og:title"]') || document.title;
  const description =
    meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const root =
    document.querySelector("article") || document.querySelector("main") || document.body;
  const clone = root.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,nav,aside,footer,header,form").forEach((n) => n.remove());
  const text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  return { originalTitle, description, text, url: location.href };
}

// ---- Extension hover preview: saved Shift/Alt/hover-without-a-modifier activation.
// Shift requires physical movement; withdrawal cannot refund dispatched work.
const TIP_ID = "debait-tooltip";
let tipHost = null;
const H = globalThis.DebaitHoverActivation;
let hoverState = H.createState();
let hoverPolicy = H.policy(hoverState);
function projectHoverPolicy() {
  const next = H.policy(hoverState);
  if (next.ready !== hoverPolicy.ready || next.mode !== hoverPolicy.mode || next.dwellMs !== hoverPolicy.dwellMs) {
    hoverPolicy = next;
    cancelHover();
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  hoverState = H.applyChanges(hoverState, area, changes);
  projectHoverPolicy();
  if (area === "sync" && changes.uiLang) globalThis.DebaitI18n.init();
});
for (const area of ["sync", "local"]) {
  const token = H.beginRead(hoverState, area);
  chrome.storage[area].get(area === "sync" ? H.SYNC_FIELDS : [H.PROVENANCE_KEY]).then((raw) => {
    hoverState = H.mergeRead(hoverState, area, token, raw);
    projectHoverPolicy();
  }).catch(() => {}); // Read failure never fabricates preference/dwell knowledge.
}
let hovered = null;
let altDown = false;
let shiftDown = false;
const pressedKeys = new Set();
let compositionActive = false;
let lastScreen = null;
let movementSeq = 0;
let consumedMovementSeq = 0;
let intentToken = 0;
let hoverIntent = null;

// Tooltip lives in its own Shadow DOM (like the panel) so host-page CSS can't
// bleed in and make it unreadable.
const TIP_CSS = `
:host { all: initial; }
.tipwrap { box-sizing:border-box; max-width:320px; background:#0f1115; color:#f3f4f6;
  font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  text-align:left; letter-spacing:normal; word-break:break-word;
  border:1px solid #30363d; border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,.5); padding:10px; }
.tipwrap * { box-sizing:border-box; margin:0; }
`;
function tip() {
  if (tipHost?.isConnected) return tipHost.__content;
  const host = document.createElement("div");
  tipHost = host;
  host.id = TIP_ID;
  host.style.cssText = "all:initial; position:fixed; z-index:2147483647; pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = TIP_CSS;
  const content = document.createElement("div");
  content.className = "tipwrap";
  root.append(style, content);
  document.body.appendChild(host);
  host.__content = content;
  return content;
}
function hideTip() { tipHost?.remove(); tipHost = null; }
function placeTip(x, y) {
  const host = tip().getRootNode().host; // the element we control (not a page #debait-tooltip)
  const pad = 14;
  host.style.left = Math.min(x + pad, window.innerWidth - 342) + "px";
  host.style.top = Math.min(y + pad, window.innerHeight - 160) + "px";
}

function isPreviewable(a) {
  if (!a || !a.href) return false;
  if (!/^https?:$/.test(a.protocol)) return false;
  const u = new URL(a.href);
  if (u.href.split("#")[0] === location.href.split("#")[0]) return false; // same page
  return true;
}

function validIntent(intent) {
  return hoverIntent === intent && intent.token === intentToken && !intent.invalid &&
    hoverPolicy.ready && hoverPolicy.mode === intent.mode && selectedKeyHeld(intent.requiredKey) &&
    (intent.origin !== "keyboard" || stationaryAltAllowed()) &&
    foreground() && intent.anchor.isConnected && intent.anchor.href === intent.href &&
    isPreviewable(intent.anchor) && hovered?.anchor === intent.anchor && hovered.href === intent.href;
}
function showHoverError(intent) {
  if (!validIntent(intent)) { if (hoverIntent === intent) cancelHover(); return; }
  placeTip(hovered.x, hovered.y);
  tip().innerHTML = `<b style="color:#e5484d">${esc(t("errGeneric"))}</b>`;
}
function renderHoverReply(intent, resp) {
  if (!validIntent(intent)) { if (hoverIntent === intent) cancelHover(); return; }
  placeTip(hovered.x, hovered.y);
  if (!resp?.ok) return showHoverError(intent);
  const r = resp.result;
  if (r.setup_required)
    return void (tip().innerHTML = `<b style="color:#58a6ff">${esc(t("tipSetupHeading"))}</b><div style="margin-top:4px">${esc(t("tipSetupBody"))}</div>`);
  if (r.stale) return void (tip().innerHTML = esc(t("errStale")));
  if (r.capped)
    return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> · ${esc(t("tipCapped", [String(r.used), String(r.cap)]))}`);
  if (r.rate_limited)
    return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> · ${esc(t("tipRateLimited", [String(r.retryIn)]))}`);
  if (r.throttled)
    return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> · ${esc(t("tipThrottled"))}`);
  if (r.thin_fetch)
    return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 ${t("brand")}</b> · ${esc(t("tipThin"))}<br>${esc(r.description || r.originalTitle || "")}`);
  const n = clampScore(r.clickbait_score);
  tip().innerHTML = `
    <b style="color:#58a6ff">🪝🚫 ${esc(r.honest_title || "")}</b>
    <div style="height:6px;background:#222;border-radius:3px;overflow:hidden;margin:6px 0 4px">
      <div style="height:100%;width:${n}%;background:${scoreColor(n)}"></div></div>
    <div><b style="color:${scoreColor(n)}">${n}/100</b> · ${esc(verdict(r.substance_verdict))} · ${esc(t("metaWorth"))} <b>${r.worth_clicking ? t("yes") : t("no")}</b></div>
    <div style="color:#bbb;margin-top:4px">${esc(r.summary || "")}</div>`;
}

function foreground() { return document.visibilityState === "visible" && document.hasFocus(); }
function ownedEvent(e) {
  const path = e.composedPath?.() || [e.target];
  return path.some((node) => (tipHost && (node === tipHost || node?.getRootNode?.()?.host === tipHost)) ||
    (panelHost && (node === panelHost || node?.getRootNode?.()?.host === panelHost)));
}
function cancelHover() {
  intentToken++; // Invalidate before touching timers or transport.
  consumedMovementSeq = movementSeq;
  const intent = hoverIntent;
  hoverIntent = null;
  if (intent) {
    intent.invalid = true;
    clearTimeout(intent.timer);
    intent.observer.disconnect();
    closeTransport(intent);
  }
  hideTip();
}
function closeTransport(intent) {
  const port = intent.port;
  intent.port = null;
  intent.localDisconnect = true;
  if (port) {
    port.onMessage.removeListener(intent.onReply);
    port.onDisconnect.removeListener(intent.onDisconnect);
    try { port.disconnect(); } catch {}
  }
}
function startHover(origin = "movement") {
  consumedMovementSeq = movementSeq;
  const intent = { token: ++intentToken, anchor: hovered.anchor, href: hovered.href,
    requiredKey: hoverPolicy.mode === "shift" ? "Shift" : hoverPolicy.mode === "alt" ? "Alt" : null,
    mode: hoverPolicy.mode, origin, timer: null, port: null, invalid: false,
    received: false, localDisconnect: false, observer: null };
  hoverIntent = intent;
  intent.observer = new MutationObserver((records) => {
    if (hoverIntent !== intent) return;
    const changed = records.some((record) =>
      (record.type === "attributes" && record.target === intent.anchor && record.attributeName === "href") ||
      (record.type === "childList" && [...record.removedNodes].some((node) => node === intent.anchor || node.contains?.(intent.anchor))));
    if (changed || !validIntent(intent)) cancelHover();
  });
  intent.observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["href"] });
  intent.timer = setTimeout(() => {
    if (!validIntent(intent)) { if (hoverIntent === intent) cancelHover(); return; }
    placeTip(hovered.x, hovered.y);
    tip().innerHTML = `<b style="color:#58a6ff">🪝🚫 ${esc(t("brand"))}</b> · ${esc(t("tipReading"))}<br><span style="color:#888">${esc(intent.href).slice(0, 80)}</span>`;
    try {
      const port = chrome.runtime.connect({ name: "debait:hover" });
      intent.port = port;
      intent.onReply = (resp) => {
        if (intent.received || intent.invalid) return;
        intent.received = true;
        renderHoverReply(intent, resp);
        closeTransport(intent);
      };
      intent.onDisconnect = () => {
        // Reading lastError suppresses Chromium's unchecked-disconnect warning.
        void chrome.runtime.lastError;
        if (intent.localDisconnect || intent.received || intent.invalid) return;
        closeTransport(intent);
        showHoverError(intent);
      };
      port.onMessage.addListener(intent.onReply);
      port.onDisconnect.addListener(intent.onDisconnect);
      port.postMessage({ type: "start", url: intent.href });
    } catch {
      closeTransport(intent);
      showHoverError(intent);
    }
  }, hoverPolicy.dwellMs);
}
function sampleScreen(e, credit = true) {
  if (!Number.isFinite(e.screenX) || !Number.isFinite(e.screenY)) return;
  if (credit && lastScreen && (lastScreen.x !== e.screenX || lastScreen.y !== e.screenY)) movementSeq++;
  lastScreen = { x: e.screenX, y: e.screenY };
}
function trackMouse(e) {
  if (!e.isTrusted) return;
  const anchor = ownedEvent(e) ? null : e.target.closest?.("a[href]");
  const href = anchor?.href;
  if (anchor !== hovered?.anchor || href !== hovered?.href) {
    cancelHover(); // Consume prior credit BEFORE sampling the entering event.
    hovered = null;
  }
  sampleScreen(e);
  altDown = !!e.altKey;
  shiftDown = !!e.shiftKey;
  if (!isPreviewable(anchor) || !anchor.isConnected || !foreground() || (!hoverPolicy.ready || !selectedKeyHeld())) {
    cancelHover();
    // An eligible stationary link may still be used by a fresh Alt keydown.
    hovered = isPreviewable(anchor) && anchor.isConnected && foreground() ? { anchor, href, x: e.clientX, y: e.clientY } : null;
    return;
  }
  hovered = { anchor, href, x: e.clientX, y: e.clientY };
  if (hoverIntent && !validIntent(hoverIntent)) cancelHover();
  if (hoverIntent) { consumedMovementSeq = movementSeq; return; }
  if (movementSeq > consumedMovementSeq) startHover();
}
// Observe before page bubble handlers can hide movement or cancellation.
for (const type of ["mouseover", "mousemove"]) window.addEventListener(type, trackMouse, { capture: true });
window.addEventListener("mouseout", (e) => {
  if (!e.isTrusted || !hovered || e.target.closest?.("a[href]") !== hovered.anchor) return;
  if (hovered.anchor.contains(e.relatedTarget)) return;
  cancelHover(); hovered = null;
}, { capture: true });
function selectedKeyHeld(key = hoverPolicy.mode === "shift" ? "Shift" : hoverPolicy.mode === "alt" ? "Alt" : null) {
  return key === "Shift" ? shiftDown : key === "Alt" ? altDown : true;
}
const modifierKeys = new Set(["Shift", "Alt", "Control", "Meta", "AltGraph"]);
function readHoverFocus(event) {
  // Bounded focus/path checks only, not the panel's page-wide overlay scan.
  try {
    if (document.designMode === "on") return false;
    const path = event ? event.composedPath() : [document];
    if (!Array.isArray(path) || !path.length || path.length > 100 || !path.every((node) => node !== null && (typeof node === "object" || typeof node === "function"))) return false;
    const readable = (node) => !["INPUT", "TEXTAREA", "SELECT", "IFRAME", "FRAME", "OBJECT", "EMBED"].includes(String(node.tagName).toUpperCase()) && !node.isContentEditable;
    if (!path.every(readable)) return false;
    let active = document.activeElement;
    if (active === undefined) return false;
    const seen = new Set();
    while (active) {
      if (seen.has(active) || seen.size >= 100 || !readable(active)) return false;
      seen.add(active);
      const shadow = active.shadowRoot;
      if (String(active.tagName).includes("-") && shadow === null) return false;
      const deeper = shadow ? shadow.activeElement : null;
      if (!deeper) break;
      active = deeper;
    }
    return true;
  } catch { return false; }
}
function stationaryAltAllowed(event) {
  return !shiftDown && !compositionActive && pressedKeys.size === 0 && readHoverFocus(event);
}
function cancelTypingInterest() {
  if (hoverIntent?.requiredKey === "Shift" || hoverIntent?.origin === "keyboard") cancelHover();
}
function altChord(event) {
  try {
    return event.shiftKey || event.ctrlKey || event.metaKey || shiftDown ||
      pressedKeys.has("Control") || pressedKeys.has("Meta") || pressedKeys.has("AltGraph") ||
      event.getModifierState?.("AltGraph");
  } catch { return true; }
}
window.addEventListener("keydown", (e) => {
  if (!e.isTrusted) return;
  const previousAlt = altDown;
  if (e.key === "Alt") altDown = true;
  if (e.key === "Shift") shiftDown = true;
  if (!["Alt", "Shift"].includes(e.key)) pressedKeys.add(e.key);
  const composing = e.isComposing || e.keyCode === 229;
  if (composing) compositionActive = true;
  if (composing || !modifierKeys.has(e.key)) cancelTypingInterest();
  if (hoverIntent?.origin === "keyboard" && (e.key !== "Alt" && modifierKeys.has(e.key) || altChord(e))) cancelHover();
  // Shift keydown NEVER consumes/revives movement credit or schedules work.
  if (e.key !== "Alt" || previousAlt || e.repeat || composing || altChord(e) || !stationaryAltAllowed(e)) return;
  if (ownedEvent(e)) { consumedMovementSeq = movementSeq; return; }
  if (!hoverPolicy.ready || hoverPolicy.mode !== "alt" || hoverIntent || !hovered) return;
  if (!foreground() || !hovered.anchor.isConnected || hovered.anchor.href !== hovered.href || !isPreviewable(hovered.anchor)) {
    cancelHover(); hovered = null; return;
  }
  startHover("keyboard");
}, { capture: true });
window.addEventListener("keyup", (e) => {
  if (!e.isTrusted) return;
  if (e.key === "Alt") altDown = false;
  if (e.key === "Shift") shiftDown = false;
  pressedKeys.delete(e.key);
  if (hoverIntent?.requiredKey === e.key) cancelHover();
}, { capture: true });
for (const type of ["compositionstart", "compositionupdate", "compositionend", "beforeinput", "input"]) window.addEventListener(type, (e) => {
  if (!e.isTrusted) return;
  if (type === "compositionend") { compositionActive = false; return; }
  if (type === "compositionstart" || type === "compositionupdate" || e.isComposing || ["insertCompositionText", "deleteCompositionText", "insertFromComposition"].includes(e.inputType)) {
    compositionActive = true;
    cancelTypingInterest();
  }
}, { capture: true });
window.addEventListener("focus", (e) => {
  if (e.isTrusted && e.target !== window && !readHoverFocus(e)) cancelTypingInterest();
}, { capture: true });
for (const type of ["pointerdown", "click", "contextmenu"]) window.addEventListener(type, (e) => {
  if (!e.isTrusted) return;
  cancelHover(); hovered = null;
  if (type === "pointerdown") sampleScreen(e, false);
}, { capture: true });
function leaveForeground(resetScreen) {
  cancelHover(); hovered = null; altDown = false; shiftDown = false;
  pressedKeys.clear(); compositionActive = false;
  if (resetScreen) lastScreen = null;
}
window.addEventListener("scroll", () => leaveForeground(false), { capture: true, passive: true });
window.addEventListener("blur", (e) => { if (e.target === window) leaveForeground(true); }, { capture: true });
window.addEventListener("pagehide", () => leaveForeground(true), { capture: true });
window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") leaveForeground(true); }, { capture: true });

const PANEL_ID = "debait-panel-host";
let panelHost = null;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const scoreColor = (n) => (n >= 60 ? "#ff6b6e" : n >= 30 ? "#ffc14d" : "#4ac97e");
// Model output is untrusted: coerce the score to a finite int in [0,100] so it
// can't inject markup via the style attribute or text.
const clampScore = (v) => { let n; try { n = Math.round(Number(v)); } catch { return 0; } return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; };
// i18n: resolve a localized string (falls back to the key), and the verdict enum.
const t = (k, subs) => globalThis.DebaitI18n.t(k, subs);
const verdict = (v) => globalThis.DebaitI18n.verdict(v);
globalThis.DebaitI18n.init(); // resolve interface language (async; browser locale until then)

// Styles live in a Shadow DOM so the host page's CSS cannot bleed into the
// panel (the usual cause of unreadable overlays).
const PANEL_CSS = `
:host { all: initial; }
.wrap { position:fixed; top:16px; right:16px; width:380px; max-height:82vh; overflow:auto;
  background:#0f1115; color:#f3f4f6;
  font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  text-align:left; letter-spacing:normal; word-break:break-word;
  border:1px solid #30363d; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.6); padding:16px; }
.wrap * { box-sizing:border-box; margin:0; }
.hd { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.brand { color:#6cb6ff; font-weight:700; font-size:15px; }
.x { cursor:pointer; color:#9aa4b2; font-size:16px; line-height:1; padding:2px 7px; border-radius:6px; border:0; background:transparent; }
.x:hover { background:#20262e; color:#fff; }
.x:focus-visible { outline:2px solid #6cb6ff; outline-offset:2px; }
.source { color:#9aa4b2; font-size:12px; margin-top:12px; }
.source-open { color:#6cb6ff; margin-left:8px; }
.source-open:focus-visible { outline:2px solid #6cb6ff; outline-offset:2px; }
.lbl { color:#9aa4b2; font-size:11px; letter-spacing:.07em; text-transform:uppercase; margin-top:6px; }
.orig { color:#c9d1d9; margin:2px 0 6px; }
.title { font-weight:600; font-size:15px; margin:2px 0 10px; }
.bar { height:8px; background:#21262d; border-radius:4px; overflow:hidden; margin:6px 0; }
.bar > i { display:block; height:100%; }
.meta { margin-bottom:10px; }
.sum { color:#e6edf3; margin-bottom:10px; }
ul { margin:4px 0 10px; padding-left:20px; } li { margin:3px 0; }
pre { white-space:pre-wrap; color:#c9d1d9; }
`;

function safeSourceUrl(raw) {
  if (typeof raw !== "string" || raw.length < 1 || raw.length > 2048 || /[\u0000-\u001F\u007F-\u009F\s]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || !u.hostname) return null;
    return Object.freeze({ href: u.href, host: u.hostname });
  } catch { return null; }
}

function panelEscapeEventEligible(event) {
  return event.isTrusted === true && event.key === "Escape" && !event.repeat
    && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
function shouldClosePanelOnEscape(eventFacts, contextFacts) {
  return panelEscapeEventEligible(eventFacts) && !!contextFacts && !contextFacts.uncertain
    && !contextFacts.fullscreen && !contextFacts.overlay
    && (contextFacts.panelPath || contextFacts.neutralFocus);
}

// Read-only, bounded checks: any uncertainty keeps the close button available
// rather than consuming a page control's Escape. No focus is moved.
function readPanelEscapeContext(host, event) {
  const facts = { uncertain: true, fullscreen: false, overlay: false,
    panelPath: false, neutralFocus: false, launcherFocus: false };
  try {
    const path = event.composedPath();
    if (!Array.isArray(path) || !path.length || !path.every((node) => node !== null && (typeof node === "object" || typeof node === "function"))) return facts;
    let active = document.activeElement;
    const focusSeen = new Set();
    while (active) {
      if (focusSeen.has(active) || focusSeen.size >= 100) return facts;
      focusSeen.add(active);
      const shadow = active.shadowRoot;
      if (String(active.tagName).includes("-") && shadow === null) return facts;
      const deeper = shadow ? shadow.activeElement : null;
      if (!deeper) break;
      active = deeper;
    }
    facts.fullscreen = !!document.fullscreenElement;
    if (facts.fullscreen) return facts;
    const roots = new Set([document]), seen = new Set();
    const stack = [{ children: document.children, index: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.index >= frame.children.length) { stack.pop(); continue; }
      const element = frame.children[frame.index++];
      if (seen.has(element) || seen.size >= 10000) return facts;
      seen.add(element);
      if (element === host) continue;
      if (element.matches('dialog[open]') || element.matches('[aria-modal="true"]') || element.matches(':popover-open')) {
        facts.overlay = true;
        return facts;
      }
      const shadow = element.shadowRoot;
      if (shadow) {
        if (roots.has(shadow) || roots.size >= 100) return facts;
        roots.add(shadow);
        stack.push({ children: shadow.children, index: 0 });
      }
      stack.push({ children: element.children, index: 0 });
    }
    facts.panelPath = path.includes(host);
    facts.neutralFocus = active === null || active === document.body || active === document.documentElement;
    facts.uncertain = false;
  } catch { /* Uninspectable focus, roots or selectors veto dismissal. */ }
  return facts;
}

function detachPanelKey(host) {
  if (host?.__onKey) {
    window.removeEventListener("keydown", host.__onKey, false);
    host.__onKey = null;
  }
}

function panel() {
  let host = document.getElementById(PANEL_ID);
  if (panelHost && (!panelHost.isConnected || host !== panelHost)) {
    detachPanelKey(panelHost);
    panelHost.remove();
    panelHost = null;
  }
  if (host && host === panelHost && host.__content) return host.__content;
  host = document.createElement("div");
  host.id = PANEL_ID;
  host.style.cssText = "all:initial; position:fixed; z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  const content = document.createElement("div");
  content.className = "wrap";
  root.append(style, content);
  document.body.appendChild(host);
  host.__content = content;
  panelHost = host;
  host.__onKey = function onPanelKey(event) {
    if (!host.isConnected || host !== panelHost || document.getElementById(PANEL_ID) !== host) {
      detachPanelKey(host);
      host.remove();
      if (panelHost === host) panelHost = null;
      return;
    }
    if (!panelEscapeEventEligible(event)) return;
    if (shouldClosePanelOnEscape(event, readPanelEscapeContext(host, event))) closePanel();
  };
  window.addEventListener("keydown", host.__onKey, false);
  return content;
}
let panelRun = 0;
function closePanel(owner = panelHost) {
  if (!owner) return;
  detachPanelKey(owner);
  owner.remove();
  // A close control belonging to an older panel must not dismiss a newer one.
  if (owner === panelHost) {
    panelRun++;
    panelHost = null;
  }
}
const render = (html, source, openRequested = false) => {
  const content = panel();
  // Every state gets the same dismissible header, including loading/errors.
  content.innerHTML = hd() + html;
  const owner = content.getRootNode().host;
  content.getRootNode().querySelector(".x")?.addEventListener("click", () => closePanel(owner));
  if (source) {
    const row = document.createElement("div");
    row.className = "source";
    const label = document.createElement("span");
    label.className = "source-host";
    label.textContent = t("sourceLabel", [source.host]);
    row.appendChild(label);
    if (openRequested) {
      const a = document.createElement("a");
      a.className = "source-open";
      a.href = source.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = t("openRequestedArticle");
      a.setAttribute("aria-label", t("openRequestedArticleAria", [source.host]));
      row.appendChild(a);
    }
    content.appendChild(row);
  }
};
const hd = () => {
  const label = esc(t("closeTitle")).replace(/"/g, "&quot;");
  return `<div class="hd"><span class="brand">🪝🚫 ${esc(t("brand"))}</span><button type="button" class="x" title="${label}" aria-label="${label}">✕</button></div>`;
};

function renderResult(a, r, source, openRequested = false) {
  if (!r || r.parse_error) return render(`${esc(t("errParse"))}<pre>${esc(r && r.raw)}</pre>`, source, openRequested);
  const n = clampScore(r.clickbait_score);
  const col = scoreColor(n);
  const kp = Array.isArray(r.key_points) && r.key_points.length
    ? `<div class="lbl">${esc(t("labelKeyPoints"))}</div><ul>${r.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  const sig = Array.isArray(r.clickbait_signals) && r.clickbait_signals.length
    ? `<div class="lbl">${esc(t("labelBaitSignals"))}</div><ul>${r.clickbait_signals.map((s) => `<li>⚑ ${esc(s)}</li>`).join("")}</ul>` : "";
  render(`
    <div class="lbl">${esc(t("labelOriginal"))}</div>
    <div class="orig">${esc(a.originalTitle)}</div>
    <div class="lbl">${esc(t("labelHonest"))}</div>
    <div class="title">${esc(r.honest_title)}</div>
    <div class="bar"><i style="width:${n}%;background:${col}"></i></div>
    <div class="meta"><b style="color:${col}">${n}/100 ${esc(t("metaClickbait"))}</b> · ${esc(verdict(r.substance_verdict))} · ${esc(t("metaWorth"))} <b>${r.worth_clicking ? t("yes") : t("no")}</b></div>
    <div class="lbl">${esc(t("labelSummary"))}</div>
    <div class="sum">${esc(r.summary)}</div>
    ${kp}${sig}
  `, source, openRequested);
}

async function run() {
  const source = safeSourceUrl(location.href);
  const requestRun = ++panelRun;
  render(esc(t("panelReading")), source, false);
  try {
    const article = extractPage();
    const { language, customInstructions } = await chrome.storage.sync.get({ language: "", customInstructions: "" });
    if (requestRun !== panelRun) return;
    const prompt = globalThis.DebaitPrompt.buildPrompt(article, { language, customInstructions });
    const resp = await chrome.runtime.sendMessage({ type: "debait:complete", prompt });
    if (requestRun !== panelRun) return;
    if (!resp?.ok) return render(`<b style="color:#e5484d">${esc(t("errGeneric"))}</b><br><br>${esc(resp?.error || t("errUnknown"))}`, source, false);
    renderResult(article, globalThis.DebaitPrompt.parseResult(resp.text), source, false);
  } catch (e) {
    if (requestRun !== panelRun) return;
    render(`<b style="color:#e5484d">${esc(t("errGeneric"))}</b><br><br>${esc(e?.message || String(e))}`, source, false);
  }
}

// Explicit link action keeps its result in the normal dismissible panel rather
// than a hover tooltip (which disappears when the mouse moves).
async function runLink(url) {
  const source = safeSourceUrl(url);
  const requestRun = ++panelRun;
  render(esc(t("panelReading")), source, true);
  try {
    const target = new URL(url);
    if (!["https:", "http:"].includes(target.protocol)) throw new Error(t("linkInvalid"));
    const resp = await chrome.runtime.sendMessage({ type: "debait:preview", url: target.href });
    if (requestRun !== panelRun) return;
    if (!resp?.ok) throw new Error(resp?.error || t("errUnknown"));
    const r = resp.result;
    if (!r || typeof r !== "object") throw new Error(t("errParse"));
    if (r.setup_required) return render(`<b style="color:#58a6ff">${esc(t("tipSetupHeading"))}</b><div style="margin-top:4px">${esc(t("tipSetupBody"))}</div>`, source, true);
    if (r.stale) return render(esc(t("errStale")), source, true);
    if (r.capped) return render(esc(t("tipCapped", [String(r.used), String(r.cap)])), source, true);
    if (r.rate_limited) return render(esc(t("linkRateLimited", [String(r.retryIn)])), source, true);
    if (r.throttled) return render(esc(t("linkThrottled")), source, true);
    if (r.thin_fetch) return render(`${esc(t("tipThin"))}<p>${esc(r.description || r.originalTitle || "")}</p>`, source, true);
    renderResult({ originalTitle: r.originalTitle || target.href }, r, source, true);
  } catch (e) {
    if (requestRun !== panelRun) return;
    render(`<b style="color:#e5484d">${esc(t("errGeneric"))}</b><br><br>${esc(e?.message || String(e))}`, source, true);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "debait:run") run();
  if (msg?.type === "debait:runLink") runLink(msg.url);
});
