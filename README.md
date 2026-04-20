# MAGI EVA Runtime v4

EVA 風格的多代理運行原型，包含：
- 動態子代理生成
- 動態多團隊生成
- 多種協作模式：roundtable / experts / debate / hierarchy / swarm / dag
- MAGI 三核心仲裁
- 可摺疊控制區、遙測區、團隊區、事件區
- 自適應舞台布局
- 真實 OpenAI Responses API 路徑，無 API key 時自動退回本地 fallback

## 啟動

```powershell
cd C:\Users\jmes1\桌面\magi-eva-v4
copy .env.example .env
# 填入 OPENAI_API_KEY
node .\server.mjs
```

如果 3000 被占用，伺服器會自動切換到下一個可用埠。

也可以指定埠：

```powershell
node .\server.mjs --port 3100
```

或：

```powershell
.\start.ps1 -Port 3100
```

## 本版重點

### 介面
- 設定、面板、操作按鈕支援摺疊
- 各團隊卡片可單獨展開 / 收合
- 小螢幕自動切換更緊湊布局
- HUD 顯示團隊數、代理數、任務數、模式覆蓋
- 保留 EVA / MAGI 風格舞台、雷達、光暈、決策室視覺

### 核心
- planner 回傳不完整 topology 時會自動補齊
- 依 pattern 自動生成缺失的 synthetic sub-agents
- 團隊數不足時會自動補 synthetic teams
- 依賴關係會自動修復，避免死結
- 同層並行團隊只讀取已完成依賴結果，不再混入未授權上游資料
- live 模式無 API key 時不會中斷，會進入 fallback 鏈路

## 模型設定

模型不再從介面配置，改由 `.env` 控制：
- `MAGI_PLANNER_MODEL`
- `MAGI_WORKER_MODEL`
- `MAGI_JUDGE_MODEL`
- `MAGI_SWARM_MODEL`
