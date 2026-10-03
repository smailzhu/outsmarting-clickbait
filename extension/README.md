# debait — Chromium extension (MV3)

Adds a toolbar button + right-click "debait this page" that reads the current
article and overlays an honest title, summary, key points, and a clickbait score.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. Open the extension's **Options**, paste your OpenAI API key (and optionally a
   custom base URL / model), and Save.
5. Visit any article → click the toolbar icon or right-click → *debait this page*.

## How it works

```
content.js  — extracts the article from the live DOM, renders the overlay
prompt.js   — shared prompt/parse logic (globalThis.DebaitPrompt)
background.js — holds settings, makes the CORS-free API call (service worker)
popup/options — trigger + API-key settings (chrome.storage.sync)
```

Content scripts can't call arbitrary APIs (page CORS), so the actual LLM request
runs in the background service worker, which has `host_permissions`.

## Limitations

- Only analyzes the **current** page's DOM. Annotating every link in a feed would
  require fetching each target URL (CORS + JS-rendering + cost) — out of scope
  for this prototype.
- Needs your own API key; nothing is sent anywhere except your configured endpoint.
- No bundled icons — Chrome shows a default icon (add `icons` to the manifest to customize).
