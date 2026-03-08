# Lobot 混合式收費計劃（僅計劃，不含實作）

## 1. 目標

- 以「儲值 + 月訂」混合收費取代免費方案。
- 低頻用戶走儲值，高頻用戶走月訂，兼顧現金流與 MRR 穩定性。
- 維持現有 LINE webhook 翻譯體驗，不破壞既有 `#set/#quiet/#active` 指令邏輯。

## 2. 商業規則（最終版）

### 2.1 收費模式

- 不提供免費方案。
- 新用戶提供一次性體驗包：`$0.99 / 150K tokens`。
- 低頻用戶（近 30 天用量 `<= 300K tokens`）主推儲值。
- 非低頻用戶（近 30 天用量 `> 300K tokens`）主推月訂。

### 2.2 儲值方案

- Starter：`$4.99 / 2.2M tokens`
- Value：`$9.99 / 5.0M tokens`
- Power：`$19.99 / 11.0M tokens`

### 2.3 月訂方案

- Pro：`$5.99 / 月`，含 `1.2M tokens`
- Pro Plus：`$12.99 / 月`，含 `4.0M tokens`

### 2.4 使用優先與扣款順序

- 優先權：`Pro Plus > Pro > Wallet`。
- 扣量順序：
  1. 月訂內含額度
  2. 儲值餘額
  3. 觸發升級或加購提示

## 3. 計算與成本假設

- 成本假設：`$0.60 / 1M tokens`（input+output 混合）。
- 金流費率：`2.9% + $0.30/筆`。
- 目標毛利：`65%`。
- 定價驗算公式：
  - `Capi = tokens * 0.60 / 1,000,000`
  - `Pmin = (Capi + 0.30) / (1 - 0.029 - 0.65)`

## 4. 產品規格變更

### 4.1 指令新增

- `#plan`：顯示目前方案、今日已用/上限、近 30 天用量、推薦方案。
- `#buy`：顯示儲值購買入口。
- `#subscribe`：顯示月訂購買入口。

### 4.2 既有指令維持

- `#set`, `#lang`, `#quiet`, `#active`, `!setrole` 行為保留。

### 4.3 資料結構（Chat Setting）

新增欄位：

- `billingMode: "wallet" | "subscription"`
- `subscriptionTier: "pro" | "pro_plus"`（僅月訂）
- `walletBalanceTokens: number`
- `rolling30dTokens: number`
- `billingStatus: "active" | "past_due" | "canceled"`
- `currentPeriodEnd: string` (ISO8601)

## 5. 技術規格變更

### 5.1 環境變數

- `OPENAI_DAILY_TOKEN_LIMIT_WALLET`
- `OPENAI_DAILY_TOKEN_LIMIT_PRO`
- `OPENAI_DAILY_TOKEN_LIMIT_PRO_PLUS`
- `BILLING_LOW_FREQUENCY_THRESHOLD_TOKENS`（預設 300000）
- `BILLING_ROLLING_WINDOW_DAYS`（預設 30）
- `BUY_URL`
- `SUBSCRIBE_URL`

### 5.2 Token Usage

- 延用每日 usage store。
- 新增 rolling window 聚合函式（讀近 N 天每日 usage 累加）。

### 5.3 無免費方案的觸發行為

- 若使用者尚未有有效方案，翻譯請求不呼叫 OpenAI。
- 回覆訊息引導 `#buy` 或 `#subscribe`。

## 6. 實作工作分解（WBS）

1. 型別與常數

- 擴充 `types.ts` 與 `constants.ts`（計費模式、tier、門檻、命令常數）。

2. 環境設定

- 擴充 `environment.ts` 解析新環境變數並提供預設值。

3. 指令解析與訊息

- 在 `commands.ts` 增加 `#plan/#buy/#subscribe` 解析器與回覆文案 builder。

4. 配額與方案判定

- 在 webhook 主流程加入「有效方案檢查」與「tier 對應 daily limit」邏輯。
- 加入 rolling30d 用量判斷，產生推薦方案。

5. 資料儲存

- 擴充 `chat-settings.ts` schema，支援新增計費欄位。

6. 文件更新

- 更新 `README.md`：新增計費命令、環境變數、Monetization 連結。

## 7. 測試計劃

### 7.1 新增測試

- `#plan` 回覆內容正確（各 tier 與不同 rolling30d）。
- `#buy/#subscribe` 指令回覆與儲存邏輯正確。
- 無有效方案時，不呼叫翻譯 API 且回覆引導文案。
- 各 tier daily limit 正確套用。

### 7.2 回歸測試

- 既有 `#set/#quiet/#active/!setrole` 不受影響。
- 單語翻譯與空翻譯 fallback 行為不變。
- token usage 累加與跨 UTC 日期重置行為不變。

## 8. 驗收標準

- 功能驗收：上述新舊測試皆通過。
- 行為驗收：未啟用方案時不會觸發 OpenAI 請求。
- 文件驗收：README 與 `MONETIZATION.md` 內容一致。

## 9. 非目標（本階段不做）

- 真實金流 webhook 串接（僅預留欄位與接口）。
- 後台管理介面。
- 自動退款與稅務計算。
