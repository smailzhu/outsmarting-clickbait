# outsmarting-clickbait 🪝🚫

> **v0.4.0 已在 GitHub 與 [Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=zh-TW)發布。** 於 **2026-11-28**確認公開商店版本。未來 GitHub 新版仍需另行送審。自訂端點及使用者腳本限制見[自訂端點指南（英文）](docs/custom-provider.md)。


[English](README.md) | **繁體中文** | [台語（漢羅）](README.tai-gi.md)

[![到 Chrome 線上應用程式商店安裝 debait](docs/assets/chrome-web-store-badge.png)](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=zh-TW)

在你點擊前，先看穿騙點閱。debait 會用 AI 分析最多 12,000 個字元的擷取文章文字，給你一個**誠實的標題**、簡短摘要、重點，以及 **0–100 的騙點閱分數**，讓你判斷這個連結值不值得點。

> 這是 Wiwi Kuan（官大為）部落格文章〈[騙點閱](https://www.wiwi.blog/blog/outsmarting-clickbait/)〉的實作原型。

---

## 這是什麼

開啟任何文章後，點一下就能得到：

- **誠實標題** — 文章實際在講什麼，沒有誇大、沒有懸念釣魚。
- **摘要 + 重點**。
- **騙點閱分數（0–100）** 與偵測到的操弄手法。
- **內容評估** — 有料／單薄／空洞。
- **是否值得點擊** — 模型另外評估完整文章是否有摘要以外的資訊，不是上述三種標籤。

兩種用法：

- 在文章頁面點工具列按鈕（或按右鍵 →「debait 這個頁面」）。
- 按住 **所選懸停鍵** 並把滑鼠移到任何連結上，在**點擊之前**就先預覽該連結的誠實標題與分數。

## 安裝（Chrome / Edge / Brave）

**Chrome 使用者建議直接從商店安裝：**開啟
[Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=zh-TW)，
按**加到 Chrome**。不需要開發人員模式，也不用下載 ZIP。
安裝後可從拼圖（擴充功能）選單釘選 debait，再開啟**設定（API 金鑰）**，
選擇供應商並填入自己的金鑰，或設定本機模型。

### 手動安裝（替代方式／開發版本）

1. 到 [最新版本（Releases）](https://github.com/smailzhu/outsmarting-clickbait/releases/latest) 下載 **`debait-extension-v*.zip`**，並**解壓縮**。
2. 開啟 `chrome://extensions`（Edge 用 `edge://extensions`、Brave 用 `brave://extensions`）。
3. 開啟右上角的**開發人員模式**。
4. 點**載入未封裝**，選擇剛剛解壓縮、內含 `manifest.json` 的資料夾。
5. 工具列會出現 🪝🚫 圖示。若沒看到，點工具列的**拼圖（擴充功能）**圖示，把 debait **釘選**到工具列。

> 設定 → **介面語言**可選英文、繁體中文或台語草稿；Auto跟隨瀏覽器。摘要語言另行設定。

## 設定（依供應商需求填入金鑰）

debait 使用**你自己的 AI 供應商與 API 金鑰**，費用與模型由你完全掌控。

1. 點工具列的 🪝🚫 圖示 →**設定（API 金鑰）**。
2. 選一個**供應商**（OpenAI、Anthropic（Claude）、Google Gemini、Groq、OpenRouter、DeepSeek、xAI（Grok）、Mistral、Together、NVIDIA、本機 Ollama，或自訂／OpenAI 相容端點）。
3. 依供應商需求填入 **API 金鑰**；本機Ollama或免金鑰的自訂端點可留空。自訂端點需明確填基底網址與模型。可先按**測試連線**，再按**儲存**。

「測試連線」使用目前填寫的供應商、模型與金鑰，不需要先儲存。
它會發出一次小型生成請求，可能使用配額或產生費用，但不傳送文章內容，
也不計入懸停預覽的每日上限。成功代表模型有回傳文字；若顯示 429，
請檢查供應商餘額與請求限制，不一定是金鑰無效。

> 想免費試用？Google **Gemini** 與 **Groq** 都有免費額度；或在本機跑 **Ollama**（免金鑰）。

## 使用方式

- **分析目前頁面**：點工具列圖示 →**分析這個頁面**，或在頁面上按右鍵 →「debait 這個頁面」。
- **點擊前預覽**：按住 **所選懸停鍵** 並把滑鼠移到連結上，稍候即可看到該連結的誠實標題與分數。
- **右鍵分析連結**：在 HTTP／HTTPS 連結上按右鍵 →「**debait 這個連結**」，不用開啟目標頁面，就能在可關閉的面板閱讀結果。此功能共用懸停預覽的快取、限流與每日上限。
- **輸出語言**：摘要可用任何語言輸出（在設定中填寫；留空＝與文章一致）。

## 懸停預覽（v0.4.0）

在設定選擇 **Shift + 懸停**、**Alt + 懸停**或**不按修飾鍵懸停**，然後儲存。
全新安裝預設 Shift；既有選擇依移轉規則保留。Shift 必須按住並移動滑鼠；只按鍵不啟動。
不按修飾鍵模式可能不經額外點擊，就抓取連結頁面、傳送內容並使用 AI 配額。

網頁須可見且取得焦點；初次位置事件可能只建立基準，再移動即可。
移開滑鼠、捲動或失焦可取消準備中的需求，但不能收回已發出的網站／AI 請求或費用；
已保留的預覽次數仍可能計一次。快取在工作程序記憶體中，重啟後可能消失。
設定不完整時會顯示設定指引，不抓取文章或呼叫 AI。

Shift+點擊可能開新視窗，放開 Alt 可能讓瀏覽器選單取得焦點。預覽是懸停，不是點擊。
使用者腳本仍用獨立的 Alt 懸停。完整移轉／取消規則與未完成驗證見
[懸停指南（英文）](docs/hover-activation.md)。Chrome 商店 v0.4.0 已確認發布；未來 GitHub 更新不會自動更新商店。

## 省錢與配額

**懸停預覽**會自動限流、遇到供應商限流（HTTP 429）時自動退避，並遵守你設定的**每日上限**，降低不小心耗盡配額的風險（退避時間不可調整）。

請注意：手動的「**分析這個頁面**」（工具列按鈕或右鍵）每次都會呼叫一次 AI，**不受**上述每日上限與限流限制。懸停延遲、間隔與每日上限都可在**設定**中調整。

## 隱私

沒有 debait 伺服器。網址、標題、描述、擷取文字及自訂指示會傳送到**你設定的供應商**；API 金鑰與設定儲存在你的瀏覽器（透過 `chrome.storage.sync`，啟用同步時，可能透過Chrome的Google或Edge的Microsoft同步服務同步），不會傳給開發者。完整政策見 [PRIVACY.md](PRIVACY.md)。

## 使用者腳本（依管理器與傳輸限制）

若你偏好使用者腳本：安裝 Tampermonkey，開啟 [`userscript/debait.user.js`](userscript/debait.user.js) →**Raw** 即可安裝。選單與介面支援英文／繁體中文；自訂端點限定Chromium上的Tampermonkey隔離環境，詳見[使用者腳本說明](userscript/README.md)。

---

英文說明與完整開發文件請見 [README.md](README.md)。授權：MIT。
