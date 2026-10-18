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
Tools

## Language
English is the default store listing; Chinese (Traditional), `zh-TW`, is the localized listing.
The in-app interface language and AI output language are separate settings.
Taiwanese Hokkien (Han-Lo) copy is provided as a draft for other channels; do not
assume the Chrome Web Store dashboard offers a Taiwanese listing-language slot.

## Detailed description

Copy the complete contents of **[descriptions/en.txt](descriptions/en.txt)** into
the English detailed-description field. That plain-text file is the source of
truth; it includes setup requirements, features, limitations, and privacy details.

Descriptions for every currently supported interface language:
- **English:** [descriptions/en.txt](descriptions/en.txt)
- **繁體中文:** [descriptions/zh-TW.txt](descriptions/zh-TW.txt)
- **台語（漢羅）, translation draft:** [descriptions/nan-Hanlo.txt](descriptions/nan-Hanlo.txt)

See [descriptions/README.md](descriptions/README.md) for copying instructions and
the distinction between a store-listing locale and an in-app interface language.
Avoid duplicating the full descriptions here so future edits cannot leave a stale
second copy.

## Single purpose (required field)
debait has a single purpose: to summarize a web article and rate how
clickbait-y it is, either for the current page or for a link the user hovers.

## Permission justifications

The extension requests only what the single purpose needs:

- **storage** — to save your provider, API key, output language, and
  rate-limit/daily-cap settings, and to track the daily preview count.
- **contextMenus** — to add “debait this page” for current-page analysis and
  “debait this link” for user-requested HTTP/HTTPS target previews without opening
  the link. Both actions serve the same article summarization purpose.
- **host permissions `https://*/*` and `http://*/*`** — two things need
  all-sites access: (1) a content script runs on the page to detect Alt+hover and
  draw the result overlay/tooltip, and (2) when you hover a link, the background
  worker fetches *that link's target page* (which can be on any site) so it can be
  summarized before you click. The same all-sites access also lets the extension
  send the article text to whichever AI provider you configure (e.g.
  api.openai.com) and reach a local Ollama at http://localhost. The extension only
  acts on pages you explicitly debait or hover; it does not otherwise read or
  transmit your browsing.

(No `activeTab`, `tabs`, or `scripting` permission is requested — the content
script is statically declared and messaging uses the tab id only.)

## Data usage disclosures (Chrome “Privacy practices” tab)

- Does the extension collect user data? **Only to provide the feature, sent to a
  third-party AI provider the user configures.** No data is sent to the developer.
- Personally identifiable info: **No**
- Health info: **No**
- Financial info: **No**
- Authentication info: **The user's own AI provider API key, stored in
  `chrome.storage.sync` (may synchronize through Chrome Sync) and used to
  authenticate with their configured AI endpoint.**
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
- Support email: cusp-preacher-blot [at] duck [dot] com
  (put the PLAIN address in Partner Center's "Support email" field; keep it
  obfuscated as above in any public-facing description text)
- Support (GitHub, optional): https://github.com/smailzhu/outsmarting-clickbait/issues

## Assets checklist
- [x] Store icon 128×128 — `store/store-icon-128.png` (padded, transparent margin)
- [x] Small promo tile 440×280 — `store/promo-tile-440x280.png`
- [x] Marquee promo 1400×560 — `store/promo-marquee-1400x560.png`
- [ ] At least one screenshot 1280×800 (or 640×400; PNG/JPEG, no alpha) — **capture from a real
      browser**: toolbar popup, a result panel on an article, and an Alt+hover
      tooltip. (`store/screenshot-mockup-1280x800.png` is a design mockup — replace
      it with a real capture before publishing.)

## Build the upload package
```bash
npm run pack   # -> dist/debait-extension-v<version>.zip  (upload this)
```

---

## 繁體中文 listing (zh-TW)

Paste these into the Chinese (Traditional) language slot in the dashboard.

### 名稱 (Title)
debait — 識破騙點閱

### 摘要 (Summary, ≤132 chars)
在你點擊前，讀取連結背後的文章，顯示誠實標題、摘要與 0–100 騙點閱分數，幫你判斷值不值得點。

### 詳細說明 (Detailed description)
請將 **[descriptions/zh-TW.txt](descriptions/zh-TW.txt)** 的完整文字貼到
繁體中文商店頁面的「詳細說明」欄位。該檔案是唯一的完整文案來源，包含
使用前設定、功能、限制及隱私說明。

台語（漢羅）文案草稿另見 [descriptions/nan-Hanlo.txt](descriptions/nan-Hanlo.txt)，
尚待母語者校對。台語介面選項不代表商店後台一定有台語刊登語言可選。

### 單一用途 (Single purpose)
debait 讀取一篇網頁文章並評估其騙點閱程度——誠實標題、摘要、重點與 0–100 分數——適用於目前頁面或懸停的連結。

### 備註 (caveats, keep accurate)
限制已包含在上述純文字說明中，請連同功能介紹一起貼上，不要只貼優點而略過限制。

### 台語（漢羅）草稿
[descriptions/nan-Hanlo.txt](descriptions/nan-Hanlo.txt) — draft for native-speaker
review and use in channels that support Taiwanese text. It is not a claim of a
native Taiwanese Chrome Web Store listing locale.
