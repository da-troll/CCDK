# CCDK — Claude Code Dashboard Kit

Shared telemetry server + specs for building dashboard frontends that visualize live Claude Code agent activity.

## Starting a New Dashboard Project

When creating your own dashboard using CCDK as a starting point:

1. **Clone or copy** the ccdk folder to your project location
2. **Rename the folder** from `ccdk` to `server` (or your preferred name)
3. **Update `package.json`** — change the `name` field to match your project
4. **Build your frontend** in the `frontend/` directory

```bash
# Example: Creating a new dashboard called "my-dashboard"
cp -r ccdk my-dashboard/server
cd my-dashboard/server
# Update package.json name field, then:
npm run install:all
npm run dev
```

The `server/` naming convention keeps the telemetry backend clearly separated from your custom frontend code.

## Quick Start

```bash
cd ccdk
npm run install:all     # Install server + frontend dependencies
npm run dev             # Start both server (4318) and frontend (5173)
```

Open http://localhost:5173 to see the starter dashboard.

**Server only:**
```bash
npm run dev:server      # Just the telemetry server on port 4318
```

### Multi-Dashboard Support

Run multiple dashboard instances on one machine, each with isolated storage:

```bash
# Default dashboard (stores in ~/.claude/backups/dashboards/default/)
npm run dev:server

# Named dashboard (stores in ~/.claude/backups/dashboards/my-project/)
DASHBOARD_NAME=my-project PORT=4319 npm run dev:server

# Another dashboard on a different port
DASHBOARD_NAME=work-tasks PORT=4320 npm run dev:server
```

Each dashboard maintains separate:
- Session history (12-hour rotation files)
- Archived sessions
- Aggregate history
- Configuration

**Directory Structure:**
```
~/.claude/
└── backups/
    └── dashboards/
        ├── default/
        │   ├── config.json
        │   └── 2026-01-25-0800.json
        ├── my-project/
        │   ├── config.json
        │   └── 2026-01-25-0800.json
        └── work-tasks/
            ├── config.json
            └── 2026-01-25-0800.json
```

Dashboard names must contain only letters, numbers, hyphens, and underscores.

Then in any shell where you run Claude Code:
```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_LOGS_EXPORT_INTERVAL=2000
```

Add these to `~/.zshrc` for persistent use. Any `claude` session will auto-export.

### Hooks Setup

The `hooks/` directory contains a Claude Code hook that sends supplementary events to the telemetry server. This provides more real-time tracking than OTLP batching alone, and captures the working directory for session naming.

To install, add to your `~/.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      { "type": "command", "command": "node /path/to/ccdk/hooks/post-tool-use.mjs" }
    ],
    "UserPromptSubmit": [
      { "type": "command", "command": "node /path/to/ccdk/hooks/post-tool-use.mjs" }
    ],
    "Stop": [
      { "type": "command", "command": "node /path/to/ccdk/hooks/post-tool-use.mjs" }
    ]
  }
}
```

The hook sends events to `DASH_TELEMETRY_URL` (defaults to `http://localhost:4318`). It silently fails if the server is not running.

**Hook Data Captured:**
- `cwd` — Working directory (enables session naming from project folder)
- Falls back to `CLAUDE_PROJECT_DIR` environment variable if `cwd` not in hook data

---

## OTLP Receiver Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/logs` | Receive OTLP log records (primary telemetry) |
| `POST /v1/metrics` | Receive OTLP metrics (token/cost counters) |
| `POST /v1/traces` | Ignored (returns 200 OK, no processing) |

All endpoints return `200 OK` with empty JSON `{}`.

---

## API Contract

### `GET /api/sessions`

Returns all active Claude Code sessions with full metrics.

Query params:
- `?id=<sessionId>` — filter to a single session

