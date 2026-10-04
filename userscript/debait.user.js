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
// @connect      *
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
    gemini:     { format: "gemini",    base: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-flash-latest" },
    groq:       { format: "openai",    base: "https://api.groq.com/openai/v1",         model: "llama-3.3-70b-versatile" },
    openrouter: { format: "openai",    base: "https://openrouter.ai/api/v1",           model: "openai/gpt-4o-mini" },
    deepseek:   { format: "openai",    base: "https://api.deepseek.com/v1",            model: "deepseek-chat" },
    xai:        { format: "openai",    base: "https://api.x.ai/v1",                    model: "grok-3" },
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
    get language() { return GM_getValue("language", ""); },
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
  GM_registerMenuCommand("debait: set output language", () => {
    const l = prompt("Output language for title/summary (blank = auto, match article):\ne.g. English, \u7e41\u9ad4\u4e2d\u6587, \u65e5\u672c\u8a9e, Espa\u00f1ol", CFG.language);
    if (l !== null) GM_setValue("language", l.trim());
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
  function buildPrompt({ originalTitle, description, text, url }, { language } = {}) {
    const body = (text || "").slice(0, MAX_CHARS);
    const l = String(language || "").trim();
    const langTarget = !l || l.toLowerCase() === "auto" ? "the same language as the article" : l;
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
- Write "honest_title", "summary", "key_points" and "clickbait_signals" in ${langTarget}. Keep the JSON keys and the "substance_verdict" value in English.

URL: ${url || "(unknown)"}
ORIGINAL TITLE: ${originalTitle || "(none)"}
META DESCRIPTION: ${description || "(none)"}

ARTICLE TEXT:
"""
${body || "(no extractable text — the page may be JS-rendered or paywalled)"}
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
    const headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = `Bearer ${key}`; // omit for keyless (local Ollama)
    return {
      url: `${base}/chat/completions`,
      headers,
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
        timeout: 60000,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) return reject(new Error(`API ${r.status}: ${r.responseText.slice(0, 300)}`));
          try { resolve(req.pick(JSON.parse(r.responseText))); }
          catch (e) { reject(e); }
        },
        onerror: () => reject(new Error("Network error calling the API.")),
        ontimeout: () => reject(new Error("Request timed out.")),
      });
    });
  }

  // ---- UI -------------------------------------------------------------------
  const PANEL_ID = "debait-panel-host";
  function scoreColor(n) { return n >= 60 ? "#ff6b6e" : n >= 30 ? "#ffc14d" : "#4ac97e"; }
  // Model output is untrusted: coerce the score to a finite int in [0,100] so it
  // cannot inject markup via the style attribute or text.
  function clampScore(v) { let n; try { n = Math.round(Number(v)); } catch { return 0; } return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }

  // All panel styles live inside a Shadow DOM so the host page's CSS can't bleed
  // in (the usual cause of unreadable overlays). :host all:initial resets
  // inherited color/font/letter-spacing/etc.
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

  function closePanel() { document.getElementById(PANEL_ID)?.remove(); }
  function render(html) {
    panel().innerHTML = html;
    document.getElementById(PANEL_ID)?.shadowRoot?.querySelector(".x")?.addEventListener("click", closePanel);
  }
  function hd() { return `<div class="hd"><span class="brand">🪝🚫 debait</span><span class="x" title="close">✕</span></div>`; }
  function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  function renderResult(a, r) {
    if (r.parse_error) return render(`${hd()}Could not parse model output.<pre>${esc(r.raw)}</pre>`);
    const n = clampScore(r.clickbait_score);
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
      const out = await callProvider(buildPrompt(article, { language: CFG.language }));
      renderResult(article, parseResult(out));
    } catch (e) {
      render(`<b style="color:#e5484d">debait error</b><br><br>${esc(e.message)}`);
    }
  }

  // ---- Alt+hover link preview (debait BEFORE you click) ---------------------
  // GM_xmlhttpRequest fetches the target cross-origin (no CORS); we parse it with
  // DOMParser (scripts not executed), debait it, and show a tooltip. Alt-gated so
  // we never fire LLM calls accidentally. Cached per URL (30 min).
  const TIP_ID = "debait-tooltip";
  const previewCache = new Map();
  const PREVIEW_TTL = 30 * 60 * 1000;
  // Rate limiting so bursty hovering can't exceed provider quota (free tiers).
  const PREVIEW_MIN_INTERVAL = 1500;
  let previewBusy = false, lastPreviewAt = 0, cooldownUntil = 0;
  function backoffMsFrom(message) {
    const m = /ret[-_ ]?(?:delay|after)"?\s*[:=]\s*"?(\d+)\s*s?/i.exec(String(message || ""));
    const secs = m ? Number(m[1]) : 0;
    return Math.min(Math.max(secs * 1000 || 30000, 5000), 5 * 60 * 1000);
  }
  let tipTimer = null, tipAnchor = null;

  function tip() {
    let el = document.getElementById(TIP_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = TIP_ID;
    el.style.cssText = [
      "position:fixed", "z-index:2147483647", "max-width:320px", "background:#0f1115",
      "color:#e6e6e6", "font:12px/1.45 system-ui,sans-serif", "border:1px solid #2a2f3a",
      "border-radius:10px", "box-shadow:0 6px 24px rgba(0,0,0,.5)", "padding:10px", "pointer-events:none",
    ].join(";");
    document.body.appendChild(el);
    return el;
  }
  function hideTip() { tipAnchor = null; clearTimeout(tipTimer); document.getElementById(TIP_ID)?.remove(); }
  function placeTip(x, y) {
    const el = tip();
    el.style.left = Math.min(x + 14, window.innerWidth - 340) + "px";
    el.style.top = Math.min(y + 14, window.innerHeight - 160) + "px";
  }

  function extractHtmlString(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const meta = (sel) => doc.querySelector(sel)?.content?.trim() || "";
    const originalTitle = meta('meta[property="og:title"]') || doc.querySelector("title")?.textContent?.trim() || "";
    const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
    const root = doc.querySelector("article") || doc.querySelector("main") || doc.body;
    if (root) root.querySelectorAll("script,style,noscript,nav,aside,footer,header,form").forEach((n) => n.remove());
    const text = (root?.textContent || "").replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { originalTitle, description, text, url };
  }

  function fetchTarget(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET", url, timeout: 15000, anonymous: true,
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`))),
        onerror: () => reject(new Error("fetch failed")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  async function previewLink(a, x, y) {
    const url = a.href;
    // Cache per URL *and* settings so changing provider/model/language refreshes.
    const cacheKey = [url, CFG.provider, CFG.model, CFG.base, CFG.language].join("\n");
    placeTip(x, y);
    tip().innerHTML = `<b style="color:#58a6ff">🪝🚫 debait</b> \u00b7 reading\u2026<br><span style="color:#888">${esc(url).slice(0, 80)}</span>`;
    try {
      let result;
      const hit = previewCache.get(cacheKey);
      if (hit && Date.now() - hit.at < PREVIEW_TTL) {
        result = hit.result;
      } else {
        const nowC = Date.now();
        if (nowC < cooldownUntil) {
          result = { rate_limited: true, retryIn: Math.ceil((cooldownUntil - nowC) / 1000) };
        } else {
          const article = extractHtmlString(await fetchTarget(url), url);
          if (!article.text || article.text.length < 200) {
            result = { thin_fetch: true, originalTitle: article.originalTitle, description: article.description };
          } else if (previewBusy || Date.now() - lastPreviewAt < PREVIEW_MIN_INTERVAL) {
            result = { throttled: true, originalTitle: article.originalTitle };
          } else {
            previewBusy = true; lastPreviewAt = Date.now();
            try {
              result = parseResult(await callProvider(buildPrompt(article, { language: CFG.language })));
              result.originalTitle = article.originalTitle;
            } catch (e) {
              if (/\b429\b|quota|rate|RESOURCE_EXHAUSTED/i.test(String(e && e.message))) cooldownUntil = Date.now() + backoffMsFrom(e.message);
              throw e;
            } finally { previewBusy = false; }
          }
        }
        // Only cache real answers - not transient throttle/cooldown markers.
        if (!result.throttled && !result.rate_limited) previewCache.set(cacheKey, { at: Date.now(), result });
      }
      if (tipAnchor !== a) return;
      if (result.rate_limited)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 debait</b> \u00b7 rate limited by provider. Cooling down ~${result.retryIn}s (hover again later).`);
      if (result.throttled)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 debait</b> \u00b7 slow down \u2014 hover one link at a time. Try again in a moment.`);
      if (result.thin_fetch)
        return void (tip().innerHTML = `<b style="color:#ffb224">🪝🚫 debait</b> \u00b7 couldn't read body (JS-rendered/paywalled).<br>${esc(result.description || result.originalTitle || "")}`);
      const n = clampScore(result.clickbait_score);
      tip().innerHTML = `
        <b style="color:#58a6ff">🪝🚫 ${esc(result.honest_title || "")}</b>
        <div style="height:6px;background:#222;border-radius:3px;overflow:hidden;margin:6px 0 4px">
          <div style="height:100%;width:${n}%;background:${scoreColor(n)}"></div></div>
        <div><b style="color:${scoreColor(n)}">${n}/100</b> \u00b7 ${esc(result.substance_verdict || "")} \u00b7 worth clicking: <b>${result.worth_clicking ? "yes" : "no"}</b></div>
        <div style="color:#bbb;margin-top:4px">${esc(result.summary || "")}</div>`;
    } catch (e) {
      if (tipAnchor === a) tip().innerHTML = `<b style="color:#e5484d">debait</b> \u00b7 ${esc(e.message)}`;
    }
  }

  function isPreviewable(a) {
    if (!a || !a.href || !/^https?:$/.test(a.protocol)) return false;
    return a.href.split("#")[0] !== location.href.split("#")[0];
  }

  document.addEventListener("mouseover", (e) => {
    if (!e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!isPreviewable(a)) return;
    tipAnchor = a;
    clearTimeout(tipTimer);
    const { clientX: x, clientY: y } = e;
    tipTimer = setTimeout(() => previewLink(a, x, y), 500);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest?.("a[href]") === tipAnchor) { clearTimeout(tipTimer); tipAnchor = null; hideTip(); }
  });
  window.addEventListener("keyup", (e) => { if (e.key === "Alt") { clearTimeout(tipTimer); hideTip(); } });
  window.addEventListener("scroll", hideTip, { passive: true });

  addButton();
})();
