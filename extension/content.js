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

const PANEL_ID = "debait-panel";
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const scoreColor = (n) => (n >= 60 ? "#e5484d" : n >= 30 ? "#ffb224" : "#30a46c");

function panel() {
  let el = document.getElementById(PANEL_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = PANEL_ID;
  el.style.cssText = [
    "position:fixed", "z-index:2147483647", "top:16px", "right:16px", "width:360px",
    "max-height:80vh", "overflow:auto", "background:#0f1115", "color:#e6e6e6",
    "font:13px/1.5 system-ui,sans-serif", "border:1px solid #2a2f3a",
    "border-radius:12px", "box-shadow:0 8px 30px rgba(0,0,0,.5)", "padding:14px",
  ].join(";");
  document.body.appendChild(el);
  return el;
}
const render = (html) => { panel().innerHTML = html; };

function renderResult(a, r) {
  if (!r || r.parse_error) return render(`<b>debait</b><br>Could not parse model output.<pre style="white-space:pre-wrap">${esc(r && r.raw)}</pre>`);
  const n = r.clickbait_score ?? 0;
  render(`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <b style="color:#58a6ff">🪝🚫 debait</b>
      <span id="debait-close" style="cursor:pointer;color:#888">✕</span>
    </div>
    <div style="color:#888;font-size:11px">ORIGINAL</div>
    <div style="margin-bottom:8px">${esc(a.originalTitle)}</div>
    <div style="color:#888;font-size:11px">HONEST TITLE</div>
    <div style="font-weight:600;margin-bottom:10px">${esc(r.honest_title)}</div>
    <div style="height:8px;background:#222;border-radius:4px;overflow:hidden;margin-bottom:4px">
      <div style="height:100%;width:${n}%;background:${scoreColor(n)}"></div>
    </div>
    <div style="margin-bottom:10px"><b style="color:${scoreColor(n)}">${n}/100 clickbait</b>
      · ${esc(r.substance_verdict)} · worth clicking: <b>${r.worth_clicking ? "yes" : "no"}</b></div>
    <div style="color:#888;font-size:11px">SUMMARY</div>
    <div style="margin-bottom:10px">${esc(r.summary)}</div>
    ${Array.isArray(r.key_points) && r.key_points.length ? `<div style="color:#888;font-size:11px">KEY POINTS</div><ul style="margin:4px 0 10px;padding-left:18px">${r.key_points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${Array.isArray(r.clickbait_signals) && r.clickbait_signals.length ? `<div style="color:#888;font-size:11px">BAIT SIGNALS</div><ul style="margin:4px 0 0;padding-left:18px">${r.clickbait_signals.map((s) => `<li>⚑ ${esc(s)}</li>`).join("")}</ul>` : ""}
  `);
  document.getElementById("debait-close")?.addEventListener("click", () => document.getElementById(PANEL_ID)?.remove());
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
