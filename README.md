# MAGI EVA Runtime v5

MAGI EVA Runtime v5 is an EVA-inspired multi-agent orchestration console for JavaScript runtimes. It combines dynamic sub-agent generation, dynamic multi-team generation, multiple collaboration patterns, MAGI-style arbitration, and a full session archive system.

## Core capabilities

- Dynamic sub-agent generation
- Dynamic multi-team generation, with up to 6 teams in one run
- Collaboration patterns:
  - roundtable
  - experts
  - debate
  - hierarchy
  - swarm
  - dag
- MAGI three-core arbitration:
  - MELCHIOR-1
  - BALTHASAR-2
  - CASPER-3
- Responsive EVA/MAGI interface with collapsible panels and sections
- Real OpenAI Responses API path
- Demo fallback path when no API key is configured or a live call fails
- Full session recording and archive export

## Recording and archive system

v5 adds a persistent recording layer for every session.

The runtime now records:

- topology planner request and response
- every agent prompt and response
- every task planner request and response
- every team synthesis prompt and response
- MAGI vote prompts and responses
- final report prompt and response
- blackboard notes
- runtime event history

Archives are written automatically to:

```text
data/sessions/<session-id>.json
data/sessions/<session-id>.md
```

The UI also provides:

- Refresh Records
- Export JSON
- Export MD
- Session Archive panel with recent dialogue turns

## Quick start

### Windows PowerShell

```powershell
cd C:\Users\jmes1\桌面\magi-eva-v5
copy .env.example .env
# Fill in OPENAI_API_KEY if you want live mode
node .\server.mjs
```

If port 3000 is already in use, the server automatically switches to the next available port.

You can also choose a port manually:

```powershell
node .\server.mjs --port 3100
```

or:

```powershell
.\start.ps1 -Port 3100
```

## Environment variables

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

Model selection is no longer exposed in the UI. It is controlled only through `.env`.

## Session archive endpoints

### Archive summary

```text
GET /api/archive?session=<session-id>
```

Returns a live summary of:

- archive stats
- recent transcript turns
- team result summaries
- MAGI vote summaries
- final report summary
- export URLs

### Export JSON archive

```text
GET /api/export?session=<session-id>&format=json
```

### Export Markdown archive

```text
GET /api/export?session=<session-id>&format=md
```

## What is included in the JSON archive

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

## UI notes

- The interface is responsive and adaptive.
- Panels and sections can be folded.
- Team cards can be expanded or collapsed individually.
- The Session Archive panel shows recent dialogue records.
- Export buttons are available in the console actions section.

## Directory layout

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

## Runtime modes

### Live mode

Uses the real OpenAI Responses API path.

### Demo mode

Uses local fallback outputs while keeping the orchestration flow, event stream, archive generation, and export functions intact.

## Recommended validation steps

1. Start a new session.
2. Run one MAGI cycle in demo mode.
3. Open the Session Archive panel.
4. Confirm that recent turns are visible.
5. Export JSON and Markdown.
6. Check that `data/sessions/` contains both files.

## Notes

- Session archives can become large because every prompt and response is preserved.
- Demo mode still records complete archives.
- If live calls fail, the runtime falls back locally and still records the fallback path.
