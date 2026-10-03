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
