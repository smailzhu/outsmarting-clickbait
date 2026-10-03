# debait — Chromium extension (MV3)

Adds a toolbar button + right-click "debait this page" that reads the current
article and overlays an honest title, summary, key points, and a clickbait score.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Open the extension's **Options**, pick a **provider** (OpenAI, Anthropic,
   Gemini, Groq, OpenRouter, DeepSeek, xAI, Mistral, Together, or local Ollama),
   paste that provider's API key (optionally override base URL / model), and Save.
   Keys are remembered per provider, so you can switch freely.
5. Visit any article → click the toolbar icon or right-click → *debait this page*.

## How it works

```
content.js   — extracts the article from the live DOM, renders the overlay
prompt.js    — shared prompt/parse logic (globalThis.DebaitPrompt)
providers.js — multi-provider request builder (synced from ../shared via `npm run sync`)
background.js — holds settings, makes the CORS-free API call (service worker)
popup/options — trigger + provider/key settings (chrome.storage.sync)
```

`host_permissions` covers all built-in provider API hosts. If you point a provider
at a custom base URL, Chrome may prompt for that host (covered by `optional_host_permissions`).

Content scripts can't call arbitrary APIs (page CORS), so the actual LLM request
runs in the background service worker, which has `host_permissions`.

## Limitations

- Only analyzes the **current** page's DOM. Annotating every link in a feed would
  require fetching each target URL (CORS + JS-rendering + cost) — out of scope
  for this prototype.
- Needs your own API key; nothing is sent anywhere except your configured endpoint.
- No bundled icons — Chrome shows a default icon (add `icons` to the manifest to customize).