Response shape:
```json
{
  "timestamp": 1706100000000,
  "sessions": [
    {
      "id": "2cd4e930-8ed0-4bd2-adeb-5c1d6b29cd9e",
      "createdAt": 1706099000000,
      "lastActivity": 1706100000000,
      "ended": false,
      "endedAt": null,
      "archivedAt": null,
      "sessionName": "my-project",
      "workingDir": "/Users/dev/my-project",
      "subagentType": null,
      "parentSessionId": null,
      "lastTool": "Edit",
      "lastEventName": "tool_result",
      "toolCallCount": 47,
      "toolHistory": [
        {"name": "Edit", "timestamp": 1706100000000, "success": true, "durationMs": 120}
      ],
      "totalTokens": 58162,
      "inputTokens": 10,
      "outputTokens": 154,
      "cacheReadTokens": 57821,
      "cacheCreationTokens": 331,
      "totalCost": 0.03487925,
      "totalLatencyMs": 5087,
      "requestCount": 1,
      "tokenHistory": [
        {"timestamp": 1706100000000, "input": 10, "output": 154, "cache": 57821, "cost": 0.03487925}
      ],
      "errorCount": 0,
      "lastError": null,
      "model": "claude-opus-4-5-20251101"
    }
  ],
  "aggregate": {
    "totalTokens": 58162,
    "totalCost": 0.03487925,
    "avgLatencyMs": 5087,
    "errorRate": 0,
    "totalSessions": 1,
    "totalToolCalls": 47
  },
  "lifetime": {
    "totalTokens": 158162,
    "totalCost": 0.13487925,
    "totalToolCalls": 147,
    "totalSessions": 4,
    "archivedSessions": 3
  }
}
```

### `DELETE /api/sessions/:id`

Remove a session from the store and disk.

```json
{"deleted": true}
```

Returns `404` if the session does not exist.

### `GET /api/config`

Returns current server configuration.

```json
{
  "dashboardName": "my-project",
  "backupDir": "/Users/dev/.claude/backups/dashboards/my-project",
  "currentFile": "2026-01-25-0800.json"
}
```

### `POST /api/config`

Update server configuration.

Request body:
```json
{
  "backupDir": "/path/to/custom/backup/dir"
}
```

Response:
```json
{
  "backupDir": "/path/to/custom/backup/dir",
  "currentFile": "2026-01-25-0800.json"
}
```

### `GET /api/archives`

List all available archive files with metadata.

```json
{
  "archives": [
    {
      "filename": "2026-01-25-0800.json",
      "date": "2026-01-25T08:00:00.000Z",
      "label": "2026-01-25-0800",
      "isCurrent": true
    },
    {
      "filename": "2026-01-24-2000.json",
      "date": "2026-01-24T20:00:00.000Z",
      "label": "2026-01-24-2000",
      "isCurrent": false
    }
  ],
  "backupDir": "/Users/dev/.claude/backups/dashboards/default"
}
```

### `GET /api/archives/:filename`

Fetch sessions from a specific archive file.

```json
{
  "sessions": [...],
  "filename": "2026-01-24-2000.json"
}
```

Returns `400` if filename format is invalid, `404` if file not found.

### `GET /api/health`

```json
{
  "status": "ok",
  "dashboardName": "my-project",
  "activeSessions": 1,
  "archivedSessions": 5,
  "aggregateHistoryPoints": 120,
  "uptime": 120.5
}
```

### `GET /api/aggregate-history`

Returns aggregate metrics history for charting total usage over time. This data persists across session lifecycle changes (end, archive, delete), preventing chart drops when sessions are removed.

**Granularity:** 1-minute intervals, aligned to clock boundaries.
**Retention:** 1440 points maximum (24 hours).

Query params:
- `?minutes=N` — limit to last N minutes (default: all, max: 1440)

```json
{
  "history": [
    {
      "timestamp": 1706100000000,
      "totalTokens": 150000,
      "totalCost": 0.15,
      "activeSessions": 2,
      "totalToolCalls": 45
    }
  ],
  "current": {
    "totalTokens": 180000,
    "totalCost": 0.18,
    "activeSessions": 1,
    "archivedSessions": 3,
    "totalToolCalls": 60
  }
}
```

### `GET /api/archived`

Returns all archived (soft-deleted) sessions.

Query params:
- `?id=<sessionId>` — filter to a single archived session

```json
{
  "timestamp": 1706100000000,
  "sessions": [...],
  "count": 5
}
```

### `DELETE /api/sessions/:id` (Updated)

Archives a session (soft-delete) by default. Session data is preserved in the archive to maintain aggregate history accuracy.

Query params:
- `?hard=true` — permanently delete instead of archive

