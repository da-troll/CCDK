/**
 * Claude Code Telemetry Server (Generic)
 *
 * Standalone OTLP receiver that tracks all concurrent Claude Code sessions.
 * Any dashboard frontend can poll GET /api/sessions for live data.
 *
 * Features:
 *   - Multi-dashboard support with isolated storage per dashboard
 *   - Session persistence with 12-hour file rotation
 *   - Minute-interval token snapshots for charting
 *   - Configurable backup directory
 *   - Archives API for historical data
 *
 * Usage:
 *   node server.js
 *   DASHBOARD_NAME=my-dashboard node server.js
 *
 * Env vars for server:
 *   DASHBOARD_NAME    — Unique name for this dashboard instance (default: "default")
 *   PORT              — Server port (default: 4318)
 *
 * Env vars for Claude Code (set in ~/.zshrc or per-shell):
 *   export CLAUDE_CODE_ENABLE_TELEMETRY=1
 *   export OTEL_LOGS_EXPORTER=otlp
 *   export OTEL_METRICS_EXPORTER=otlp
 *   export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   export OTEL_LOGS_EXPORT_INTERVAL=2000
 */

import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { dirname, join, basename } from 'path';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// =============================================================================
// Multi-Dashboard Configuration
// =============================================================================

const PORT = process.env.PORT || 4318;
const DASHBOARD_NAME = process.env.DASHBOARD_NAME || 'default';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

// Base paths - these are created if they don't exist
const CLAUDE_DIR = join(process.env.HOME, '.claude');
const BACKUPS_DIR = join(CLAUDE_DIR, 'backups');
const DASHBOARDS_DIR = join(BACKUPS_DIR, 'dashboards');

// Dashboard-specific paths
const DASHBOARD_DIR = join(DASHBOARDS_DIR, DASHBOARD_NAME);
const CONFIG_FILE = join(DASHBOARD_DIR, 'config.json');

// Validate dashboard name (alphanumeric, hyphens, underscores only)
if (!/^[a-zA-Z0-9_-]+$/.test(DASHBOARD_NAME)) {
  console.error(`[!] Invalid DASHBOARD_NAME: "${DASHBOARD_NAME}"`);
  console.error('    Use only letters, numbers, hyphens, and underscores.');
  process.exit(1);
}

// Ensure directory hierarchy exists
function ensureDirectoryHierarchy() {
  const directories = [CLAUDE_DIR, BACKUPS_DIR, DASHBOARDS_DIR, DASHBOARD_DIR];
  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`[*] Created directory: ${dir}`);
    }
  }
}

// Create directories on startup
ensureDirectoryHierarchy();

// Config state (per-dashboard)
let config = {
  backupDir: DASHBOARD_DIR, // Default to dashboard's own directory
  dashboardName: DASHBOARD_NAME,
};
let currentDataFile = null; // The current 12-hour window file

// =============================================================================
// Aggregate History (persistent across session lifecycle)
// =============================================================================

// Stores total metrics over time, independent of individual sessions
// This prevents chart drops when sessions end or are archived
const aggregateHistory = []; // [{timestamp, totalTokens, totalCost, activeSessions, totalToolCalls}]
const MAX_AGGREGATE_HISTORY = 1440; // 24 hours at 1-minute intervals

// Archived sessions (soft-deleted, preserved for historical accuracy)
const archivedSessions = new Map(); // sessionId -> SessionState

// =============================================================================
// Session State
// =============================================================================

const sessions = new Map(); // sessionId -> SessionState

function createSession(sessionId) {
  return {
    id: sessionId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    ended: false,
    endedAt: null,      // Timestamp when session_end received
    archivedAt: null,   // Timestamp when session was archived (soft-deleted)
    // Session identification
    sessionName: null,       // User-friendly name (from cwd folder name)
    workingDir: null,        // Working directory path
    // Sub-agent info (null for main sessions)
    subagentType: null,      // e.g., "Explore", "Plan", "Bash"
    parentSessionId: null,   // ID of parent session if this is a sub-agent
    // Tool tracking
    lastTool: null,
    lastEventName: null,
    toolCallCount: 0,
    toolHistory: [],       // last 20 tools used [{name, timestamp, success, durationMs}]
    // Cost & performance
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalCost: 0,
    totalLatencyMs: 0,
    requestCount: 0,
    // Token history for charts [{timestamp, input, output, cache, cost}]
    tokenHistory: [],
    // Errors
    errorCount: 0,
    lastError: null,
    // Model info
    model: null,
  };
}

