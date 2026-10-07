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

Bring your own API key. debait works with the AI provider of your choice — a
major hosted service or a local model — so you stay in control of cost and model
quality. Output can be in any language.

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

The extension requests only what the single purpose needs:

- **storage** — to save your provider, API key, output language, and
  rate-limit/daily-cap settings, and to track the daily preview count.
- **contextMenus** — to add the “debait this page” right-click item.
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
騙點閱只對人類有效。debait 會用 AI 幫你讀取文章內容，給你實質內容——一個誠實、不聳動的標題、簡短摘要、重點，以及 0–100 的騙點閱分數——讓你在浪費一次點擊之前，就能判斷這個連結值不值得點。

功能
開啟任何文章，點一下 debait 按鈕（或按右鍵 →「debait 這個頁面」），很快就能得到：
• 誠實標題——文章實際在講什麼，沒有誇大、沒有懸念釣魚。
• 簡短摘要與重點。
• 騙點閱分數（0–100）與偵測到的操弄手法。
• 判斷：有料、單薄還是空洞——到底值不值得點。

點擊前先預覽
按住 Alt 並把滑鼠移到任何連結上，debait 會讀取該連結的目標頁面，在工具提示中顯示誠實標題與分數——不用打開就能略過垃圾內容。

為什麼要裝
• 不再獎勵煽動性內容、「第 3 點你絕對想不到」、以及一句話灌水成八段的文章。
• 省時間：幾秒內就看穿一個標題背後的內容。
• 對每個頁面都有一個冷靜、不帶情緒的第二意見。
• 用你的語言閱讀：摘要可用任何語言輸出，而且介面支援繁體中文與英文。

自備 AI
debait 使用你自己選擇的 AI 供應商與 API 金鑰，可選擇主流雲端服務或本機模型，費用與模型品質由你完全掌控。

隱私至上
沒有 debait 伺服器。頁面文字只會傳送到你設定的供應商；API 金鑰與設定儲存在你的瀏覽器（透過 chrome.storage.sync，啟用 Chrome 同步時可能同步到你登入的其他瀏覽器），絕不會傳給開發者。擴充功能只要求必要的權限，而且只在你主動 debait 或懸停的頁面上運作。懸停預覽會自動限流並遵守你設定的每日上限，避免不小心把配額用光。（手動的「分析這個頁面」每次都會呼叫一次，不受每日上限限制。）

開放原始碼
程式碼、隱私政策與文件：https://github.com/smailzhu/outsmarting-clickbait

### 單一用途 (Single purpose)
debait 讀取一篇網頁文章並評估其騙點閱程度——誠實標題、摘要、重點與 0–100 分數——適用於目前頁面或懸停的連結。

### 備註 (caveats, keep accurate)
預覽會讀取目標頁面；若擷取到的內文少於約 200 個字（常見於 JS 動態產生或付費牆頁面），會改用該頁面的 meta 敘述（若無則顯示標題）；若連線失敗則顯示錯誤。模型會讀取頁面約前 12,000 個字元。
