# debait — Chromium extension (MV3)

Adds a toolbar button + right-click "debait this page" that reads the current
article and overlays an honest title, summary, key points, and a clickbait score.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Open the extension's **Options**, pick a **provider** (OpenAI, Anthropic,
   Gemini, Groq, OpenRouter, DeepSeek, xAI, Mistral, Together, NVIDIA, or local Ollama),
   paste that provider's API key (optionally override base URL / model), and Save.
   Keys are remembered per provider, so you can switch freely.
5. Visit any article → click the toolbar icon or right-click → *debait this page*.

## Preview before you click (Alt+hover)

Hold **Alt** and hover any link. After a short dwell, the background worker
**fetches that target URL, extracts it, and debaits it** — showing a tooltip with
the honest title, clickbait score, substance verdict, *worth clicking*, and a
summary, **before you open the page**. Results are cached per URL (30 min) so
re-hovering is instant and each link costs at most one LLM call.

**Limitations (by design):**
- Only works on **server-rendered** pages. JS-rendered or paywalled targets can't
  be read by a plain fetch → the tooltip says "couldn't read body" and falls back
  to the link's meta description.
- Needs broad host access (`https://*/*`) so the worker can fetch arbitrary link
  targets — that's why the extension asks to "read data on all websites."
- Alt-gated on purpose: auto-debaiting *every* link in a feed would mean one LLM
  call per link (slow + costly + rate-limited). Hover = bounded, on-demand cost.
  For true whole-feed annotation you'd want a caching backend proxy (see repo NOTES).

**Cost & rate limiting.** Each *new* link you dwell on = 1 target fetch + 1 LLM
call (cached 30 min; thin/paywalled pages make 0 LLM calls). To avoid blowing
provider quotas (esp. free tiers that allow only ~10-15 req/min), previews are
throttled: one at a time, min 1.5s apart, and after a `429` the extension backs
off (respecting the provider's retry delay) and shows a cooldown message instead
of hammering the API.

## How it works

```
content.js     — extract current page (DOM), overlay panel, Alt+hover tooltip
prompt.js      — shared prompt/parse for content script (globalThis.DebaitPrompt)
prompt.esm.js  — same logic as an ES module for the service worker (synced)
extract.js     — pure HTML→text extractor for the worker (synced; no DOM needed)
providers.js   — multi-provider request builder (synced from ../shared)
background.js  — settings, CORS-free API call, + link preview (fetch+extract+cache)
popup/options  — trigger + provider/key settings (chrome.storage.sync)
```

Synced files come from `../shared/*` via `npm run sync` — edit the shared copy, not these.

`host_permissions` covers all built-in provider API hosts. If you point a provider
at a custom base URL, Chrome may prompt for that host (covered by `optional_host_permissions`).

Content scripts can't call arbitrary APIs (page CORS), so the actual LLM request
runs in the background service worker, which has `host_permissions`.

## Limitations

- Analyzes the **current** page's DOM, plus **Alt+hover previews** of individual
  linked targets (see above). Auto-annotating *every* link in a feed is out of
  scope — one LLM call per link (cost + rate limits); a caching backend proxy
  would be the way to do that.
- Preview works on **server-rendered** pages only; JS-rendered/paywalled targets
  fall back to the link's meta description.
- Needs your own API key; article text is sent only to the provider you configure.
  Keys are stored in `chrome.storage.sync` (synced to your browser profile).
- Branded icons are bundled in `extension/icons/` and declared in the manifest.

## Packaging for distribution

Branded icons live in `extension/icons/` and are declared in the manifest
(`icons` + `action.default_icon`). To build a publishable zip:

```bash
npm run pack   # -> dist/debait-extension-v<version>.zip
```

`pack` re-syncs the shared modules first, then writes a dependency-free zip
(Node `zlib`). Load it unpacked for testing, or upload the zip to the Chrome Web
Store / Edge Add-ons.