Response:
```json
{"deleted": true, "archived": true}
```

---

## Session Data Model

Full session state object:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID session identifier |
| `createdAt` | number | Unix timestamp (ms) when session started |
| `lastActivity` | number | Unix timestamp (ms) of last event |
| `ended` | boolean | True if session received `session_end` event |
| `endedAt` | number\|null | Unix timestamp (ms) when session ended |
| `archivedAt` | number\|null | Unix timestamp (ms) when session was archived |
| `sessionName` | string\|null | User-friendly name (derived from cwd folder) |
| `workingDir` | string\|null | Full working directory path |
| `subagentType` | string\|null | Sub-agent type (e.g., "Explore", "Plan") |
| `parentSessionId` | string\|null | Parent session ID if this is a sub-agent |
| `lastTool` | string\|null | Name of most recently used tool |
| `lastEventName` | string\|null | Most recent event type |
| `toolCallCount` | number | Total tool invocations |
| `toolHistory` | array | Last 20 tools: `[{name, timestamp, success, durationMs}]` |
| `totalTokens` | number | Sum of all token types |
| `inputTokens` | number | Input tokens used |
| `outputTokens` | number | Output tokens generated |
| `cacheReadTokens` | number | Tokens read from cache |
| `cacheCreationTokens` | number | Tokens written to cache |
| `totalCost` | number | Cumulative cost in USD |
| `totalLatencyMs` | number | Sum of all API latencies |
| `requestCount` | number | Number of API requests |
| `tokenHistory` | array | Token snapshots: `[{timestamp, input, output, cache, cost, final?}]` |
| `errorCount` | number | Number of errors |
| `lastError` | string\|null | Most recent error message |
| `model` | string\|null | Model used (e.g., "claude-opus-4-5-20251101") |

---

## Token History for Charts

The `tokenHistory` array provides time-series data for charting token usage over time.

**Data collection:**
- Snapshots are taken on every `api_request` event
- Additional snapshots every 60 seconds for active sessions
- Final snapshot captured on `session_end` (marked with `final: true`)
- Up to 1440 entries retained (24 hours at 1-minute intervals)

**Snapshot timing rules:**
- Timestamps are aligned to minute boundaries for consistent aggregation
- Only sessions with activity in the last 5 minutes are snapshotted (except final)
- Duplicate snapshots within the same minute are skipped
- Only sessions with actual tokens (input, output, or cache) are snapshotted

**Chart implementation example:**
```javascript
// Bucket by 1-minute intervals, take max values per bucket
const INTERVAL_MS = 60 * 1000;
const buckets = new Map();

session.tokenHistory.forEach((snap) => {
  const bucket = Math.floor(snap.timestamp / INTERVAL_MS) * INTERVAL_MS;
  const existing = buckets.get(bucket) || { input: 0, output: 0, cache: 0 };
  buckets.set(bucket, {
    input: Math.max(existing.input, snap.input),
    output: Math.max(existing.output, snap.output),
    cache: Math.max(existing.cache, snap.cache),
  });
});

// Convert to array for charting
const chartData = Array.from(buckets.entries())
  .sort((a, b) => a[0] - b[0])
  .slice(-30) // Last 30 minutes
  .map(([timestamp, data]) => ({
    time: new Date(timestamp).toLocaleTimeString(),
    ...data,
  }));
```

---

## File Rotation & Archives

Sessions are persisted to timestamped JSON files with 12-hour rotation.

**File naming:** `YYYY-MM-DD-HHMM.json` (e.g., `2026-01-25-0800.json`)

**Storage location:** `~/.claude/backups/dashboards/<DASHBOARD_NAME>/`
- Default dashboard: `~/.claude/backups/dashboards/default/`
- Named dashboard: `~/.claude/backups/dashboards/my-project/`

**Directory hierarchy** (auto-created on startup):
```
~/.claude/
└── backups/
    └── dashboards/
        └── <DASHBOARD_NAME>/
            ├── config.json           # Per-dashboard config
            └── YYYY-MM-DD-HHMM.json  # Session data files
```

**Rotation logic:**
- On startup: load from most recent file if within 12-hour window
- If 12+ hours since last file: create new file
- During operation: check before each save, rotate if needed

