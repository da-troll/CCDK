import type { ToolCategory } from '../types'

/** Polling interval in milliseconds (5 seconds) */
export const POLL_INTERVAL = 5000

/** Number of characters to show in shortened session IDs */
export const SESSION_ID_LENGTH = 8

/** Maximum entries to keep in activity feeds */
export const MAX_FEED_ENTRIES = 50

/** Maximum latency for gauge visualizations (ms) */
export const LATENCY_MAX_MS = 10000

/**
 * Mapping of tool names to their categories.
 * Used for visual grouping and color coding.
 */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Exploration tools - reading, searching, navigating
  Read: 'exploration',
  Glob: 'exploration',
  Grep: 'exploration',
  LS: 'exploration',
  View: 'exploration',
  NotebookRead: 'exploration',

  // Creation tools - writing, editing, modifying
  Edit: 'creation',
  Write: 'creation',
  MultiEdit: 'creation',
  NotebookEdit: 'creation',

  // Execution tools - running code, commands, tasks
  Bash: 'execution',
  Task: 'execution',
  RunCode: 'execution',
  KillShell: 'execution',
  BashOutput: 'execution',

  // Research tools - web search, fetching external info
  WebSearch: 'research',
  WebFetch: 'research',

  // Coordination tools - user interaction, planning, task management
  TodoWrite: 'coordination',
  AskUser: 'coordination',
  AskUserQuestion: 'coordination',
  Skill: 'coordination',
  EnterPlanMode: 'coordination',
  ExitPlanMode: 'coordination',
}

/**
 * Colors for each tool category (CSS hex values).
 * Customize these to match your dashboard theme.
 */
export const CATEGORY_COLORS: Record<ToolCategory, string> = {
  exploration: '#3B82F6', // Blue
  creation: '#10B981',    // Green
  execution: '#F59E0B',   // Amber
  research: '#8B5CF6',    // Purple
  coordination: '#EC4899', // Pink
}

/**
 * Get the category for a tool name.
 * Returns 'exploration' as default for unknown tools.
 */
export function getToolCategory(toolName: string): ToolCategory {
  // Direct match
  if (toolName in TOOL_CATEGORIES) {
    return TOOL_CATEGORIES[toolName]
  }

  // Partial match (handles variations like "mcp__*" tools)
  for (const [tool, category] of Object.entries(TOOL_CATEGORIES)) {
    if (toolName.includes(tool)) {
      return category
    }
  }

  return 'exploration'
}

/**
 * Get the color for a tool based on its category.
 */
export function getToolColor(toolName: string): string {
  const category = getToolCategory(toolName)
  return CATEGORY_COLORS[category]
}