// =============================================================================
// Config Persistence
// =============================================================================

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, 'utf8');
      const loaded = JSON.parse(raw);
      // Merge loaded config but preserve dashboard name from env
      config = { ...config, ...loaded, dashboardName: DASHBOARD_NAME };
    }
  } catch (err) {
    console.error('[!] Failed to load config:', err.message);
  }
  // Ensure backupDir exists
  if (!existsSync(config.backupDir)) {
    mkdirSync(config.backupDir, { recursive: true });
  }
}

function saveConfig() {
  try {
    ensureDirectoryHierarchy();
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[!] Failed to save config:', err.message);
  }
}

// =============================================================================
// 12-Hour Window File Persistence
// =============================================================================

function parseTimestampFromFilename(filename) {
  // Format: YYYY-MM-DD-HHMM.json
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.json$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).getTime();
}

function generateTimestampFilename() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0'),
  ];
  return `${parts.join('-')}.json`;
}

function findMostRecentFile() {
  if (!existsSync(config.backupDir)) return null;

  const files = readdirSync(config.backupDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f))
    .sort()
    .reverse();

  return files.length > 0 ? files[0] : null;
}

function initializeDataFile() {
  if (!existsSync(config.backupDir)) {
    mkdirSync(config.backupDir, { recursive: true });
  }

  const mostRecent = findMostRecentFile();

  if (mostRecent) {
    const fileTimestamp = parseTimestampFromFilename(mostRecent);
    const now = Date.now();

    if (fileTimestamp && (now - fileTimestamp) < TWELVE_HOURS_MS) {
      // Use existing file (within 12-hour window)
      currentDataFile = join(config.backupDir, mostRecent);
      console.log(`[*] Using existing file: ${mostRecent}`);
    } else {
      // Create new file (12 hours have passed)
      const newFilename = generateTimestampFilename();
      currentDataFile = join(config.backupDir, newFilename);
      console.log(`[*] Creating new 12-hour file: ${newFilename}`);
    }
  } else {
    // No existing files, create first one
    const newFilename = generateTimestampFilename();
    currentDataFile = join(config.backupDir, newFilename);
    console.log(`[*] Creating first file: ${newFilename}`);
  }
}

function loadSessions() {
  try {
    if (currentDataFile && existsSync(currentDataFile)) {
      const raw = readFileSync(currentDataFile, 'utf8');
      const data = JSON.parse(raw);

      // Handle both old format (array) and new format (object with sessions, archived, aggregateHistory)
      if (Array.isArray(data)) {
        // Legacy format: just an array of sessions
        for (const s of data) {
          sessions.set(s.id, s);
        }
        console.log(`[*] Loaded ${data.length} sessions from ${basename(currentDataFile)}`);
      } else if (data && typeof data === 'object') {
        // New format with separate sections
        if (Array.isArray(data.sessions)) {
          for (const s of data.sessions) {
            sessions.set(s.id, s);
          }
        }
        if (Array.isArray(data.archived)) {
          for (const s of data.archived) {
            archivedSessions.set(s.id, s);
          }
        }
        if (Array.isArray(data.aggregateHistory)) {
          aggregateHistory.push(...data.aggregateHistory);
          // Trim to max size
          while (aggregateHistory.length > MAX_AGGREGATE_HISTORY) {
            aggregateHistory.shift();
          }
        }
        console.log(`[*] Loaded ${sessions.size} sessions, ${archivedSessions.size} archived, ${aggregateHistory.length} aggregate points from ${basename(currentDataFile)}`);
      }
    }
  } catch (err) {
    console.error('[!] Failed to load sessions:', err.message);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    checkAndRotateFile();
    try {
      if (!existsSync(config.backupDir)) {
        mkdirSync(config.backupDir, { recursive: true });
      }
      // Save in new format with sessions, archived, and aggregateHistory
      const data = {
        sessions: [...sessions.values()],
        archived: [...archivedSessions.values()],
        aggregateHistory: aggregateHistory,
      };
      writeFileSync(currentDataFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[!] Failed to save sessions:', err.message);
    }
  }, 2000); // debounce 2s
}