**Per-dashboard config:** `~/.claude/backups/dashboards/<DASHBOARD_NAME>/config.json`
```json
{
  "dashboardName": "my-project",
  "backupDir": "/Users/dev/.claude/backups/dashboards/my-project"
}
```

---

## Telemetry Events Reference

Claude Code exports these as OTLP log records. Each record has these attributes:

### Common attributes (every record)
| Key | Example |
|-----|---------|
| `session.id` | `"2cd4e930-8ed0-4bd2-adeb-5c1d6b29cd9e"` |
| `user.id` | `"bddef7f1..."` (hashed) |
| `organization.id` | `"a8c22afb-..."` |
| `terminal.type` | `"iTerm.app"` |
| `event.name` | `"api_request"` / `"tool_result"` / ... |
| `event.timestamp` | `"2026-01-24T21:24:23.966Z"` |

### `event.name = "api_request"`
| Key | Type | Description |
|-----|------|-------------|
| `model` | string | `"claude-opus-4-5-20251101"` |
| `input_tokens` | string(int) | Input tokens used |
| `output_tokens` | string(int) | Output tokens generated |
| `cache_read_tokens` | string(int) | Tokens read from cache |
| `cache_creation_tokens` | string(int) | Tokens written to cache |
| `cost_usd` | string(float) | Cost in USD |
| `duration_ms` | string(int) | Latency in ms |

### `event.name = "tool_result"`
| Key | Type | Description |
|-----|------|-------------|
| `tool_name` | string | `"Read"`, `"Edit"`, `"Bash"`, etc. |
| `success` | string(bool) | `"true"` / `"false"` |
| `duration_ms` | string(int) | Tool execution time |
| `cwd` | string | Working directory (from hooks) |

### `event.name = "api_error"`
| Key | Type | Description |
|-----|------|-------------|
| `error_message` | string | Error description |

### `event.name = "tool_decision"`
Tool selected (before execution).

### `event.name = "session_end"`
Marks the session as ended (`ended: true`). The session remains in the store for historical reference.

### `event.name = "user_prompt"`
Only exported if `OTEL_LOG_USER_PROMPTS=1` is set.

### Hook-Sent Events

The `hooks/post-tool-use.mjs` hook sends additional events to the server:

| Event Name | Trigger | Purpose |
|------------|---------|---------|
| `tool_result` | `PostToolUse` hook | Tool execution with `cwd` attribute |
| `user_prompt` | `UserPromptSubmit` hook | User activity signal with `cwd` |
| `stop` | `Stop` hook | Claude finished responding with `cwd` |
| `keepalive` | Other hook events | Keep session active with `cwd` |

All hook events include:
- `session.id` — From hook data
- `event.name` — Event type
- `cwd` — Working directory (from hook data or `CLAUDE_PROJECT_DIR` env var)

---

## Recommended Libraries

| Purpose | Library | Notes |
|---------|---------|-------|
| Data Fetching | @tanstack/react-query | 5-second polling, caching, error handling |
| State Management | zustand | Lightweight, no boilerplate |
| Build Tool | vite | Fast dev server with API proxy |
| Styling | Your choice | Tailwind, CSS modules, styled-components, etc. |

The `frontend/` template includes TanStack Query and Zustand pre-configured.

---

## Tool Categories

Useful for grouping/coloring agents by what they're doing:

```javascript
const TOOL_CATEGORIES = {
  exploration: ['Read', 'Glob', 'Grep', 'LS', 'View', 'NotebookRead'],
  creation:    ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  execution:   ['Bash', 'Task', 'RunCode', 'KillShell', 'BashOutput'],
  research:    ['WebSearch', 'WebFetch'],
  coordination:['TodoWrite', 'AskUser', 'AskUserQuestion', 'Skill', 'EnterPlanMode', 'ExitPlanMode'],
};

const CATEGORY_COLORS = {
  exploration: '#3B82F6',  // Blue
  creation:    '#10B981',  // Green
  execution:   '#F59E0B',  // Amber
  research:    '#8B5CF6',  // Purple
  coordination:'#EC4899',  // Pink
};

function getToolCategory(toolName) {
  // Direct match
  if (toolName in TOOL_CATEGORIES) return TOOL_CATEGORIES[toolName];
  // Partial match (handles "mcp__*" tools)
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.some(t => toolName.includes(t))) return category;
  }
  return 'exploration'; // default
}
```

