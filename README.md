# AI 劇組實驗室

一張 LINE 對話截圖，背後其實有**五個 AI 接力**：編劇、評審、執行、美術指導、生圖。這個 repo 把那條產線拆開，用**真的錄下來的跑程**逐步重播。

**線上：** https://yazelin.github.io/ai-crew-lab/
**拆的對象：** [LINE 對話製造機](https://github.com/yazelin/line-chat-maker)（同系列還有[隱形浮水印實驗室](https://github.com/yazelin/invisible-watermark-lab)，拆的是同一個工具的另一半）

純靜態、零金鑰、手機看得完。頁面上沒有任何即時 API 呼叫——所有數字、劇本、工具呼叫、評審分數都是預錄的真實資料。

## 五個角色

| 角色 | 模型 | 只做一件事 |
|---|---|---|
| 編劇 | GLM-5.2（貴、慢，十幾秒） | 把一句主題寫成完整劇本，完全不碰 JSON |
| 評審 | gpt-oss-120b（便宜、快） | 六項各 0–10，`pass = 總分≥48 且每項≥6`，回 JSON |
| 執行 | gpt-oss-120b | 只把定稿劇本填進腳本 JSON，不准改劇情 |
| 美術指導 | gpt-oss-120b | 為每個待補圖格寫 ≤80 字的繪圖 prompt |
| 生圖 | codex-image | **一次**生一張 2×2 格盤，切格交給程式碼 |

## 三個值得看的設計

**上游的創作規則是下游決定的。**編劇被限制在 40 則以內，不是美學偏好——執行 AI 每批只能填 8 則，劇本太長就會做到一半停住。

**評審回 JSON，不是回感想。**「我覺得還不錯」沒辦法讓程式決定要不要重跑。要能自動迴圈，判斷就必須是結構化的。

**幾何是程式碼，內容才是 AI。**幾格圖不是叫幾次生圖，是排成一張格盤（3 格用 2×2、6 格用 3×3）一次生出來，再用程式切開。省掉大半呼叫，而且位置精確到像素。

**切格與去背直接用它的 `pure.js`，不重寫。**`cellRect` 每邊內縮 8%（閃開生圖時要求的粗白色分隔線），`chromaKeyData` 四角取綠中位數再羽化去背。自己重寫一套的下場就是每格帶白邊、位置偏一點——這個 repo 第一版就是這樣壞的。頁面直接引用 `vendor/lcm-pure.js`。

**大頭貼跟訊息裡的圖是同一張格盤切出來的。**待補圖清單會把「沒有頭像的人物」一起排進去，所以一次生圖同時解決兩件事。

**成品用的是這個工具自己的「嵌入HTML」，不是截圖。**那段 HTML 自包含（CSS 內嵌加 `.lcm-embed` 前綴、圖片是 data URI、零外部相依），所以頁面上那支手機可以真的捲、可以逐則播放。純文字那幾次只有 13~19 KB，比長截圖（200~300 KB）還小。`record/embeds.mjs`

## 量出來的、對自己不利的兩件事

**一、描述在交接時掉了（line-chat-maker 的真實 bug，已修正）。**編劇寫「一張畫素極差的柴犬迷因圖」「被 P 上柴犬臉的銀行 App 截圖」，美術指導最後畫出來的是藍色小雪人、黃色小貓咪。因果鏈：系統提示要求帶 `imgDesc` → 但工具 schema 沒宣告這個欄位 → 模型不送 → `hint: m.imgDesc || ''` 永遠是空字串 → 美術指導只好自己編。

**五個角色每一個都「成功」了，成品卻是壞的。**壞掉的是它們之間的介面，而介面不屬於任何一個角色——每個角色的 log 都是綠的。

2026-08-16 修好了（[line-chat-maker d0493a5](https://github.com/yazelin/line-chat-maker/commit/d0493a5)），修法是在兩個工具的 schema 裡把 `imgDesc`／`dur`／`fname`／`fsize` 宣告出來。用同一套錄製手法實測，非文字訊息帶到描述的比例從 **0/3 變成 7/7**；美術指導畫出來的東西從「藍色小雪人」變成「左手七根手指」「頭頂長出楓樹」「左下角浮現 HELP ME I CANNOT STOP GENERATING」——逐字對應。修好前後兩次都留在頁面上，因為對照本身就是教材。

**二、評審沒有執行自己 prompt 裡寫死的規則。**prompt 寫著「草稿寫成對方的台詞 → real 不得超過 3 且 pass=false」。實測餵它一份踩陷阱的劇本：它在意見裡把問題講得一清二楚，分數卻給了 real=6。**把規則寫進 prompt ≠ 規則會被執行。**

## 資料怎麼來的

```bash
cd record
node record.mjs "深夜曖昧" run-x.json   # 攔截 fetch 錄一次真實跑程
IMG=1 node record.mjs "…" run-img.json  # 連補圖一起錄（每日 2 次上限）
node critic-bench.mjs                   # 拿同一個真評審評幾份好壞不同的劇本
cd .. && node record/build-data.mjs     # 整理成 data/runs.json
```

錄製方式是在頁面腳本執行前包住 `window.fetch`，把每一次對代理的請求與回應原樣存下來，**沒有改 line-chat-maker 一行程式碼**。`critic-bench.mjs` 的評審 system prompt 直接從線上的 `ai.js` 抽出來，不手抄——人家改了這裡跟著變。

原始錄製檔留在 `record/run-*.json`（含完整 prompt，較大），網站只用整理過的 `data/runs.json`。

```bash
python3 -m http.server 8877 && node test/e2e.mjs   # 真瀏覽器端到端
PAGE=https://yazelin.github.io/ai-crew-lab/ node test/e2e.mjs
```

## 授權

MIT · 林亞澤