function checkAndRotateFile() {
  if (!currentDataFile) return;

  const currentFilename = basename(currentDataFile);
  const fileTimestamp = parseTimestampFromFilename(currentFilename);

  if (fileTimestamp && (Date.now() - fileTimestamp) >= TWELVE_HOURS_MS) {
    // Time to create a new file
    const newFilename = generateTimestampFilename();
    currentDataFile = join(config.backupDir, newFilename);
    console.log(`[*] Rotated to new 12-hour file: ${newFilename}`);
  }
}

// Initialize on startup
loadConfig();
initializeDataFile();
loadSessions();

// =============================================================================
// Timestamp Alignment
// =============================================================================

// Align timestamp to nearest minute boundary for consistent charting
function alignToMinute(timestamp) {
  return Math.floor(timestamp / 60000) * 60000;
}

// =============================================================================
// Minute-Interval Token Snapshots
// =============================================================================

// Take a snapshot of all active sessions every minute for accurate charting
const SNAPSHOT_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_TOKEN_HISTORY = 1440; // 24 hours worth at 1-minute intervals

function takeTokenSnapshots() {
  const now = Date.now();
  const alignedNow = alignToMinute(now);
  let hasChanges = false;

  for (const session of sessions.values()) {
    // Only snapshot active sessions (activity in last 5 minutes)
    if (session.ended || now - session.lastActivity > 5 * 60 * 1000) continue;

    // Check if we need a new snapshot (avoid duplicates within same minute)
    const lastSnapshot = session.tokenHistory[session.tokenHistory.length - 1];
    if (lastSnapshot && alignToMinute(lastSnapshot.timestamp) === alignedNow) continue;

    // Only add snapshot if there are actual tokens
    if (session.inputTokens > 0 || session.outputTokens > 0 || session.cacheReadTokens > 0) {
      session.tokenHistory.push({
        timestamp: alignedNow,
        input: session.inputTokens,
        output: session.outputTokens,
        cache: session.cacheReadTokens,
        cost: session.totalCost,
      });

      // Keep up to 24 hours of history
      if (session.tokenHistory.length > MAX_TOKEN_HISTORY) {
        session.tokenHistory.shift();
      }
      hasChanges = true;
    }
  }

  // Always capture aggregate snapshot (includes archived sessions for continuity)
  captureAggregateSnapshot(alignedNow);

  if (hasChanges) {
    scheduleSave();
  }
}

// Capture aggregate metrics snapshot (independent of individual sessions)
function captureAggregateSnapshot(alignedTimestamp) {
  // Check if we already have a snapshot for this minute
  const lastAggregate = aggregateHistory[aggregateHistory.length - 1];
  if (lastAggregate && lastAggregate.timestamp === alignedTimestamp) return;

  // Sum across ALL sessions (active + archived) for true historical accuracy
  let totalTokens = 0, totalCost = 0, totalToolCalls = 0;
  let activeSessions = 0;

  for (const s of sessions.values()) {
    totalTokens += s.totalTokens;
    totalCost += s.totalCost;
    totalToolCalls += s.toolCallCount;
    if (!s.ended) activeSessions++;
  }

  // Include archived sessions in totals (they contributed to history)
  for (const s of archivedSessions.values()) {
    totalTokens += s.totalTokens;
    totalCost += s.totalCost;
    totalToolCalls += s.toolCallCount;
  }

  aggregateHistory.push({
    timestamp: alignedTimestamp,
    totalTokens,
    totalCost,
    activeSessions,
    totalToolCalls,
  });

  // Keep up to 24 hours
  if (aggregateHistory.length > MAX_AGGREGATE_HISTORY) {
    aggregateHistory.shift();
  }
}

