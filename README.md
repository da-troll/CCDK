<p align="center">
  <h1 align="center">CCDK</h1>
  <p align="center">
    <strong>A telemetry dashboard kit for visualizing AI agent activity in real-time</strong>
  </p>
  <p align="center">
    <a href="#features">Features</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#api-reference">API</a> •
    <a href="#building-your-dashboard">Build Your Own</a> •
    <a href="#architecture">Architecture</a>
  </p>
</p>

---

## What is CCDK?

CCDK (Code Dashboard Kit) is a lightweight telemetry server and frontend starter for building dashboards that visualize AI agent sessions. Track tokens, costs, tool usage, and performance metrics across multiple concurrent sessions.

```
┌─────────────────┐      OTLP       ┌─────────────────┐      REST API      ┌─────────────────┐
│   AI Agents     │ ──────────────► │   CCDK Server   │ ◄────────────────► │   Dashboard UI  │
│  (any source)   │   /v1/logs      │   (port 4318)   │   /api/sessions    │  (your design)  │
└─────────────────┘   /v1/metrics   └─────────────────┘                    └─────────────────┘
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Real-time Tracking** | Monitor active sessions with 5-second polling |
| **Token Analytics** | Track input, output, and cache tokens per session |
| **Cost Monitoring** | Cumulative cost tracking in USD |
| **Tool History** | Last 20 tool invocations with timing data |
| **Multi-Dashboard** | Run multiple isolated dashboard instances |
| **Data Persistence** | 12-hour file rotation, survives restarts |
| **Aggregate History** | Minute-aligned metrics for stable charts |
| **Session Archiving** | Soft-delete with historical preservation |

---

## Quick Start

### 1. Install & Run

```bash
git clone https://github.com/da-troll/ccdk.git
cd ccdk
npm run install:all     # Install server + frontend dependencies
npm run dev             # Start server (4318) + frontend (5173)
```

Open **http://localhost:5173** to see the starter dashboard.

### 2. Configure Telemetry Export

Set these environment variables where your AI agents run:

```bash
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Add to `~/.zshrc` or `~/.bashrc` for persistent configuration.

---

## API Reference

### Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | All active sessions with metrics |
| `/api/sessions?id=<id>` | GET | Single session by ID |
| `/api/sessions/:id` | DELETE | Archive session (soft-delete) |
| `/api/sessions/:id?hard=true` | DELETE | Permanent delete |

### Analytics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/aggregate-history` | GET | Time-series totals (1-min intervals, 24h retention) |
| `/api/aggregate-history?minutes=60` | GET | Last N minutes of history |
| `/api/archived` | GET | All archived sessions |

### System

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server status and counts |
| `/api/config` | GET | Current configuration |
| `/api/config` | POST | Update backup directory |
| `/api/archives` | GET | List historical data files |
| `/api/archives/:filename` | GET | Load specific archive |

### OTLP Receiver

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/logs` | POST | Receive OTLP log records |
| `/v1/metrics` | POST | Receive OTLP metrics |
| `/v1/traces` | POST | Ignored (returns 200 OK) |

---

## Session Data Model

Each session includes:

```javascript
{
  id: "uuid",
  sessionName: "project-name",      // Derived from working directory
  workingDir: "/path/to/project",

  // Timing
  createdAt: 1706100000000,
  lastActivity: 1706100000000,
  ended: false,

  // Tokens
  totalTokens: 58162,
  inputTokens: 10,
  outputTokens: 154,
  cacheReadTokens: 57821,
  cacheCreationTokens: 331,

  // Cost & Performance
  totalCost: 0.0348,               // USD
  totalLatencyMs: 5087,
  requestCount: 1,

  // Tools
  lastTool: "Edit",
  toolCallCount: 47,
  toolHistory: [                   // Last 20 tools
    { name: "Edit", timestamp: ..., success: true, durationMs: 120 }
  ],

  // Charts
  tokenHistory: [                  // Up to 1440 points (24h)
    { timestamp: ..., input: 10, output: 154, cache: 57821, cost: 0.0348 }
  ],

  // Errors
  errorCount: 0,
  lastError: null
}
```

---

## Building Your Dashboard

### Project Setup

1. Clone CCDK and rename to `server`:

```bash
cp -r ccdk my-dashboard/server
cd my-dashboard/server
npm run install:all
```

2. Update `package.json` with your project name

3. Build your frontend in `frontend/` or as a sibling directory

### Recommended Structure

```
my-dashboard/
├── server/              # CCDK backend
│   ├── server.js
│   ├── hooks/
│   └── frontend/        # Starter template
└── README.md
```

### Frontend Starter

The `frontend/` directory includes a React + TypeScript + Vite template with:

- **TanStack Query** — 5-second polling with caching
- **Zustand** — Lightweight state management
- **Pre-built hooks** — `useSessions()` with lifecycle callbacks
- **Formatters** — `formatTokens()`, `formatCost()`, `formatLatency()`
- **Constants** — Tool categories and colors

```typescript
// Example: Using the sessions hook
import { useSessions } from './hooks/useSessions';

