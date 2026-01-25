# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Starter kit for building Claude Code telemetry dashboards. Includes a generic OTLP receiver server, Claude Code hooks for real-time event tracking, and a comprehensive spec for dashboard builders. Sessions are persisted to disk with 12-hour file rotation and survive server restarts.

## Starting a New Dashboard Project

When a user wants to create their own dashboard using CCDK:

1. **Rename the folder** from `ccdk` to `server` — this clearly identifies it as the backend component
2. **Update `package.json`** — change the `name` field to match the new project
3. **Build custom frontend** in the `frontend/` directory or create a sibling folder

```bash
# Typical project structure after setup:
my-dashboard/
├── server/           # Renamed from ccdk
│   ├── server.js
│   ├── package.json  # name: "my-dashboard-server"
│   └── frontend/     # Can stay here or move to sibling
└── README.md
```

This convention keeps the telemetry server clearly separated from custom dashboard code.

## Commands

```bash
npm run install:all  # Install dependencies for both server and frontend
npm run dev          # Start BOTH server (4318) and frontend (5173) together
npm run dev:server   # Start telemetry server only (port 4318)
npm run dev:frontend # Start frontend dev server only (port 5173)
npm run build        # Build frontend for production
npm start            # Start server only (production)
npm test             # Integration test: starts server, sends fake events, verifies responses
```

The `npm run dev` command uses `concurrently` to run both the server and frontend together.

## Architecture

**Data flow:**
```
Claude Code CLI
  ├─ OTLP batches → POST /v1/logs, /v1/metrics → server.js
  └─ Hooks → hooks/post-tool-use.mjs → POST /v1/logs → server.js
                                                            ↓
                              ~/.claude/backups/dashboards/default/
                                    └── YYYY-MM-DD-HHMM.json (12h rotation)
                                                            ↓
                              GET /api/sessions → Dashboard frontend
```

**File structure:**
```
~/.claude/backups/dashboards/
├── config.json                    # Server configuration
└── default/                       # Default backup directory
    ├── 2026-01-25-0000.json      # 12-hour window file
    ├── 2026-01-25-1200.json      # Next 12-hour window
    └── ...
```

**server.js** (~680 lines) — the entire server application:
- **Session State** — `Map<sessionId, SessionState>` with fields:
  - Core: `id`, `createdAt`, `lastActivity`, `ended`
  - Identification: `sessionName`, `workingDir`, `subagentType`, `parentSessionId`
  - Tools: `lastTool`, `lastEventName`, `toolCallCount`, `toolHistory[]`
  - Tokens: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `totalTokens`
  - Cost/Performance: `totalCost`, `totalLatencyMs`, `requestCount`
  - History: `tokenHistory[]` (up to 1440 entries, 24h at 1-min intervals)
  - Errors: `errorCount`, `lastError`
  - Model: `model`
- **Config Persistence** — `~/.claude/backups/dashboards/config.json` for backup directory
- **12-Hour File Rotation** — Timestamped files `YYYY-MM-DD-HHMM.json`, auto-rotation
- **Minute-Interval Snapshots** — Token history captured every 60s for active sessions
- **OTLP Receiver** — Parses attributes, processes `api_request`, `tool_result`, `api_error`, `session_end` events; ignores traces (`POST /v1/traces`)
- **Session Naming** — Derives `sessionName` from `cwd` attribute (project folder name)
- **Metrics Processing** — Updates token/cost counters from OTLP metric data points
- **Dashboard API:**
  - `GET /api/sessions` (with `?id=` filter, includes `lifetime` totals)
  - `DELETE /api/sessions/:id` (soft-delete/archive by default, `?hard=true` for permanent)
  - `GET /api/aggregate-history` (minute-aligned totals, survives session lifecycle)
  - `GET /api/archived` (view archived sessions)
  - `GET /api/config`, `POST /api/config`
  - `GET /api/archives`, `GET /api/archives/:filename`
  - `GET /api/health`

