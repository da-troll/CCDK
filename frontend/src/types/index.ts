/**
 * TypeScript type definitions for Claude Code telemetry data.
 * These types match the server's API response format.
 */

/** Tool execution history entry */
export interface ToolHistoryEntry {
  name: string
  timestamp: number
  success: boolean
  durationMs: number
}

/** Token usage snapshot for time-series charts */
export interface TokenHistoryEntry {
  timestamp: number
  input: number
  output: number
  cache: number
  cost: number
}

/** Individual Claude Code session */
export interface Session {
  id: string
  createdAt: number
  lastActivity: number
  ended: boolean
  // Session identification
  sessionName: string | null
  workingDir: string | null
  // Sub-agent info (null for main sessions)
  subagentType: string | null
  parentSessionId: string | null
  // Tool tracking
  lastTool: string | null
  lastEventName: string | null
  toolCallCount: number
  toolHistory: ToolHistoryEntry[]
  // Token usage
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  // Cost & performance
  totalCost: number
  totalLatencyMs: number
  requestCount: number
  // Token history for charts
  tokenHistory: TokenHistoryEntry[]
  // Errors
  errorCount: number
  lastError: string | null
  // Model info
  model: string | null
}

/** Aggregate metrics across all sessions */
export interface Aggregate {
  totalTokens: number
  totalCost: number
  avgLatencyMs: number
  errorRate: number
  totalSessions: number
  totalToolCalls: number
}

/** API response from GET /api/sessions */
export interface ApiResponse {
  timestamp: number
  sessions: Session[]
  aggregate: Aggregate
}

/** Tool category type */
export type ToolCategory = 'exploration' | 'creation' | 'execution' | 'research' | 'coordination'
