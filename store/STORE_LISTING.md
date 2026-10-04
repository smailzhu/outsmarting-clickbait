# Chrome Web Store listing — debait

Copy/paste material for submitting the extension to the Chrome Web Store
(and Edge Add-ons / Firefox AMO, which have similar fields). Replace the
screenshot placeholders with real captures before publishing.

---

## Name
debait — outsmart clickbait

## Summary (≤ 132 chars)
Reads the article behind a link and shows an honest title, a summary, and a clickbait score — before you waste a click.

## Category
Productivity

## Language
English (the summaries themselves can be produced in any language you choose)

## Detailed description

Clickbait only works on humans. debait reads the page text (up to ~12,000 characters) with an AI model
and hands you the substance — a plain, non-sensational title, a short summary,
the key points, and a 0–100 clickbait score — so the bait loses its power.

Two ways to use it:
• Click the toolbar button (or right-click → “debait this page”) to debait the
  page you're on.
• Hold Alt and hover any link to preview its target BEFORE you click — honest
  title, score, and “worth clicking?” in a tooltip.

Bring your own API key. debait works with your choice of provider — OpenAI,
Anthropic (Claude), Google Gemini, Groq, OpenRouter, DeepSeek, xAI (Grok),
Mistral, Together, NVIDIA, or a local Ollama. Output can be in any language.

Built for cost control: the hover-preview feature is rate-limited, backs off
automatically on provider rate limits (HTTP 429), and respects a configurable
daily cap. (Clicking “Analyze this page” yourself is one call per click and is
not subject to the preview cap.)

Privacy-first: there is no debait server. Page text is sent only to the provider
you configure with your own key; your key and settings stay in your browser.
Open source: https://github.com/smailzhu/outsmarting-clickbait

## Single purpose (required field)
debait has a single purpose: to summarize a web article and rate how
clickbait-y it is, either for the current page or for a link the user hovers.

## Permission justifications

- **activeTab** — to read the text of the page you explicitly ask to debait and
  render the result overlay on it.
- **content script (host access)** — a content script runs on pages so it can
  detect Alt+hover and draw the overlay/tooltip; it acts only when you invoke it.
- **storage** — to save your provider, API key, language, and rate-limit/daily-cap
  settings, and to track the daily preview count.
- **contextMenus** — to add the “debait this page” right-click item.
- **host permissions `https://*/*`, `http://*/*`** — the hover-preview feature
  fetches the target page of the link you hover so it can be summarized before
  you click. The extension processes only pages you explicitly debait or hover;
  the selected page's URL and content are sent to your configured provider. It
  does not otherwise read or transmit your browsing.
- **host permissions for provider API domains** (api.openai.com, api.anthropic.com,
  generativelanguage.googleapis.com, api.groq.com, openrouter.ai,
  api.deepseek.com, api.x.ai, api.mistral.ai, api.together.xyz,
  integrate.api.nvidia.com, localhost) — to send the article text to the AI
  provider you configured and receive the summary.

## Data usage disclosures (Chrome “Privacy practices” tab)

- Does the extension collect user data? **Only to provide the feature, sent to a
  third-party AI provider the user configures.** No data is sent to the developer.
- Personally identifiable info: **No**
- Health info: **No**
- Financial info: **No**
- Authentication info: **The user's own AI provider API key, stored locally and
  sent only to that provider.**
- Personal communications / web history / location / user activity: **No**
- Website content: **Yes — the URL, title, meta description, and text of pages
  the user chooses to debait/preview, sent to the user-configured AI provider only.**
- Sold to third parties: **No**
- Used for purposes unrelated to the single purpose: **No**
- Used to determine creditworthiness / lending: **No**

## Privacy policy URL
https://github.com/smailzhu/outsmarting-clickbait/blob/master/PRIVACY.md

## Homepage / support
- Homepage: https://github.com/smailzhu/outsmarting-clickbait
- Support: https://github.com/smailzhu/outsmarting-clickbait/issues

## Assets checklist
- [x] Store icon 128×128 — `extension/icons/icon128.png`
- [x] Small promo tile 440×280 — `store/promo-tile-440x280.png`
- [x] Marquee promo 1400×560 — `store/promo-marquee-1400x560.png`
- [ ] At least one screenshot 1280×800 (or 640×400) — **capture from a real
      browser**: toolbar popup, a result panel on an article, and an Alt+hover
      tooltip. (`store/screenshot-mockup-1280x800.png` is a design mockup — replace
      it with a real capture before publishing.)

## Build the upload package
```bash
npm run pack   # -> dist/debait-extension-v<version>.zip  (upload this)
```