**hooks/post-tool-use.mjs** — Claude Code hook script:
- Handles `PostToolUse` → `tool_result`, `UserPromptSubmit` → `user_prompt`, `Stop` → `stop` events
- Captures `cwd` from hook data or `CLAUDE_PROJECT_DIR` env var
- Sends OTLP-formatted log records with `cwd` attribute to the server
- Non-blocking with 3s timeout, configurable via `DASH_TELEMETRY_URL`
- Unknown hook events send `keepalive` to keep session active

**Runtime:** Node.js with native ES modules (`"type": "module"`). Express 5.x. No TypeScript. No build step.

## Configuration

**Server environment variables:**

| Env Var | Default | Purpose |
|---------|---------|---------|
| `DASHBOARD_NAME` | `default` | Unique name for this dashboard instance (isolates storage) |
| `PORT` | `4318` | Server listen port (OTLP standard) |
| `DASH_TELEMETRY_URL` | `http://localhost:4318` | Hook target URL |

**Multi-dashboard example:**
```bash
# Run two dashboards on different ports with separate storage
DASHBOARD_NAME=work PORT=4318 npm run dev:server
DASHBOARD_NAME=personal PORT=4319 npm run dev:server
```

**Claude Code environment variables** (set in `~/.zshrc` or per-shell):

| Env Var | Value | Purpose |
|---------|-------|---------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` | Enable telemetry export |
| `OTEL_LOGS_EXPORTER` | `otlp` | Export logs via OTLP |
| `OTEL_METRICS_EXPORTER` | `otlp` | Export metrics via OTLP |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` | Use HTTP/JSON protocol |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Target server URL |
| `OTEL_LOGS_EXPORT_INTERVAL` | `2000` | Export batch interval (ms) |

**Per-dashboard config file:** `~/.claude/backups/dashboards/<DASHBOARD_NAME>/config.json`
```json
{
  "dashboardName": "my-project",
  "backupDir": "/Users/dev/.claude/backups/dashboards/my-project"
}
```

## Key Files

- `server.js` — OTLP receiver + REST API + file persistence + token snapshots
- `hooks/post-tool-use.mjs` — Claude Code hook for real-time event forwarding with cwd capture
- `SPEC.md` — Comprehensive specification for dashboard builders (API contract, event reference, tool categories, dashboard patterns, hooks setup, token history, file rotation)
- `test-server.sh` — Manual integration test script
- `frontend/` — Starter React + TypeScript template (see below)

## Frontend Template

The `frontend/` directory contains a ready-to-use React + Vite + TypeScript starter template with:

**Stack:**
- React 18 + TypeScript
- Vite (dev server with API proxy pre-configured)
- TanStack Query (5-second polling, caching, error handling)
- Zustand (lightweight state management)

**Key files:**
```
frontend/src/
├── types/index.ts      # Session, Aggregate, ApiResponse interfaces
├── lib/
│   ├── constants.ts    # POLL_INTERVAL, TOOL_CATEGORIES, CATEGORY_COLORS
│   └── formatters.ts   # formatTokens, formatCost, formatLatency, etc.
├── hooks/
│   └── useSessions.ts  # TanStack Query hook with lifecycle callbacks
├── stores/
│   └── store.ts        # Zustand store template
├── App.tsx             # Starter component (replace with your UI)
└── main.tsx            # Entry point with QueryClient setup
```

**Usage:**
1. Run `npm run install:all` to install all dependencies
2. Run `npm run dev` to start both server and frontend
3. Open http://localhost:5173 to see the starter dashboard
4. Replace `App.tsx` with your custom UI implementation

**Included utilities:**
- `useSessions()` — Polls `/api/sessions` with `onSessionAdded`/`onSessionRemoved` callbacks
- `useSessionDiff()` — Detects added/removed sessions for animations
- `formatTokens()`, `formatCost()`, `formatLatency()`, `formatTimeAgo()` — Display formatting
- `getToolCategory()`, `getToolColor()` — Tool classification and coloring
- `TOOL_CATEGORIES`, `CATEGORY_COLORS` — Constants for visual grouping

See SPEC.md for:
- Complete API contract and response shapes
- Token history charting examples
- Dashboard design patterns
- File rotation and archives API
