# debait — userscript (Tampermonkey / Violentmonkey)

A single-file version that works in any userscript manager. Adds a floating 🪝🚫
button; click it to analyze the current article.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`debait.user.js`](./debait.user.js) in GitHub → **Raw** → your userscript
   manager will offer to install it. (Or create a new script and paste the contents.)
3. Open the Tampermonkey menu → **debait: set OpenAI API key** and paste your key.
4. Visit any article and click the floating 🪝🚫 button (or use the menu command).

## Notes

- Uses `GM_xmlhttpRequest` to call `api.openai.com` (bypasses page CORS). The
  `@connect api.openai.com` grant scopes this; change it if you use a custom base.
- The key is stored locally via `GM_setValue` in your userscript manager.
- Like the extension, it only reads the **current** page.