// Capture final snapshot for a session (called on session_end)
function captureFinalSessionSnapshot(session) {
  const alignedNow = alignToMinute(Date.now());

  // Always capture final state, even if recent snapshot exists
  session.tokenHistory.push({
    timestamp: alignedNow,
    input: session.inputTokens,
    output: session.outputTokens,
    cache: session.cacheReadTokens,
    cost: session.totalCost,
    final: true, // Mark as final snapshot
  });

  // Keep up to 24 hours of history
  if (session.tokenHistory.length > MAX_TOKEN_HISTORY) {
    session.tokenHistory.shift();
  }
}

// Start snapshot interval
setInterval(takeTokenSnapshots, SNAPSHOT_INTERVAL_MS);
console.log('[*] Token snapshot interval started (1 min)');

// =============================================================================
// OTLP Attribute Extraction
// =============================================================================

function extractAttributes(attrs) {
  const result = {};
  if (!Array.isArray(attrs)) return result;
  for (const attr of attrs) {
    if (!attr.key || !attr.value) continue;
    result[attr.key] = attr.value.stringValue
      ?? attr.value.intValue
      ?? attr.value.doubleValue
      ?? attr.value.boolValue
      ?? null;
  }
  return result;
}

// =============================================================================
// OTLP Log Processing
// =============================================================================

/**
 * Known event types from Claude Code:
 *   - api_request:    LLM API call (has tokens, cost, duration, model)
 *   - api_error:      LLM API error
 *   - tool_result:    Tool execution result (has tool_name, success, duration_ms)
 *   - tool_decision:  Tool selected for execution
 *   - user_prompt:    User sent a message (requires OTEL_LOG_USER_PROMPTS=1)
 *   - session_end:    Session has ended
 */
function processIncomingLogs(resourceLogs) {
  if (!Array.isArray(resourceLogs)) return;

  for (const rl of resourceLogs) {
    const scopeLogs = rl.scopeLogs || [];
    for (const sl of scopeLogs) {
      const logRecords = sl.logRecords || [];
      for (const record of logRecords) {
        const attrs = extractAttributes(record.attributes);
        const sessionId = attrs['session.id'];
        if (!sessionId) continue;

        // Get or create session
        if (!sessions.has(sessionId)) {
          sessions.set(sessionId, createSession(sessionId));
          console.log(`[+] Session ${sessionId.slice(0, 8)}...`);
        }
        const session = sessions.get(sessionId);
        session.lastActivity = Date.now();
        session.lastEventName = attrs['event.name'] || session.lastEventName;

        // Capture sub-agent info if present
        if (attrs['subagent_type'] || attrs['subagent.type'] || attrs['agent_type']) {
          session.subagentType = attrs['subagent_type'] || attrs['subagent.type'] || attrs['agent_type'];
        }
        if (attrs['parent_session_id'] || attrs['parent.session.id']) {
          session.parentSessionId = attrs['parent_session_id'] || attrs['parent.session.id'];
        }

        // Capture session name and working directory
        const cwd = attrs['cwd'] || attrs['working_dir'] || attrs['working_directory'];
        if (cwd && !session.workingDir) {
          session.workingDir = cwd;
          // Derive session name from last folder in path if not explicitly set
          if (!session.sessionName) {
            const parts = cwd.replace(/\/$/, '').split('/');
            session.sessionName = parts[parts.length - 1] || null;
          }
        }
        // Explicit session name overrides derived name
        const explicitName = attrs['session.name'] || attrs['session_name'] || attrs['terminal.title'];
        if (explicitName) {
          session.sessionName = explicitName;
        }

        const eventName = attrs['event.name'];

        if (eventName === 'tool_result') {
          session.toolCallCount++;
          const toolName = attrs['tool_name'] || null;
          const success = attrs['success'] !== 'false' && attrs['success'] !== false;
          const durationMs = Number(attrs['duration_ms']) || 0;
          session.lastTool = toolName;

          // Keep last 20 tools
          session.toolHistory.push({
            name: toolName,
            timestamp: Date.now(),
            success,
            durationMs,
          });
          if (session.toolHistory.length > 20) {
            session.toolHistory.shift();
          }

          if (!success) {
            session.errorCount++;
          }
        }

        if (eventName === 'api_request') {
          const inputTokens = Number(attrs['input_tokens']) || 0;
          const outputTokens = Number(attrs['output_tokens']) || 0;
          const cacheReadTokens = Number(attrs['cache_read_tokens']) || 0;
          const cacheCreationTokens = Number(attrs['cache_creation_tokens']) || 0;
          const costUsd = Number(attrs['cost_usd']) || 0;
          const durationMs = Number(attrs['duration_ms']) || 0;

          session.inputTokens += inputTokens;
          session.outputTokens += outputTokens;
          session.cacheReadTokens += cacheReadTokens;
          session.cacheCreationTokens += cacheCreationTokens;
          session.totalTokens += inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
          session.totalCost += costUsd;
          session.totalLatencyMs += durationMs;
          session.requestCount++;
          session.model = attrs['model'] || session.model;

          // Capture token snapshot for historical chart (on each API request)
          session.tokenHistory.push({
            timestamp: Date.now(),
            input: session.inputTokens,
            output: session.outputTokens,
            cache: session.cacheReadTokens,
            cost: session.totalCost,
          });
          // Keep up to 24 hours of history (1440 minutes)
          if (session.tokenHistory.length > MAX_TOKEN_HISTORY) {
            session.tokenHistory.shift();
          }
        }

        if (eventName === 'api_error') {
          session.errorCount++;
          session.requestCount++;
          session.lastError = attrs['error_message'] || attrs['error'] || 'unknown';
        }

        if (eventName === 'session_end') {
          session.ended = true;
          session.endedAt = Date.now();
          // Capture final snapshot to preserve ending state
          captureFinalSessionSnapshot(session);
          // Capture aggregate snapshot to maintain continuity
          captureAggregateSnapshot(alignToMinute(Date.now()));
        }

        scheduleSave();
      }
    }
  }
}

