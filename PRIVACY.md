# Privacy Policy — debait

_Last updated: 2025_

**debait** ("the extension") is an open-source tool that summarizes web articles
and rates how clickbait-y they are. This policy explains what it does and does
not do with your data.

## The short version

- There is **no debait server**. The developer operates no backend and receives
  **no data** from you whatsoever.
- The extension sends page text **only to the AI provider you choose and
  configure with your own API key** (e.g. OpenAI, Anthropic, Google Gemini,
  Groq, OpenRouter, DeepSeek, xAI, Mistral, Together, NVIDIA, or a local Ollama).
- Your API key and settings are stored by your browser via `chrome.storage.sync`,
  which may sync them across your own signed-in Chrome profile (Google
  infrastructure). They are never sent to the developer.

## What data is processed

| Data | Where it goes | Why |
|------|---------------|-----|
| The **URL**, **title**, **meta description**, and **visible text** (capped at ~12,000 characters) of a page you **debait** or **Alt+hover preview** | Sent directly from your browser to the **AI provider you configured** | So the model can summarize it and rate clickbait |
| Your **API key**, chosen **provider/model/language**, and **limits** | Stored in `chrome.storage.sync` (your browser; may sync across your own signed-in browsers) | To call the provider on your behalf and remember preferences |
| A per-day **count** of preview calls | Stored in `chrome.storage.local` (your device) | To enforce your daily cap |

The extension does **not** collect, transmit, sell, or share: browsing history,
personal identifiers, analytics, telemetry, or any data to the developer or any
third party other than the AI provider you explicitly configure.

## When network requests happen

- A request to an **AI provider** happens only when you click **Analyze this
  page**, use the **debait this page** context menu, or **Alt+hover** a link.
- To preview a link, the extension fetches **that link's target page** (the same
  page you were about to click). This uses broad host access
  (`https://*/*`, `http://*/*`) solely to retrieve the page you asked about; no
  other browsing is read or sent.

## Your controls

- Set, change, or remove your API key anytime in the extension **Options**.
- Set a **daily cap** (including `0` = unlimited) and rate limits in Options.
- Remove the extension to delete all stored settings.

## Limited Use

debait's use of information received from its features complies with the Chrome
Web Store **Limited Use** requirements: data is used only to provide the
user-facing summarization/clickbait-scoring feature, is transferred only to the
AI provider the user configures (never to the developer), is never sold, and is
never used for advertising, creditworthiness, or any unrelated purpose.

## Third-party providers

When you configure a provider, your use of that provider is governed by **its**
privacy policy and terms. Review the policy of whichever provider you enable.

## Contact

Questions or concerns: open an issue at
<https://github.com/smailzhu/outsmarting-clickbait/issues>.
