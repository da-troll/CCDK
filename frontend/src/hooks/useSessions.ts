import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { Session, ApiResponse, Aggregate } from '../types'
import { POLL_INTERVAL } from '../lib/constants'

/**
 * Fetch sessions from the telemetry server.
 */
async function fetchSessions(): Promise<ApiResponse> {
  const response = await fetch('/api/sessions')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response.json()
}

/** Default aggregate values when no data is available */
const DEFAULT_AGGREGATE: Aggregate = {
  totalTokens: 0,
  totalCost: 0,
  avgLatencyMs: 0,
  errorRate: 0,
  totalSessions: 0,
  totalToolCalls: 0,
}

/** Options for the useSessions hook */
export interface UseSessionsOptions {
  /** Called when a new session appears */
  onSessionAdded?: (session: Session) => void
  /** Called when a session is removed */
  onSessionRemoved?: (sessionId: string) => void
  /** Called when an existing session is updated */
  onSessionUpdated?: (session: Session) => void
  /** Custom polling interval in ms (default: 5000) */
  pollInterval?: number
  /** Disable polling */
  enabled?: boolean
}

/**
 * Hook for fetching and tracking Claude Code sessions.
 *
 * Features:
 * - Automatic polling every 5 seconds
 * - Session lifecycle callbacks (added/removed/updated)
 * - Aggregate metrics calculation
 *
 * @example
 * ```tsx
 * const { sessions, aggregate, isLoading } = useSessions({
 *   onSessionAdded: (session) => console.log('New session:', session.id),
 *   onSessionRemoved: (id) => console.log('Session removed:', id),
 * })
 * ```
 */
export function useSessions(options: UseSessionsOptions = {}) {
  const {
    onSessionAdded,
    onSessionRemoved,
    onSessionUpdated,
    pollInterval = POLL_INTERVAL,
    enabled = true,
  } = options

  // Track previous session IDs for lifecycle detection
  const previousSessionIds = useRef<Set<string>>(new Set())

  const query = useQuery<ApiResponse>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    refetchInterval: enabled ? pollInterval : false,
    staleTime: pollInterval - 1000,
  })

  // Detect session lifecycle changes
  useEffect(() => {
    if (!query.data) return

    const currentIds = new Set(query.data.sessions.map((s) => s.id))
    const prevIds = previousSessionIds.current

    // Find added sessions
    const added = query.data.sessions.filter((s) => !prevIds.has(s.id))
    added.forEach((session) => {
      onSessionAdded?.(session)
    })

    // Find removed sessions
    const removed = [...prevIds].filter((id) => !currentIds.has(id))
    removed.forEach((id) => {
      onSessionRemoved?.(id)
    })

    // Report updates for existing sessions
    query.data.sessions.forEach((session) => {
      if (prevIds.has(session.id)) {
        onSessionUpdated?.(session)
      }
    })

    // Update tracking for next comparison
    previousSessionIds.current = currentIds
  }, [query.data, onSessionAdded, onSessionRemoved, onSessionUpdated])

  return {
    /** Array of all active sessions */
    sessions: query.data?.sessions ?? [],
    /** Aggregate metrics across all sessions */
    aggregate: query.data?.aggregate ?? DEFAULT_AGGREGATE,
    /** Timestamp of the last update */
    timestamp: query.data?.timestamp ?? 0,
    /** True while initial data is loading */
    isLoading: query.isLoading,
    /** True if there was an error fetching data */
    isError: query.isError,
    /** Error object if isError is true */
    error: query.error,
    /** Manually trigger a refetch */
    refetch: query.refetch,
  }
}

/**
 * Hook to detect session changes between polls.
 * Returns arrays of added and removed sessions.
 *
 * @example
 * ```tsx
 * const { added, removed } = useSessionDiff(sessions)
 *
 * useEffect(() => {
 *   added.forEach(s => animateIn(s.id))
 *   removed.forEach(id => animateOut(id))
 * }, [added, removed])
 * ```
 */
export function useSessionDiff(sessions: Session[]) {
  const previousIds = useRef<Set<string>>(new Set())

  const currentIds = new Set(sessions.map((s) => s.id))
  const added = sessions.filter((s) => !previousIds.current.has(s.id))
  const removed = [...previousIds.current].filter((id) => !currentIds.has(id))

  // Update for next render
  useEffect(() => {
    previousIds.current = currentIds
  })

  return { added, removed, current: sessions }
}