// =============================================================================
// OTLP Metrics Processing
// =============================================================================

function processIncomingMetrics(resourceMetrics) {
  if (!Array.isArray(resourceMetrics)) return;

  for (const rm of resourceMetrics) {
    const scopeMetrics = rm.scopeMetrics || [];
    for (const sm of scopeMetrics) {
      const metrics = sm.metrics || [];
      for (const m of metrics) {
        const dataPoints = m.sum?.dataPoints || m.gauge?.dataPoints || [];
        for (const dp of dataPoints) {
          const dpAttrs = extractAttributes(dp.attributes);
          const sessionId = dpAttrs['session.id'];
          if (!sessionId || !sessions.has(sessionId)) continue;

          const session = sessions.get(sessionId);
          session.lastActivity = Date.now();

          const value = Number(dp.asInt ?? dp.asDouble ?? 0);
          if (m.name === 'claude_code.token.usage' && value > session.totalTokens) {
            session.totalTokens = value;
          }
          if (m.name === 'claude_code.cost.usage' && value > session.totalCost) {
            session.totalCost = value;
          }

          scheduleSave();
        }
      }
    }
  }
}

// =============================================================================
// OTLP Receiver Routes
// =============================================================================

app.post('/v1/logs', (req, res) => {
  const { resourceLogs } = req.body;
  if (resourceLogs) processIncomingLogs(resourceLogs);
  res.status(200).json({});
});

app.post('/v1/metrics', (req, res) => {
  const { resourceMetrics } = req.body;
  if (resourceMetrics) processIncomingMetrics(resourceMetrics);
  res.status(200).json({});
});

// Ignore traces
app.post('/v1/traces', (_req, res) => res.status(200).json({}));

// =============================================================================
// Dashboard API
// =============================================================================

/**
 * GET /api/sessions
 *
 * Returns all active sessions with full metrics.
 * Query params:
 *   ?id=<sessionId>  — filter to a single session
 *
 * Response: {
 *   timestamp: number,
 *   sessions: SessionState[],
 *   aggregate: { totalTokens, totalCost, avgLatencyMs, errorRate, totalSessions, totalToolCalls }
 * }
 */
