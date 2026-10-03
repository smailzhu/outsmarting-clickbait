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
let tipAnchor = null;

function tip() {
  let el = document.getElementById(TIP_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = TIP_ID;
  el.style.cssText = [
    "position:fixed", "z-index:2147483647", "max-width:320px", "background:#0f1115",
    "color:#e6e6e6", "font:12px/1.45 system-ui,sans-serif", "border:1px solid #2a2f3a",
    "border-radius:10px", "box-shadow:0 6px 24px rgba(0,0,0,.5)", "padding:10px",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  return el;
}
function hideTip() { document.getElementById(TIP_ID)?.remove(); }
function placeTip(x, y) {
  const el = tip();
  const pad = 14;
  el.style.left = Math.min(x + pad, window.innerWidth - 340) + "px";
  el.style.top = Math.min(y + pad, window.innerHeight - 160) + "px";
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
  tip().innerHTML = `<b style="color:#58a6ff">🪝🚫 debait</b> · reading…<br><span style="color:#888">${esc(url).slice(0, 80)}</span>`;
  const resp = await chrome.runtime.sendMessage({ type: "debait:preview", url });
  if (tipAnchor !== a) return; // user moved on
  if (!resp?.ok) return void (tip().innerHTML = `<b style="color:#e5484d">debait</b> · ${esc(resp?.error || "error")}`);
  const r = resp.result;
  if (r.thin_fetch)
    return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 debait</b> · couldn't read body (JS-rendered/paywalled).<br>${esc(r.description || r.originalTitle || "")}`);
  const n = r.clickbait_score ?? 0;
  tip().innerHTML = `
    <b style="color:#58a6ff">🪝🚫 ${esc(r.honest_title || "")}</b>
    <div style="height:6px;background:#222;border-radius:3px;overflow:hidden;margin:6px 0 4px">
      <div style="height:100%;width:${n}%;background:${scoreColor(n)}"></div></div>
    <div><b style="color:${scoreColor(n)}">${n}/100</b> · ${esc(r.substance_verdict || "")} · worth clicking: <b>${r.worth_clicking ? "yes" : "no"}</b></div>
    <div style="color:#bbb;margin-top:4px">${esc(r.summary || "")}</div>`;
}

document.addEventListener("mouseover", (e) => {
  if (!e.altKey) return;
  const a = e.target.closest?.("a[href]");
  if (!isPreviewable(a)) return;
  tipAnchor = a;
  clearTimeout(tipTimer);
  const { clientX: x, clientY: y } = e;
  tipTimer = setTimeout(() => previewLink(a, x, y), 350);
});
document.addEventListener("mouseout", (e) => {
  if (e.target.closest?.("a[href]") === tipAnchor) { clearTimeout(tipTimer); tipAnchor = null; hideTip(); }
});
window.addEventListener("keyup", (e) => { if (e.key === "Alt") { clearTimeout(tipTimer); hideTip(); } });
window.addEventListener("scroll", hideTip, { passive: true });

const PANEL_ID = "debait-panel-host";
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const scoreColor = (n) => (n >= 60 ? "#ff6b6e" : n >= 30 ? "#ffc14d" : "#4ac97e");

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
.x { cursor:pointer; color:#9aa4b2; font-size:16px; line-height:1; padding:2px 7px; border-radius:6px; }
.x:hover { background:#20262e; color:#fff; }
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

function panel() {
  let host = document.getElementById(PANEL_ID);
  if (host && host.__content) return host.__content;
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
  return content;
}
const closePanel = () => document.getElementById(PANEL_ID)?.remove();
const render = (html) => {
  panel().innerHTML = html;
  document.getElementById(PANEL_ID)?.shadowRoot?.querySelector(".x")?.addEventListener("click", closePanel);
};
const hd = () => `<div class="hd"><span class="brand">🪝🚫 debait</span><span class="x" title="close">✕</span></div>`;

function renderResult(a, r) {
  if (!r || r.parse_error) return render(`${hd()}Could not parse model output.<pre>${esc(r && r.raw)}</pre>`);
  const n = r.clickbait_score ?? 0;
  const col = scoreColor(n);
  const kp = Array.isArray(r.key_points) && r.key_points.length
    ? `<div class="lbl">Key points</div><ul>${r.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "";
  const sig = Array.isArray(r.clickbait_signals) && r.clickbait_signals.length
    ? `<div class="lbl">Bait signals</div><ul>${r.clickbait_signals.map((s) => `<li>⚑ ${esc(s)}</li>`).join("")}</ul>` : "";
  render(`
    ${hd()}
    <div class="lbl">Original</div>
    <div class="orig">${esc(a.originalTitle)}</div>
    <div class="lbl">Honest title</div>
    <div class="title">${esc(r.honest_title)}</div>
    <div class="bar"><i style="width:${n}%;background:${col}"></i></div>
    <div class="meta"><b style="color:${col}">${n}/100 clickbait</b> · ${esc(r.substance_verdict)} · worth clicking: <b>${r.worth_clicking ? "yes" : "no"}</b></div>
    <div class="lbl">Summary</div>
    <div class="sum">${esc(r.summary)}</div>
    ${kp}${sig}
  `);
}

async function run() {
  render(`<b style="color:#58a6ff">🪝🚫 debait</b><br><br>Reading the page…`);
  const article = extractPage();
  const prompt = globalThis.DebaitPrompt.buildPrompt(article);
  const resp = await chrome.runtime.sendMessage({ type: "debait:complete", prompt });
  if (!resp?.ok) return render(`<b style="color:#e5484d">debait error</b><br><br>${esc(resp?.error || "unknown")}`);
  renderResult(article, globalThis.DebaitPrompt.parseResult(resp.text));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "debait:run") run();
});
