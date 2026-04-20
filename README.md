# MAGI // EVA-inspired Multi-Agent Runtime

一個以《新世紀福音戰士》MAGI 視覺語言為靈感的多代理 JS 原型。

## 特性

- 動態子代理生成
- 動態多團隊生成與依賴編排
- 內建多種協作模式：roundtable / experts / debate / hierarchy / swarm / dag
- 共享 blackboard / stigmergy 事件流
- MAGI 三核心裁決：MELCHIOR / BALTHASAR / CASPER
- 真實 OpenAI Responses API 串接
- 可選 built-in `web_search` 工具
- EVA / MAGI 風格動態前端介面
- 自動避開被占用的連接埠，預設從 `3000` 開始往上尋找

## 啟動

### 1. 建立環境檔

```bash
cp .env.example .env
# 編輯 .env，填入 OPENAI_API_KEY
```

### 2. 啟動伺服器

```bash
node server.mjs
```

如果 `3000` 已被占用，伺服器會自動切到下一個可用埠，並在終端輸出實際網址。

### 3. 指定埠啟動

```bash
node server.mjs --port 3100
```

PowerShell：

```powershell
$env:PORT = 3100
node .\server.mjs
```

或直接：

```powershell
.\start.ps1 -Port 3100
```

## 環境變數

```bash
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
HOST=127.0.0.1
PORT=3000
MAGI_PLANNER_MODEL=gpt-5.4
MAGI_WORKER_MODEL=gpt-5.4-mini
MAGI_JUDGE_MODEL=gpt-5.4
MAGI_SWARM_MODEL=gpt-5.4-mini
```

## 介面說明

- 左側：任務輸入、模型與執行配置、mission digest
- 中央：MAGI 決策室、動態團隊軌道圖、HUD 統計、狀態 banner
- 右側：phase timeline、shared blackboard、decision memo
- 下方：team cards 與 event log

## API

- `GET /api/config`
- `POST /api/session`
- `GET /api/events?session=<id>`
- `POST /api/run`
- `GET /api/health`

## 注意

- 未設定 `OPENAI_API_KEY` 時，自動退回 demo mode。
- 介面為 EVA / MAGI inspired design language，未使用原作素材。
- 前端請開啟終端顯示的實際網址，不要硬寫 `3000`。
