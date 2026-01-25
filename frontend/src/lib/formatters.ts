/**
 * Formatting utilities for displaying telemetry data.
 * All functions are pure and handle edge cases gracefully.
 */

/**
 * Format a token count with K/M suffixes.
 * @example formatTokens(1234) => "1.2K"
 * @example formatTokens(1234567) => "1.2M"
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`
  }
  return count.toLocaleString()
}

/**
 * Format a cost value in USD.
 * Shows more precision for small values.
 * @example formatCost(0.005) => "$0.0050"
 * @example formatCost(5.5) => "$5.50"
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`
  }
  return `$${usd.toFixed(2)}`
}

/**
 * Format latency/duration in milliseconds.
 * @example formatLatency(500) => "500ms"
 * @example formatLatency(2500) => "2.5s"
 */
export function formatLatency(ms: number): string {
  if (ms >= 60_000) {
    return `${(ms / 60_000).toFixed(1)}m`
  }
  if (ms >= 1_000) {
    return `${(ms / 1_000).toFixed(1)}s`
  }
  return `${Math.round(ms)}ms`
}

/**
 * Format a timestamp as relative time.
 * @example formatTimeAgo(Date.now() - 5000) => "5s ago"
 * @example formatTimeAgo(Date.now() - 120000) => "2m ago"
 */
export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)

  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

/**
 * Shorten a session ID for display.
 * @example formatSessionId("abc123def456") => "abc123de"
 */
export function formatSessionId(id: string, length: number = 8): string {
  return id.slice(0, length)
}

/**
 * Format a timestamp as time string.
 * @example formatTime(1706100000000) => "10:30:00 AM"
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

/**
 * Format a timestamp as date/time string.
 * @example formatDateTime(1706100000000) => "1/24/2024, 10:30:00 AM"
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

/**
 * Format a model name for display.
 * Shortens long Claude model names.
 */
export function formatModel(model: string | null): string {
  if (!model) return 'Unknown'
  if (model.includes('claude-opus-4')) return 'Opus 4'
  if (model.includes('claude-sonnet-4')) return 'Sonnet 4'
  if (model.includes('claude-haiku')) return 'Haiku'
  return model
}

/**
 * Get a display name for a session.
 * Uses sessionName if available, otherwise shortened ID.
 */
export function getSessionDisplayName(session: { sessionName: string | null; id: string }): string {
  return session.sessionName || formatSessionId(session.id)
}
