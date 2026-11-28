# outsmarting-clickbait 🪝🚫

> **v0.4.0 已經佇 GitHub kah [Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=zh-TW)發布矣。** 公開商店版本於 **2026-11-28**確認。後來的 GitHub 新版猶愛另外送審。自訂端點 kah 使用者腳本限制看[自訂端點指南（英文）](docs/custom-provider.md)。


[English](README.md) | [繁體中文](README.zh-TW.md) | **台語（漢羅）**

[![去 Chrome 線上應用程式商店安裝 debait](docs/assets/chrome-web-store-badge.png)](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=zh-TW)

> ⚠️ 這份台語（漢羅）說明是**草稿**，猶閣愛母語者校對。歡迎鬥相共改予較好。

Tī 你點落去進前，先看破騙點閱。debait 會用 AI 分析掠著文字的頭前上濟 12,000 個字元，予你一个誠實 ê 標題、簡短 ê 摘要、重點，koh 有 0–100 ê 騙點閱分數，予你判斷這條連結值得點無。

> 這是 Wiwi Kuan（官大為）部落格文章〈[騙點閱](https://www.wiwi.blog/blog/outsmarting-clickbait/)〉ê 實作原型。

---

## 這是啥

拍開任何一篇文章，點一下就會當得著：

- **誠實標題** — 文章實際咧講啥，無膨風、無吊人 ê 胃口。
- **摘要 kah 重點**。
- **騙點閱分數（0–100）** kah 偵測著 ê 手路。
- **內容評估** — 有料、單薄抑是空空。
- **值得點無** — 另外判斷完整文章敢有摘要以外的資訊。

兩種用法：

- Tī 文章頁面點工具列 ê 按鈕（抑是撳右鍵 →「用 debait 看這頁」）。
- 揿牢 **所選懸停鍵** koh kā 滑鼠徙去任何連結頂懸，**tī 點進前**就先看連結 ê 誠實標題 kah 分數。

## 安裝（Chrome / Edge / Brave）

**Chrome 使用者會當直接對商店安裝：**拍開
[Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/pcjbpicieggjfjldoekdeglnjhcdhjla?hl=zh-TW)，
撳**加到 Chrome**。免開發人員模式，嘛免下載 ZIP。
裝好會當 tī 擴充功能選單 kā debait 釘選，了後拍開設定，揀供應商 kah
填家己 ê API 金鑰，抑是設定本機模型。

> 商店連結用繁體中文；台語介面愛 tī debait ê **介面語言**設定內底揀。

### 手動安裝（替代方式／開發版本）

1. 去 [上新版（Releases）](https://github.com/smailzhu/outsmarting-clickbait/releases/latest) 下載 **`debait-extension-v*.zip`**，kā 解壓縮。
2. 拍開 `chrome://extensions`（Edge 用 `edge://extensions`、Brave 用 `brave://extensions`）。
3. kā 正頂角 ê **開發人員模式**拍開。
4. 點**載入未封裝**，揀拄才解壓縮、內底有 `manifest.json` ê 資料夾。
5. 工具列就會出現 🪝🚫 圖示。

> 介面會 tuè 你 ê 瀏覽器語言；嘛會當 tī **選項 → 介面語言**改做台語、華語抑是英語。

## 設定（看供應商敢愛金鑰）

debait 會用你家己揀 ê AI 供應商 kah API 金鑰，開銷 kah 模型品質你家己掌握。

1. 點工具列 ê 🪝🚫 圖示 →**設定（API 金鑰）**。
2. 揀一个**供應商**（主流雲端服務抑是本機模型 lóng 會使）。
3. 有需要才填 **API 金鑰**；本機Ollama kah 免金鑰自訂服務會當留空。自訂端點愛填基底網址 kah 模型，會當先撳**試連線**，才撳**儲存**。

「試連線」用這馬填 ê 供應商、模型 kah 金鑰，免先儲存。
會發出一擺細 ê 生成請求，可能用額度抑是愛付費，毋過無傳文章內容，
嘛無算 tī 懸停預覽 ê 逐工上限內底。成功代表模型有傳文字轉來。
若顯示 429，請檢查供應商額度 kah 請求限制，毋一定是金鑰無效。

> 想欲免費試？Google **Gemini** kah **Groq** lóng 有免費額度；抑是 tī 本機走 **Ollama**（免金鑰）。

## 用法

- **分析這頁**：點工具列圖示 →**分析這頁**，抑是 tī 頁面撳右鍵 →「用 debait 看這頁」。
- **點進前先看**：揿牢 **所選懸停鍵** kā 滑鼠徙去連結頂懸，等一下仔就看會著連結 ê 誠實標題 kah 分數。
- **右鍵看連結**：tī HTTP／HTTPS 連結撳右鍵 →「**用 debait 看這條連結**」，免拍開目標頁面，就會當 tī 會關 ê 面板看結果。這个功能 kah 懸停預覽共用快取、限流 kah 逐工上限。
- **輸出語言**：摘要會當用任何語言輸出（tī 設定內底填；留空＝kah 文章仝款）。

## 懸停預覽（v0.4.0；台語草稿）

Tī 設定揀 **Shift + 懸停**、**Alt + 懸停**抑是**免按修飾鍵懸停**，了後儲存。
全新安裝預設 Shift，原有選擇照移轉規則保留。Shift 愛按牢 koh 徙滑鼠；干焦按鍵袂啟動。
免按修飾鍵可能無另外點一下，就掠連結頁面、傳內容 kah 用 AI 額度。

頁面愛看會著 kah 有焦點。頭一擺位置事件可能干焦建立基準，閣徙就會當試。
徙開、捲動抑是失焦會取消準備中的需求，毋過袂收回已發出的網站／AI請求抑是開銷；
額度保留了後才取消，可能猶算一擺。快取囥 tī 工作程序記憶體，重啟可能消失。
設定無齊會顯示指引，無掠文章抑是叫 AI。

Shift+點擊可能開新視窗，放 Alt 可能拍開瀏覽器選單。是懸停，毋是點擊。
使用者腳本猶用獨立 Alt。完整規則 kah 猶未驗證的項目看
[懸停指南（英文）](docs/hover-activation.md)。Chrome 商店 v0.4.0 確認發布矣；後來的 GitHub 更新袂自動更新商店。

## 省錢 kah 額度

懸停預覽會自動限流、tú著供應商限流（HTTP 429）會自動退避，koh 會遵守你設定 ê **逐工上限**，減少無張持用額度的風險，毋過無保證。手動分析這頁 kah 試連線無受預覽上限限制；退避時間毋是可調整設定。

## 隱私

無 debait 伺服器。網址、標題、描述、文字 kah 指示傳予你設定 ê 供應商；API 金鑰 kah 設定 用瀏覽器同步儲存，可能經Google／Microsoft同步服務同步；袂傳予作者。詳細政策看 [PRIVACY.md](PRIVACY.md)。

## 使用者腳本（有管理器 kah 傳輸限制）

若你較佮意使用者腳本：裝 Tampermonkey，拍開 [`userscript/debait.user.js`](userscript/debait.user.js) →**Raw** 就會當安裝。選單 kah 介面是英文／繁體中文，無台語選單。自訂端點限定Chromium頂Tampermonkey隔離環境，請看[使用者腳本說明](userscript/README.md)。

## 回報問題

無 GitHub 帳號？寄批予作者：**cusp-preacher-blot [at] duck [dot] com**（kā「[at]」換做「@」、「[dot]」換做「.」），抑是去開 [issue](https://github.com/smailzhu/outsmarting-clickbait/issues)。

---

英文說明 kah 完整開發文件看 [README.md](README.md)。授權：MIT。
