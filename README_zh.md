# MAGI EVA Runtime v5

MAGI EVA Runtime v5 是一個以 EVA / MAGI 為靈感的多代理協作控制台，具備動態子代理生成、動態多團隊生成、多種協作模式、MAGI 三核心仲裁，以及完整的 session 記錄與匯出能力。

## 核心能力

- 動態子代理生成
- 動態多團隊生成，單次執行最多 6 個團隊
- 協作模式：
  - roundtable
  - experts
  - debate
  - hierarchy
  - swarm
  - dag
- MAGI 三核心仲裁：
  - MELCHIOR-1
  - BALTHASAR-2
  - CASPER-3
- 自適應 EVA / MAGI 介面，支援摺疊面板與摺疊區塊
- 真實 OpenAI Responses API 路徑
- 未配置 API key 或 live call 失敗時，自動退回 demo fallback 鏈路
- 完整 session 記錄與 archive 匯出

## 記錄與 archive 系統

v5 新增了持久化記錄層。

現在會記錄：

- topology planner 的 request / response
- 每個 agent 的 prompt / response
- 每個 task planner 的 request / response
- 每個 team synthesis 的 prompt / response
- MAGI 投票 prompt / response
- final report prompt / response
- blackboard 記錄
- runtime event history

每個 session 會自動寫出：

```text
data/sessions/<session-id>.json
data/sessions/<session-id>.md
```

介面也提供：

- Refresh Records
- Export JSON
- Export MD
- Session Archive 面板，可查看最近的對話記錄

## 啟動方式

### Windows PowerShell

```powershell
cd C:\Users\jmes1\桌面\magi-eva-v5
copy .env.example .env
# 如果要使用 live mode，請填入 OPENAI_API_KEY
node .\server.mjs
```

如果 3000 已被占用，伺服器會自動切換到下一個可用埠。

也可以手動指定埠：

```powershell
node .\server.mjs --port 3100
```

或：

```powershell
.\start.ps1 -Port 3100
```

## 環境變數

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
HOST=127.0.0.1
PORT=3000
MAGI_PLANNER_MODEL=gpt-5.4
MAGI_WORKER_MODEL=gpt-5.4-mini
MAGI_JUDGE_MODEL=gpt-5.4
MAGI_SWARM_MODEL=gpt-5.4-mini
```

模型配置已從介面移除，現在只由 `.env` 控制。

## Session archive API

### 取得 archive 摘要

```text
GET /api/archive?session=<session-id>
```

回傳內容包含：

- archive 統計
- 最近 transcript turns
- team result 摘要
- MAGI vote 摘要
- final report 摘要
- 匯出連結

### 匯出 JSON archive

```text
GET /api/export?session=<session-id>&format=json
```

### 匯出 Markdown archive

```text
GET /api/export?session=<session-id>&format=md
```

## JSON archive 內容

- mission
- runtime config
- topology
- stats
- team results
- MAGI votes
- final report
- blackboard entries
- chronological transcript
- model call records
- event history
- export file metadata

## 介面說明

- 介面支援 responsive / adaptive 行為。
- 面板與區塊可摺疊。
- 每個 team card 可單獨展開或收合。
- Session Archive 面板顯示最近的對話記錄。
- Console Actions 區塊可直接匯出 JSON / Markdown。

## 目錄結構

```text
magi-eva-v5/
├─ server.mjs
├─ start.ps1
├─ README.md
├─ README_zh.md
├─ .env.example
├─ data/
│  └─ sessions/
└─ public/
   ├─ index.html
   ├─ styles.css
   └─ app.js
```

## Runtime 模式

### Live mode

使用真實 OpenAI Responses API 路徑。

### Demo mode

使用本地 fallback 輸出，但仍保留完整 orchestration、event stream、archive 生成與匯出功能。

## 建議驗證流程

1. 建立新 session。
2. 使用 demo mode 跑一次 MAGI cycle。
3. 打開 Session Archive 面板。
4. 確認最近對話已出現。
5. 匯出 JSON 與 Markdown。
6. 檢查 `data/sessions/` 是否已生成兩個檔案。

## 注意事項

- 因為會保留每一個 prompt / response，archive 檔案可能很大。
- demo mode 也會產生完整 archive。
- live call 失敗時，系統仍會走 fallback，並把 fallback 路徑一起記錄下來。