app.get('/api/sessions', (req, res) => {
  const filterId = req.query.id || null;

  let sessionList = [...sessions.values()];
  if (filterId) {
    sessionList = sessionList.filter(s => s.id === filterId);
  }

  // Compute aggregates
  let totalTokens = 0, totalCost = 0, totalLatency = 0, totalRequests = 0;
  let totalErrors = 0, totalToolCalls = 0;

  for (const s of sessions.values()) {
    totalTokens += s.totalTokens;
    totalCost += s.totalCost;
    totalLatency += s.totalLatencyMs;
    totalRequests += s.requestCount;
    totalErrors += s.errorCount;
    totalToolCalls += s.toolCallCount;
  }

  // Include archived totals for complete picture
  let archivedTokens = 0, archivedCost = 0, archivedToolCalls = 0;
  for (const s of archivedSessions.values()) {
    archivedTokens += s.totalTokens;
    archivedCost += s.totalCost;
    archivedToolCalls += s.toolCallCount;
  }

  res.json({
    timestamp: Date.now(),
    sessions: sessionList,
    aggregate: {
      totalTokens,
      totalCost,
      avgLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
      errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 100 : 0,
      totalSessions: sessions.size,
      totalToolCalls,
    },
    // Lifetime totals include archived sessions (for accurate historical view)
    lifetime: {
      totalTokens: totalTokens + archivedTokens,
      totalCost: totalCost + archivedCost,
      totalToolCalls: totalToolCalls + archivedToolCalls,
      totalSessions: sessions.size + archivedSessions.size,
      archivedSessions: archivedSessions.size,
    },
  });
});

/**
 * DELETE /api/sessions/:id
 * Archive a session (soft-delete). Session data is preserved in archivedSessions
 * to maintain aggregate history accuracy. Use ?hard=true to permanently delete.
 */
app.delete('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  const hardDelete = req.query.hard === 'true';

  if (sessions.has(id)) {
    const session = sessions.get(id);

    if (hardDelete) {
      // Permanent deletion (use sparingly)
      sessions.delete(id);
      archivedSessions.delete(id); // Also remove from archive if present
      console.log(`[-] Session ${id.slice(0, 8)}... (permanently deleted)`);
      res.json({ deleted: true, archived: false });
    } else {
      // Soft delete: move to archive
      session.archivedAt = Date.now();
      if (!session.ended) {
        session.ended = true;
        session.endedAt = Date.now();
        captureFinalSessionSnapshot(session);
      }
      archivedSessions.set(id, session);
      sessions.delete(id);
      // Capture aggregate to preserve the moment of archival
      captureAggregateSnapshot(alignToMinute(Date.now()));
      console.log(`[~] Session ${id.slice(0, 8)}... (archived)`);
      res.json({ deleted: true, archived: true });
    }
    scheduleSave();
  } else if (archivedSessions.has(id)) {
    // Already archived, allow hard delete from archive
    if (hardDelete) {
      archivedSessions.delete(id);
      scheduleSave();
      console.log(`[-] Session ${id.slice(0, 8)}... (removed from archive)`);
      res.json({ deleted: true, archived: false });
    } else {
      res.json({ deleted: false, archived: true, message: 'Session already archived' });
    }
  } else {
    res.status(404).json({ error: 'session not found' });
  }
});

/**
 * GET /api/config
 * Returns current config (dashboardName, backupDir, etc.)
 */
app.get('/api/config', (_req, res) => {
  res.json({
    dashboardName: DASHBOARD_NAME,
    backupDir: config.backupDir,
    currentFile: currentDataFile ? basename(currentDataFile) : null,
  });
});

/**
 * POST /api/config
 * Update config settings (backupDir, etc.)
 * Body: { backupDir?: string }
 */
app.post('/api/config', (req, res) => {
  const { backupDir } = req.body;

  if (backupDir && typeof backupDir === 'string') {
    // Validate path exists or can be created
    try {
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }
      config.backupDir = backupDir;
      saveConfig();
      // Re-initialize data file with new directory
      initializeDataFile();
      loadSessions();
      console.log(`[*] Backup directory changed to: ${backupDir}`);
    } catch (err) {
      return res.status(400).json({ error: `Invalid path: ${err.message}` });
    }
  }

  res.json({
    dashboardName: DASHBOARD_NAME,
    backupDir: config.backupDir,
    currentFile: currentDataFile ? basename(currentDataFile) : null,
  });
});

/**
 * GET /api/archives
 * List all available archive files with metadata.
 */