---

## Frontend Polling Pattern

All dashboards should follow this pattern:

```javascript
const POLL_INTERVAL = 5000; // 5 seconds

async function poll() {
  const res = await fetch('/api/sessions');
  const data = await res.json();

  // data.sessions = array of active sessions
  // data.aggregate = summed metrics across all sessions
  // Each session has:
  //   .toolHistory (last 20 tools) for activity animation
  //   .tokenHistory for time-series charts
  //   .sessionName for display (falls back to ID if null)

  updateDashboard(data);
}

setInterval(poll, POLL_INTERVAL);
```

If using Vite dev server, add proxy:
```javascript
// vite.config.ts
server: {
  proxy: { '/api': { target: 'http://localhost:4318', changeOrigin: true } }
}
```

If using Next.js, add rewrites:
```javascript
// next.config.mjs
async rewrites() {
  return [{ source: '/api/:path*', destination: 'http://localhost:4318/api/:path*' }];
}
```

---

## Session Lifecycle Detection

Track session additions/removals for animations and UI updates:

```typescript
const previousIds = useRef<Set<string>>(new Set());

useEffect(() => {
  if (!sessions) return;

  const currentIds = new Set(sessions.map(s => s.id));

  // Detect added sessions
  const added = sessions.filter(s => !previousIds.current.has(s.id));
  added.forEach(session => onSessionAdded?.(session));

  // Detect removed sessions
  const removed = [...previousIds.current].filter(id => !currentIds.has(id));
  removed.forEach(id => onSessionRemoved?.(id));

  // Update for next comparison
  previousIds.current = currentIds;
}, [sessions]);
```

The `frontend/` template includes `useSessions()` hook with built-in lifecycle callbacks.

---

## Formatting Utilities

Standard formatting functions used across all dashboard implementations:

```typescript
// Tokens: 1234 → "1.2K", 1234567 → "1.2M"
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toLocaleString();
}

// Cost: 0.005 → "$0.0050", 5.5 → "$5.50"
function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// Latency: 500 → "500ms", 2500 → "2.5s"
function formatLatency(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

// Time ago: Date.now() - 5000 → "5s ago"
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

// Session ID: "abc123def456" → "abc123de"
function formatSessionId(id: string, length = 8): string {
  return id.slice(0, length);
}
```

The `frontend/` template includes all these utilities in `src/lib/formatters.ts`.

---

## Dashboard Patterns

### Pattern 1: Retro OS Control Center (98.css / XP.css)

