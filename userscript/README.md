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

- Named native-provider hosts are declared with explicit `@connect` tags.
  Permission prompts depend on your manager, its version and settings; neither
  an absence of prompts nor a one-time-only confirmation is guaranteed.
- Preview fetches arbitrary hovered targets using `GM_xmlhttpRequest`, hence
  `@connect *`. To narrow access, replace it with explicit hosts you want to
  preview; other targets may be blocked or require approval. Remove the wildcard
  and preview code if you want current-page analysis only.
- Target JavaScript is not executed. If extracted text is under 200 characters,
  the preview shows target metadata/title instead of an AI assessment. HTTP or
  network failures show errors; paywalls/JS pages do not invariably trigger a
  metadata fallback.
- Alt makes previews deliberate, but does not guarantee against unintended
  requests. A canceled or already-dispatched request may still use quota.

## Notes

- Native providers use GM transport; custom has the isolated Fetch restrictions above.
- Native calls use `GM_xmlhttpRequest` with manager-dependent cross-origin access;
  custom uses direct Fetch, requires endpoint CORS, and does not use `@connect`
  as a CORS bypass. It is restricted to the documented Tampermonkey/Chromium
  isolated environment; unsupported managers fail closed for custom requests.
- Key/base/model profiles are stored locally per provider via `GM_setValue`.
- Anthropic is called with `anthropic-dangerous-direct-browser-access: true`.
- Click the floating button to debait the **current** page; Alt+hover to preview **other** pages.
