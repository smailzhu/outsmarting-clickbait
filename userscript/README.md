# debait — userscript (Tampermonkey / Violentmonkey)

A single-file version that works in any userscript manager. Adds a floating 🪝🚫
button; click it to analyze the current article.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`debait.user.js`](./debait.user.js) in GitHub → **Raw** → your userscript
   manager will offer to install it. (Or create a new script and paste the contents.)
3. Open the Tampermonkey menu and set up a provider:
   - **debait: choose provider** (openai, anthropic, gemini, groq, openrouter,
     deepseek, xai, mistral, together, ollama)
   - **debait: set API key (current provider)**
   - optionally **set model / base URL override**
4. Visit any article and click the floating 🪝🚫 button (or use the menu command).

## Preview before you click (Alt+hover)

Hold **Alt** and hover any link. After a short dwell, the script **fetches that
target URL** (via `GM_xmlhttpRequest`, cross-origin), extracts and debaits it, and
shows a tooltip with the honest title, clickbait score, verdict, *worth clicking*,
and summary — before you open the page. Cached per URL (30 min).

- All **provider API hosts** are declared with explicit `@connect` tags, so the
  debait calls themselves trigger **no connect dialog**.
- **Preview** fetches whatever link you hover — arbitrary hosts that can't be
  pre-listed — so it needs the wildcard `@connect *`. Tampermonkey shows a
  one-time "connect to any domain" prompt for `*` by design; that's the only
  dialog, and it can't be narrowed without dropping preview.
  *If you don't want the wildcard:* delete the `// @connect *` line (and the
  Alt+hover preview block) to keep only current-page debaiting, or replace `*`
  with explicit `@connect <host>` tags for the sites you actually browse.
- Server-rendered pages only; JS-rendered/paywalled targets fall back to the
  link's meta description.
- Alt-gated on purpose so it never fires LLM calls accidentally.

## Notes

- Supports the same providers as the CLI/extension.
- Uses `GM_xmlhttpRequest` (bypasses page CORS); the `@connect` grants list each
  provider host — add your own if you use a custom base URL.
- Keys are stored locally per provider via `GM_setValue`.
- Anthropic is called with `anthropic-dangerous-direct-browser-access: true`.
- Click the floating button to debait the **current** page; Alt+hover to preview **other** pages.
