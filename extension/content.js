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

// ---- Alt+hover link preview (debait BEFORE you click) ---------------------
// Hold Alt and hover a link; after a short dwell we fetch+debait the target in
// the background worker (cached) and show a tooltip with the honest title +
// clickbait score. Opt-in via Alt so we never fire LLM calls accidentally.
const TIP_ID = "debait-tooltip";
let tipTimer = null;
let dwellMs = 500; // overridable via Options (previewDwellMs)
const toDwell = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 500; };
chrome.storage.sync.get({ previewDwellMs: 500 }).then((v) => { dwellMs = toDwell(v.previewDwellMs); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.previewDwellMs) dwellMs = toDwell(changes.previewDwellMs.newValue);
  if (area === "sync" && changes.uiLang) globalThis.DebaitI18n.init();
});
let tipAnchor = null;

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
  let host = document.getElementById(TIP_ID);
  if (host && host.__content) return host.__content;
  host = document.createElement("div");
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
function hideTip() { tipAnchor = null; clearTimeout(tipTimer); document.getElementById(TIP_ID)?.remove(); }
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

async function previewLink(a, x, y) {
  const url = a.href;
  placeTip(x, y);
  tip().innerHTML = `<b style="color:#58a6ff">🪝🚫 ${t("brand")}</b> · ${t("tipReading")}<br><span style="color:#888">${esc(url).slice(0, 80)}</span>`;
  let resp;
  try { resp = await chrome.runtime.sendMessage({ type: "debait:preview", url }); }
  catch (e) { if (tipAnchor === a) tip().innerHTML = `<b style="color:#e5484d">${t("errGeneric")}</b> · ${esc(e?.message || String(e))}`; return; }
  if (tipAnchor !== a) return; // user moved on
  if (!resp?.ok) return void (tip().innerHTML = `<b style="color:#e5484d">${t("errGeneric")}</b> · ${esc(resp?.error || t("errUnknown"))}`);
  const r = resp.result;
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

document.addEventListener("mouseover", (e) => {
  if (!e.altKey) return;
  const a = e.target.closest?.("a[href]");
  if (!isPreviewable(a)) return;
  tipAnchor = a;
  clearTimeout(tipTimer);
  const { clientX: x, clientY: y } = e;
  tipTimer = setTimeout(() => previewLink(a, x, y), dwellMs);
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest?.("a[href]") === tipAnchor) { clearTimeout(tipTimer); tipAnchor = null; hideTip(); }
});
window.addEventListener("keyup", (e) => { if (e.key === "Alt") { clearTimeout(tipTimer); hideTip(); } });
window.addEventListener("scroll", hideTip, { passive: true });

const PANEL_ID = "debait-panel-host";
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

let panelHost = null;
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