**Libraries:** [98.css](https://jdan.github.io/98.css/) or [XP.css](https://botoxparty.github.io/XP.css/)
**Stack:** React + 98.css + Vite

**Layout:**
- Desktop with draggable windows
- Each session = one window (title bar shows sessionName or session ID short + model)
- Window content: live-updating metrics (tokens, cost, tool calls)
- Taskbar at bottom shows all active sessions as buttons
- "System Monitor" window with aggregate metrics (like Task Manager)
- "Event Log" window showing scrolling tool history

**Key visuals:**
- Session state → window icon (idle=gray, active=green, error=red)
- Tool categories → folder icons in window
- Cost displayed as progress bar filling up
- Latency shown as a "performance meter" with needle

**Idle state:** Show "My Computer" icon + "No active sessions" dialog box

---

### Pattern 2: High-Tech Terminal Dashboard (Textual TUI)

**Libraries:** [blessed-contrib](https://github.com/yaronn/blessed-contrib) or [Textual](https://textual.textualize.io/) (Python)
**Stack:** Node.js + blessed-contrib (runs in terminal, no browser)

**Layout:**
- Full terminal UI with box-drawing characters
- Top bar: aggregate metrics (sessions | tokens | cost | latency)
- Left panel: session list with sparklines for activity
- Center: live-scrolling event log (tool calls, API requests)
- Right panel: selected session detail (model, token breakdown, error count)
- Bottom: ASCII bar chart of tool category distribution

**Key visuals:**
- Sessions colored by activity recency (bright=recent, dim=idle)
- Sparkline per session showing tokens-over-time
- Tool names highlighted by category color
- Error events shown in red/bold

**Idle state:** "Waiting for sessions..." with blinking cursor

---

### Pattern 3: Cyberpunk HUD (Vanta.js + React)

**Libraries:** [Vanta.js](https://www.vantajs.com/) (NET or HALO effect), React, Framer Motion
**Stack:** React + Vite + Vanta.js background + Framer Motion

**Layout:**
- Full-screen Vanta.js animated background (NET or GLOBE effect)
- Floating translucent HUD panels with glassmorphism
- Center: radial layout with session nodes orbiting a core
- Each node pulses on activity, trails on tool calls
- Left HUD: aggregate metrics with animated counters
- Right HUD: selected session deep-dive
- Bottom ticker: scrolling event feed

**Key visuals:**
- Session nodes: size = token count, pulse speed = activity frequency
- Connections between sessions and center pulse with data flow
- Tool categories = different glow colors on nodes
- Cost accumulator as an animated ring/arc
- New session appears with "materializing" animation
- Session timeout = "dissolving" particle effect

**Idle state:** Vanta background runs with "STANDBY" text and dim HUD panels

---

### Pattern 4: Isometric World Visualizer (Phaser.js)

**Already implemented** in the parent project (`../`). Reference implementation.

Key decisions made:
- 20x20 isometric tile grid
- Agents positioned by tool category (exploration=top-left, creation=top-right, etc.)
- Tiles tinted by status (backlog/in-progress/completed/error)
- Agents have neutral body + colored outline by type
- Particle emitters for movement trails and active work
- Mock agents shown when no real sessions exist

---

### Pattern 5: Grafana Integration Shell

**Libraries:** Grafana + Prometheus (or JSON API datasource plugin)
**Stack:** Docker (Grafana + Prometheus) + small metrics exporter sidecar

**Architecture:**
```
telemetry-server (/api/sessions)
       ↓ (scraped every 15s)
  prometheus-exporter (port 9090)
       ↓
  Prometheus → Grafana dashboards
```

**Exporter metrics to expose:**
```
claude_sessions_active{} gauge
claude_tokens_total{session_id="..."} counter
claude_cost_usd_total{session_id="..."} counter
claude_latency_ms{session_id="...", quantile="0.5|0.9|0.99"} summary
claude_tool_calls_total{session_id="...", tool="...", category="..."} counter
claude_errors_total{session_id="..."} counter
```

**Grafana panels:**
- Sessions over time (graph)
- Cost accumulation (graph)
- Token usage by session (stacked bar)
- Tool category distribution (pie chart)
- Latency heatmap
- Error rate (stat panel with threshold colors)
- Session table (sortable by cost/tokens/activity)

**Idle state:** Panels show "No data" with Grafana's built-in empty state

---

## Session Lifecycle & State Machine

Sessions transition through three distinct states:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   ACTIVE                    ENDED                     ARCHIVED          │
│   ──────                    ─────                     ────────          │
│   ended: false              ended: true               (separate store)  │
│   In: /api/sessions         In: /api/sessions         In: /api/archived │
│                                                                         │
│   ┌──────────┐  session_end  ┌──────────┐  DELETE     ┌──────────┐     │
│   │  ACTIVE  │ ────────────► │  ENDED   │ ──────────► │ ARCHIVED │     │
│   └──────────┘    event      └──────────┘  (default)  └──────────┘     │
│        │                          │                                     │
│        │                          │         DELETE                      │
│        │                          │        ?hard=true                   │
│        ▼                          ▼            │                        │
│   lastActivity              Stays in           ▼                        │
│   updates on                /api/sessions    DELETED                    │
│   every event               indefinitely    (permanent)                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**State definitions:**

| State | `ended` | Visible in | Description |
|-------|---------|------------|-------------|
| **ACTIVE** | `false` | `/api/sessions` | Running session, receiving events |
| **ENDED** | `true` | `/api/sessions` | Received `session_end`, still visible for reference |
| **ARCHIVED** | `true` | `/api/archived` | Explicitly removed via `DELETE`, preserved for aggregate history |

**Key behaviors:**

- **ACTIVE → ENDED:** Automatic when `session_end` event received. Session stays in `/api/sessions` with `ended: true`. No automatic garbage collection.

- **ENDED → ARCHIVED:** Manual via `DELETE /api/sessions/:id`. Session moves to `/api/archived` and contributes to `lifetime` totals.

- **Hard delete:** `DELETE /api/sessions/:id?hard=true` permanently removes the session (skips archive). Use sparingly — affects aggregate history accuracy.

**Restore from archive:** Not currently supported. Archived sessions are preserved for historical accuracy but cannot be moved back to active. If you need session data, retrieve it via `GET /api/archived?id=<sessionId>`.

**Persistence:** Sessions are saved to `~/.claude/backups/dashboards/<DASHBOARD_NAME>/` in 12-hour timestamped files and survive server restarts.

**Frontend handling:**
- **ACTIVE:** Show activity indicator, update metrics in real-time
- **ENDED:** Gray out, show "completed" state, keep visible
- **ARCHIVED:** Remove from main view, optionally show in history panel

Diff current vs previous poll response to detect additions/removals.

---

## Data Continuity & Aggregate History

The server maintains aggregate metrics history independently of individual sessions, solving the problem of chart drops when sessions end or are archived.

### The Problem

When charting total tokens/cost across all sessions, removing a session (via end or delete) causes the aggregate to drop suddenly, creating misleading visualizations. For example:
- Session A has 100K tokens, Session B has 50K tokens → chart shows 150K
- Session A ends and is deleted → chart drops to 50K
- This looks like usage decreased, but it didn't

### The Solution

**Aggregate History** (`GET /api/aggregate-history`):
- Server-level time-series that tracks totals independently
- Includes both active and archived session data
- Persists across session lifecycle changes
- Aligned to minute boundaries for consistent charting

**Granularity & Retention:**

| Aspect | Value | Notes |
|--------|-------|-------|
| **Interval** | 1 minute | Aligned to clock (`:00` seconds) |
| **Retention** | 1440 points | 24 hours of history |
| **Capture trigger** | Every 60 seconds | Plus on `session_end` and `DELETE` |
| **Deduplication** | Per-minute | Only one snapshot per aligned minute |

The same limits apply to per-session `tokenHistory` arrays (1440 points max, 24h retention).

**Session Archiving** (soft-delete):
- `DELETE /api/sessions/:id` archives by default instead of removing
- Archived sessions contribute to aggregate totals
- Use `?hard=true` for permanent deletion if needed
- Archived sessions available via `GET /api/archived`

**Lifetime Totals** (in `GET /api/sessions` response):
```json
{
  "aggregate": { ... },  // Active sessions only
  "lifetime": {          // Active + archived sessions
    "totalTokens": 500000,
    "totalCost": 0.50,
    "totalToolCalls": 200,
    "totalSessions": 10,
    "archivedSessions": 7
  }
}
```

### Chart Implementation with Aggregate History

```javascript
// Fetch aggregate history for the last 60 minutes
const res = await fetch('/api/aggregate-history?minutes=60');
const { history, current } = await res.json();

// history is already aligned to minute boundaries
const chartData = history.map(point => ({
  time: new Date(point.timestamp).toLocaleTimeString(),
  tokens: point.totalTokens,
  cost: point.totalCost,
  sessions: point.activeSessions,
}));

// Use current for real-time display
console.log(`Total: ${current.totalTokens} tokens ($${current.totalCost})`);
```

### File Format (Updated)

The 12-hour rotation files now use a structured format:

```json
{
  "sessions": [...],           // Active sessions
  "archived": [...],           // Archived sessions
  "aggregateHistory": [...]    // Minute-aligned aggregate snapshots
}
```

Legacy files (plain arrays) are still supported for backward compatibility.

---

## Resource Attributes (from Claude Code OTLP)

These are at the resource level (same for all records in a batch):

| Key | Example |
|-----|---------|
| `host.arch` | `"arm64"` |
| `os.type` | `"darwin"` |
| `os.version` | `"25.2.0"` |
| `service.name` | `"claude-code"` |
| `service.version` | `"2.1.7"` |

Note: `session.id` is NOT in resource attributes — it's per-record in log record attributes.