app.get('/api/archives', (_req, res) => {
  try {
    if (!existsSync(config.backupDir)) {
      return res.json({ archives: [], backupDir: config.backupDir });
    }

    const files = readdirSync(config.backupDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f))
      .sort()
      .reverse(); // Most recent first

    const archives = files.map(f => {
      // Parse timestamp from filename: YYYY-MM-DD-HHMM.json
      const ts = parseTimestampFromFilename(f);
      if (!ts) return null;

      const date = new Date(ts);
      return {
        filename: f,
        date: date.toISOString(),
        label: f.replace('.json', ''),
        isCurrent: currentDataFile && basename(currentDataFile) === f,
      };
    }).filter(Boolean);

    res.json({ archives, backupDir: config.backupDir });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/archives/:filename
 * Fetch sessions from a specific archive file.
 */
app.get('/api/archives/:filename', (req, res) => {
  const { filename } = req.params;

  // Security: validate filename format (YYYY-MM-DD-HHMM.json)
  if (!/^\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename format' });
  }

  const filepath = join(config.backupDir, filename);

  try {
    if (!existsSync(filepath)) {
      return res.status(404).json({ error: 'Archive not found' });
    }

    const data = JSON.parse(readFileSync(filepath, 'utf8'));
    res.json({ sessions: data, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/aggregate-history
 * Returns the aggregate history for charting total metrics over time.
 * This data persists across session lifecycle changes (end, archive, delete).
 *
 * Query params:
 *   ?minutes=N  — limit to last N minutes (default: all, max: 1440)
 *
 * Response: {
 *   history: [{timestamp, totalTokens, totalCost, activeSessions, totalToolCalls}],
 *   current: {totalTokens, totalCost, activeSessions, archivedSessions, totalToolCalls}
 * }
 */
app.get('/api/aggregate-history', (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || MAX_AGGREGATE_HISTORY, MAX_AGGREGATE_HISTORY);
  const history = aggregateHistory.slice(-minutes);

  // Compute current totals (active + archived)
  let totalTokens = 0, totalCost = 0, totalToolCalls = 0;
  for (const s of sessions.values()) {
    totalTokens += s.totalTokens;
    totalCost += s.totalCost;
    totalToolCalls += s.toolCallCount;
  }
  for (const s of archivedSessions.values()) {
    totalTokens += s.totalTokens;
    totalCost += s.totalCost;
    totalToolCalls += s.toolCallCount;
  }

  res.json({
    history,
    current: {
      totalTokens,
      totalCost,
      activeSessions: sessions.size,
      archivedSessions: archivedSessions.size,
      totalToolCalls,
    },
  });
});

/**
 * GET /api/archived
 * Returns all archived sessions.
 *
 * Query params:
 *   ?id=<sessionId>  — filter to a single archived session
 */
app.get('/api/archived', (req, res) => {
  const filterId = req.query.id || null;

  let sessionList = [...archivedSessions.values()];
  if (filterId) {
    sessionList = sessionList.filter(s => s.id === filterId);
  }

  res.json({
    timestamp: Date.now(),
    sessions: sessionList,
    count: archivedSessions.size,
  });
});

/**
 * GET /api/health
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    dashboardName: DASHBOARD_NAME,
    activeSessions: sessions.size,
    archivedSessions: archivedSessions.size,
    aggregateHistoryPoints: aggregateHistory.length,
    uptime: process.uptime(),
  });
});

// =============================================================================
// Start
// =============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  Claude Code Telemetry Server
  ─────────────────────────────
  Dashboard: ${DASHBOARD_NAME}
  Port:      ${PORT}
  OTLP:      POST /v1/logs, /v1/metrics
  API:       GET  /api/sessions, /api/aggregate-history, /api/archived
             GET  /api/health, /api/archives, /api/config
  Storage:   ${config.backupDir}
  Current:   ${currentDataFile ? basename(currentDataFile) : '(none)'}
  Rotation:  12h → YYYY-MM-DD-HHMM.json
  Sessions:  ${sessions.size} active, ${archivedSessions.size} archived
  History:   ${aggregateHistory.length} aggregate points
  `);
});
