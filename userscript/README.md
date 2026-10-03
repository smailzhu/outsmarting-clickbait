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

## Notes

- Supports the same providers as the CLI/extension.
- Uses `GM_xmlhttpRequest` (bypasses page CORS); the `@connect` grants list each
  provider host — add your own if you use a custom base URL.
- Keys are stored locally per provider via `GM_setValue`.
- Anthropic is called with `anthropic-dangerous-direct-browser-access: true`.
- Like the extension, it only reads the **current** page.
