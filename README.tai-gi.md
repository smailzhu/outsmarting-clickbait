# outsmarting-clickbait 🪝🚫

[English](README.md) | [繁體中文](README.zh-TW.md) | **台語（漢羅）**

> ⚠️ 這份台語（漢羅）說明是**草稿**，猶閣愛母語者校對。歡迎鬥相共改予較好。

Tī 你點落去進前，先看破騙點閱。debait 會用 AI kā 規篇文章讀予你，予你一个誠實 ê 標題、簡短 ê 摘要、重點，koh 有 0–100 ê 騙點閱分數，予你判斷這條連結值得點無。

> 這是 Wiwi Kuan（官大為）部落格文章〈[騙點閱](https://www.wiwi.blog/blog/outsmarting-clickbait/)〉ê 實作原型。

---

## 這是啥

拍開任何一篇文章，點一下就會當得著：

- **誠實標題** — 文章實際咧講啥，無膨風、無吊人 ê 胃口。
- **摘要 kah 重點**。
- **騙點閱分數（0–100）** kah 偵測著 ê 手路。
- **判斷** — 有料、單薄抑是空空，到底值得點無。

兩種用法：

- Tī 文章頁面點工具列 ê 按鈕（抑是撳右鍵 →「用 debait 看這頁」）。
- 揿牢 **Alt** koh kā 滑鼠徙去任何連結頂懸，**tī 點進前**就先看連結 ê 誠實標題 kah 分數。

## 安裝（Chrome / Edge / Brave）

1. 去 [上新版（Releases）](https://github.com/smailzhu/outsmarting-clickbait/releases/latest) 下載 **`debait-extension-v*.zip`**，kā 解壓縮。
2. 拍開 `chrome://extensions`（Edge 用 `edge://extensions`、Brave 用 `brave://extensions`）。
3. kā 正頂角 ê **開發人員模式**拍開。
4. 點**載入未封裝**，揀拄才解壓縮、內底有 `manifest.json` ê 資料夾。
5. 工具列就會出現 🪝🚫 圖示。

> 介面會 tuè 你 ê 瀏覽器語言；嘛會當 tī **選項 → 介面語言**改做台語、華語抑是英語。

## 設定（愛家己 ê API 金鑰）

debait 會用你家己揀 ê AI 供應商 kah API 金鑰，開銷 kah 模型品質你家己掌握。

1. 點工具列 ê 🪝🚫 圖示 →**設定（API 金鑰）**。
2. 揀一个**供應商**（主流雲端服務抑是本機模型 lóng 會使）。
3. kā 該供應商 ê **API 金鑰**貼入去，撳**儲存**。

> 想欲免費試？Google **Gemini** kah **Groq** lóng 有免費額度；抑是 tī 本機走 **Ollama**（免金鑰）。

## 用法

- **分析這頁**：點工具列圖示 →**分析這頁**，抑是 tī 頁面撳右鍵 →「用 debait 看這頁」。
- **點進前先看**：揿牢 **Alt** kā 滑鼠徙去連結頂懸，等一下仔就看會著連結 ê 誠實標題 kah 分數。
- **輸出語言**：摘要會當用任何語言輸出（tī 設定內底填；留空＝kah 文章仝款）。

## 省錢 kah 額度

懸停預覽會自動限流、tú著供應商限流（HTTP 429）會自動退避，koh 會遵守你設定 ê **逐工上限**，避免無張持 kā 額度用了。這寡 lóng 會當 tī **設定**內底調整。

## 隱私

無 debait 伺服器。頁面文字 kan-na 傳予你設定 ê 供應商；API 金鑰 kah 設定 lóng 囥 tī 你 ê 瀏覽器，袂傳予作者。詳細政策看 [PRIVACY.md](PRIVACY.md)。

## 使用者腳本（Tampermonkey／任何瀏覽器，含 Firefox）

若你較佮意使用者腳本：裝 Tampermonkey，拍開 [`userscript/debait.user.js`](userscript/debait.user.js) →**Raw** 就會當安裝。選單 kah 介面仝款支援台語。

## 回報問題

無 GitHub 帳號？寄批予作者：**cusp-preacher-blot [at] duck [dot] com**（kā「[at]」換做「@」、「[dot]」換做「.」），抑是去開 [issue](https://github.com/smailzhu/outsmarting-clickbait/issues)。

---

英文說明 kah 完整開發文件看 [README.md](README.md)。授權：MIT。