function Dashboard() {
  const { data, isLoading } = useSessions({
    onSessionAdded: (session) => console.log('New:', session.id),
    onSessionRemoved: (id) => console.log('Gone:', id),
  });

  return (
    <div>
      {data?.sessions.map(s => (
        <SessionCard key={s.id} session={s} />
      ))}
    </div>
  );
}
```

---

## Multi-Dashboard Support

Run multiple isolated dashboard instances:

```bash
# Default instance
npm run dev:server

# Named instances with separate storage
DASHBOARD_NAME=work PORT=4318 npm run dev:server
DASHBOARD_NAME=personal PORT=4319 npm run dev:server
```

Each dashboard maintains separate:
- Session history
- Archived sessions
- Aggregate metrics
- Configuration

Storage location: `~/.claude/backups/dashboards/<DASHBOARD_NAME>/`

---

## Architecture

### Data Flow

```
AI Agent Activity
       │
       ▼
┌──────────────────┐
│  OTLP Receiver   │ ◄── POST /v1/logs, /v1/metrics
│  (port 4318)     │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Session Store   │ ◄── In-memory Map<sessionId, Session>
│  + Persistence   │ ──► ~/.claude/backups/dashboards/
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   REST API       │ ◄── GET /api/sessions
│                  │ ◄── GET /api/aggregate-history
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Dashboard UI    │ ◄── Poll every 5 seconds
│  (your design)   │
└──────────────────┘
```

### Session Lifecycle

```
ACTIVE ──────────► ENDED ──────────► ARCHIVED
(receiving events)   (session_end)     (DELETE)
     │                    │                │
     │                    │                │
     ▼                    ▼                ▼
 /api/sessions       /api/sessions    /api/archived
```

### File Persistence

- **Rotation:** 12-hour windows (`YYYY-MM-DD-HHMM.json`)
- **Location:** `~/.claude/backups/dashboards/<name>/`
- **Format:** JSON with sessions, archived, and aggregateHistory

---

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4318` | Server listen port |
| `DASHBOARD_NAME` | `default` | Isolates storage per dashboard |

### Hooks

| Variable | Default | Description |
|----------|---------|-------------|
| `DASH_TELEMETRY_URL` | `http://localhost:4318` | Target server URL |

---

## Tool Categories

Built-in categorization for visual grouping:

| Category | Tools | Color |
|----------|-------|-------|
| **Exploration** | Read, Glob, Grep, LS, View | `#3B82F6` Blue |
| **Creation** | Edit, Write, MultiEdit | `#10B981` Green |
| **Execution** | Bash, Task, RunCode | `#F59E0B` Amber |
| **Research** | WebSearch, WebFetch | `#8B5CF6` Purple |
| **Coordination** | TodoWrite, AskUser | `#EC4899` Pink |

---

## Commands

```bash
npm run install:all   # Install server + frontend deps
npm run dev           # Start both (server:4318, frontend:5173)
npm run dev:server    # Server only
npm run dev:frontend  # Frontend only
npm run build         # Production build
npm start             # Production server
npm test              # Integration tests
```

---

## License

MIT

---

<p align="center">
  <sub>Built for visualizing AI agent activity</sub>
</p>
