# debait — userscript (Tampermonkey / Violentmonkey)

> **New in v0.3.0 (GitHub/source release; store rollout is separate):** Custom / OpenAI-compatible
> requires an explicit base URL and model; key optional. Keyless remote HTTP
> sends article content and prompts **UNENCRYPTED**. Trust the endpoint operator.
> See the [custom setup, security and userscript compatibility guide](../docs/custom-provider.md).
> Userscript custom is limited to Tampermonkey ≥4.18 on Chromium with the
> DOM-isolated sandbox and CORS-compatible direct Fetch; no GM/page fallback.


A single-file version with native GM providers and a restricted custom Fetch
transport. No unconditional any-manager/browser support is claimed. Adds a floating 🪝🚫
button; click it to analyze the current article.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`debait.user.js`](./debait.user.js) in GitHub → **Raw** → your userscript
   manager will offer to install it. (Or create a new script and paste the contents.)
3. Open the Tampermonkey menu and set up a provider:
   - **debait: choose provider** (openai, anthropic, gemini, groq, openrouter,
     deepseek, xai, mistral, together, nvidia, ollama, custom)
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

- Native providers use GM transport; custom has the isolated Fetch restrictions above.
- Native calls use `GM_xmlhttpRequest` (bypasses page CORS); custom uses direct Fetch,
  which requires endpoint CORS and does not use `@connect` as a bypass. the `@connect` grants list each
  provider host — add your own if you use a custom base URL.
- Key/base/model profiles are stored locally per provider via `GM_setValue`.
- Anthropic is called with `anthropic-dangerous-direct-browser-access: true`.
- Click the floating button to debait the **current** page; Alt+hover to preview **other** pages.
