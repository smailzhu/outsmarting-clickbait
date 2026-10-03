// ==UserScript==
// @name         debait — outsmart clickbait
// @namespace    https://github.com/smailzhu/outsmarting-clickbait
// @version      0.1.0
// @description  Reads the current article and shows an honest title, summary, and clickbait score. Inspired by wiwi.blog/blog/outsmarting-clickbait
// @author       smailzhu
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @connect      api.deepseek.com
// @connect      api.x.ai
// @connect      api.mistral.ai
// @connect      api.together.xyz
// @connect      integrate.api.nvidia.com
// @connect      localhost
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* global GM_xmlhttpRequest, GM_setValue, GM_getValue, GM_registerMenuCommand */
(function () {
  "use strict";

  // ---- providers ------------------------------------------------------------
  const SYSTEM = "You are a precise editor. Respond with exactly the requested format, nothing else.";
  const PROVIDERS = {
    openai:     { format: "openai",    base: "https://api.openai.com/v1",              model: "gpt-4o-mini" },
    anthropic:  { format: "anthropic", base: "https://api.anthropic.com/v1",           model: "claude-3-5-haiku-latest" },
    gemini:     { format: "gemini",    base: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-1.5-flash" },
    groq:       { format: "openai",    base: "https://api.groq.com/openai/v1",         model: "llama-3.3-70b-versatile" },
    openrouter: { format: "openai",    base: "https://openrouter.ai/api/v1",           model: "openai/gpt-4o-mini" },
    deepseek:   { format: "openai",    base: "https://api.deepseek.com/v1",            model: "deepseek-chat" },
    xai:        { format: "openai",    base: "https://api.x.ai/v1",                    model: "grok-2-latest" },
    mistral:    { format: "openai",    base: "https://api.mistral.ai/v1",              model: "mistral-small-latest" },
    together:   { format: "openai",    base: "https://api.together.xyz/v1",            model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    nvidia:     { format: "openai",    base: "https://integrate.api.nvidia.com/v1",    model: "meta/llama-3.3-70b-instruct" },
    ollama:     { format: "openai",    base: "http://localhost:11434/v1",              model: "llama3.1" },
  };

  // ---- config (stored via GM_setValue) --------------------------------------
  const CFG = {
    get provider() { return GM_getValue("provider", "openai"); },
    get key() { return GM_getValue(`key_${this.provider}`, ""); },
    get base() { return (GM_getValue("base", "") || PROVIDERS[this.provider].base).replace(/\/+$/, ""); },
    get model() { return GM_getValue("model", "") || PROVIDERS[this.provider].model; },
  };

  GM_registerMenuCommand("debait: choose provider", () => {
    const p = prompt(`Provider \u2014 one of:\n${Object.keys(PROVIDERS).join(", ")}`, CFG.provider);
    if (p !== null && PROVIDERS[p.trim()]) GM_setValue("provider", p.trim());
    else if (p !== null) alert("Unknown provider.");
  });
  GM_registerMenuCommand("debait: set API key (current provider)", () => {
    const k = prompt(`API key for "${CFG.provider}" (stored locally):`, CFG.key);
    if (k !== null) GM_setValue(`key_${CFG.provider}`, k.trim());
  });
  GM_registerMenuCommand("debait: set model override", () => {
    const m = prompt("Model (blank = provider default):", GM_getValue("model", ""));
    if (m !== null) GM_setValue("model", m.trim());
  });
  GM_registerMenuCommand("debait: set base URL override", () => {
    const b = prompt("Base URL (blank = provider default):", GM_getValue("base", ""));
    if (b !== null) GM_setValue("base", b.trim());
  });
  GM_registerMenuCommand("debait: analyze this page", run);

  // ---- shared prompt (inlined copy of shared/prompt.js) ---------------------
  const MAX_CHARS = 12000;
  function buildPrompt({ originalTitle, description, text, url }) {
    const body = (text || "").slice(0, MAX_CHARS);
    return `You are given a web article. Read it and report its actual substance,
ignoring any sensational framing. Judge it the way a skeptical editor would.

Respond with ONLY a JSON object (no markdown fences, no prose) of this shape:
{
  "honest_title": "a plain, accurate headline with no hype or curiosity gap",
  "summary": "2-4 sentences covering the real takeaways. If there is no real content, say so plainly.",
  "key_points": ["concrete point 1", "concrete point 2"],
  "clickbait_score": 0,
  "clickbait_signals": ["which manipulative techniques are used, if any"],
  "substance_verdict": "one of: substantial | thin | empty",
  "worth_clicking": true
}

Rules:
- clickbait_score is 0 (honest) to 100 (pure bait).
- "worth_clicking" is whether a reader learns anything beyond what your summary already tells them.
- Do not repeat false claims as fact; attribute them ("the article claims...").
- Be terse and dispassionate.

URL: ${url || "(unknown)"}
ORIGINAL TITLE: ${originalTitle || "(none)"}
META DESCRIPTION: ${description || "(none)"}

ARTICLE TEXT:
"""
${body || "(no extractable text)"}
"""`;
  }
  function parseResult(raw) {
    let s = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    try { return JSON.parse(s); } catch { return { parse_error: true, raw }; }
  }

  // ---- extract current page from the live DOM -------------------------------
  function extractPage() {
    const meta = (sel) => document.querySelector(sel)?.content?.trim() || "";
    const originalTitle =
      meta('meta[property="og:title"]') || document.title;
    const description =
      meta('meta[name="description"]') || meta('meta[property="og:description"]');
    const root =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script,style,noscript,nav,aside,footer,header,form").forEach((n) => n.remove());
    const text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return { originalTitle, description, text, url: location.href };
  }

  // ---- build request per wire format ----------------------------------------
  function buildRequest(prompt) {
    const format = PROVIDERS[CFG.provider].format;
    const { base, model, key } = CFG;
    if (format === "anthropic") {
      return {
        url: `${base}/messages`,
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        data: JSON.stringify({ model, max_tokens: 1024, temperature: 0.2, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
        pick: (j) => (j.content || []).map((p) => p.text || "").join(""),
      };
    }
    if (format === "gemini") {
      return {
        url: `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
        pick: (j) => (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join(""),
      };
    }
    return {
      url: `${base}/chat/completions`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      data: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
      pick: (j) => j.choices?.[0]?.message?.content || "",
    };
  }

  // ---- LLM call via GM_xmlhttpRequest (bypasses page CORS) -------------------
  function callProvider(prompt) {
    return new Promise((resolve, reject) => {
      if (!CFG.key && CFG.provider !== "ollama")
        return reject(new Error(`No API key for "${CFG.provider}". Use the menu to set it.`));
      const req = buildRequest(prompt);
      GM_xmlhttpRequest({
        method: "POST",
        url: req.url,
        headers: req.headers,
        data: req.data,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return reject(new Error(`API ${r.status}: ${r.responseText.slice(0, 300)}`));
          try { resolve(req.pick(JSON.parse(r.responseText))); }
          catch (e) { reject(e); }
        },
        onerror: () => reject(new Error("Network error calling the API.")),
      });
    });
  }

  // ---- UI -------------------------------------------------------------------
  const PANEL_ID = "debait-panel";
  function scoreColor(n) { return n >= 60 ? "#e5484d" : n >= 30 ? "#ffb224" : "#30a46c"; }

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

  function render(html) { panel().innerHTML = html; }
  function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function renderResult(a, r) {
    if (r.parse_error) return render(`<b>debait</b><br>Could not parse model output.<pre style="white-space:pre-wrap">${esc(r.raw)}</pre>`);
    const n = r.clickbait_score ?? 0;
    render(`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b style="color:#58a6ff">🪝🚫 debait</b>
        <span style="cursor:pointer;color:#888" onclick="document.getElementById('${PANEL_ID}').remove()">✕</span>
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
  }

  // floating launcher button
  function addButton() {
    if (document.getElementById("debait-btn")) return;
    const b = document.createElement("button");
    b.id = "debait-btn";
    b.textContent = "🪝🚫";
    b.title = "debait this page";
    b.style.cssText = "position:fixed;z-index:2147483646;bottom:18px;right:18px;width:44px;height:44px;border-radius:50%;border:none;background:#58a6ff;color:#001;font-size:18px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.4)";
    b.onclick = run;
    document.body.appendChild(b);
  }

  async function run() {
    render(`<b style="color:#58a6ff">🪝🚫 debait</b><br><br>Reading the page…`);
    try {
      const article = extractPage();
      const out = await callProvider(buildPrompt(article));
      renderResult(article, parseResult(out));
    } catch (e) {
      render(`<b style="color:#e5484d">debait error</b><br><br>${esc(e.message)}`);
    }
  }

  addButton();
})();
