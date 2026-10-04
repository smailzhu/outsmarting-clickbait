# outsmarting-clickbait 🪝🚫

[English](README.md) | **繁體中文**

在你點擊前，先看穿騙點閱。debait 會用 AI 讀完整篇文章，給你一個**誠實的標題**、簡短摘要、重點，以及 **0–100 的騙點閱分數**，讓你判斷這個連結值不值得點。

> 這是 Wiwi Kuan（官大為）部落格文章〈[騙點閱](https://www.wiwi.blog/blog/outsmarting-clickbait/)〉的實作原型。

---

## 這是什麼

開啟任何文章後，點一下就能得到：

- **誠實標題** — 文章實際在講什麼，沒有誇大、沒有懸念釣魚。
- **摘要 + 重點**。
- **騙點閱分數（0–100）** 與偵測到的操弄手法。
- **是否值得點** — 有料／單薄／空洞。

兩種用法：

- 在文章頁面點工具列按鈕（或按右鍵 →「debait 這個頁面」）。
- 按住 **Alt** 並把滑鼠移到任何連結上，在**點擊之前**就先預覽該連結的誠實標題與分數。

## 安裝（Chrome / Edge / Brave）

1. 到 [最新版本（Releases）](https://github.com/smailzhu/outsmarting-clickbait/releases/latest) 下載 **`debait-extension-v*.zip`**，並**解壓縮**。
2. 開啟 `chrome://extensions`（Edge 用 `edge://extensions`、Brave 用 `brave://extensions`）。
3. 開啟右上角的**開發人員模式**。
4. 點**載入未封裝**，選擇剛剛解壓縮、內含 `manifest.json` 的資料夾。
5. 工具列會出現 🪝🚫 圖示。若沒看到，點工具列的**拼圖（擴充功能）**圖示，把 debait **釘選**到工具列。

> 介面會依你的瀏覽器語言，自動顯示繁體中文或英文。

## 設定（需自備 API 金鑰）

debait 使用**你自己的 AI 供應商與 API 金鑰**，費用與模型由你完全掌控。

1. 點工具列的 🪝🚫 圖示 →**設定（API 金鑰）**。
2. 選一個**供應商**（OpenAI、Anthropic（Claude）、Google Gemini、Groq、OpenRouter、DeepSeek、xAI（Grok）、Mistral、Together、NVIDIA，或本機 Ollama）。
3. 貼上該供應商的 **API 金鑰**，按**儲存**。

> 想免費試用？Google **Gemini** 與 **Groq** 都有免費額度；或在本機跑 **Ollama**（免金鑰）。

## 使用方式

- **分析目前頁面**：點工具列圖示 →**分析這個頁面**，或在頁面上按右鍵 →「debait 這個頁面」。
- **點擊前預覽**：按住 **Alt** 並把滑鼠移到連結上，稍候即可看到該連結的誠實標題與分數。
- **輸出語言**：摘要可用任何語言輸出（在設定中填寫；留空＝與文章一致）。

## 省錢與配額

**懸停預覽**會自動限流、遇到供應商限流（HTTP 429）時自動退避，並遵守你設定的**每日上限**，降低不小心耗盡配額的風險（退避時間不可調整）。

請注意：手動的「**分析這個頁面**」（工具列按鈕或右鍵）每次都會呼叫一次 AI，**不受**上述每日上限與限流限制。懸停延遲、間隔與每日上限都可在**設定**中調整。

## 隱私

沒有 debait 伺服器。頁面文字只會傳送到**你設定的供應商**；API 金鑰與設定儲存在你的瀏覽器（透過 `chrome.storage.sync`，可能會透過你的 Google 帳號同步到你登入的其他瀏覽器），不會傳給開發者。完整政策見 [PRIVACY.md](PRIVACY.md)。

## 使用者腳本（Tampermonkey／任何瀏覽器，含 Firefox）

若你偏好使用者腳本：安裝 Tampermonkey，開啟 [`userscript/debait.user.js`](userscript/debait.user.js) →**Raw** 即可安裝。選單與介面同樣支援繁體中文。

---

英文說明與完整開發文件請見 [README.md](README.md)。授權：MIT。
