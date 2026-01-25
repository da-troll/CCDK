import { create } from 'zustand'

/**
 * Example Zustand store for dashboard state.
 * Extend this with your own state needs.
 *
 * Common patterns from reference implementations:
 * - Window management (position, z-index, focus)
 * - Selected session tracking
 * - UI preferences
 */

interface DashboardState {
  /** Currently selected session ID (for detail views) */
  selectedSessionId: string | null
  /** Select a session */
  selectSession: (id: string | null) => void

  /** Whether the settings panel is open */
  settingsOpen: boolean
  /** Toggle settings panel */
  toggleSettings: () => void

  /** Connection status */
  isConnected: boolean
  /** Update connection status */
  setConnected: (connected: boolean) => void
}

/**
 * Main dashboard store.
 *
 * @example
 * ```tsx
 * function SessionCard({ session }) {
 *   const selectSession = useDashboardStore((s) => s.selectSession)
 *   return <div onClick={() => selectSession(session.id)}>...</div>
 * }
 *
 * function DetailPanel() {
 *   const selectedId = useDashboardStore((s) => s.selectedSessionId)
 *   if (!selectedId) return null
 *   return <SessionDetail id={selectedId} />
 * }
 * ```
 */
export const useDashboardStore = create<DashboardState>((set) => ({
  selectedSessionId: null,
  selectSession: (id) => set({ selectedSessionId: id }),

  settingsOpen: false,
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),

  isConnected: false,
  setConnected: (connected) => set({ isConnected: connected }),
}))
