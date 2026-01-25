import { useSessions } from './hooks/useSessions'
import { formatTokens, formatCost, formatLatency } from './lib/formatters'

/**
 * Starter App component.
 * Replace this with your own dashboard implementation.
 */
export default function App() {
  const { sessions, aggregate, isLoading, isError } = useSessions()

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
        <h1>Claude Code Dashboard</h1>
        <p>Connecting to telemetry server...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
        <h1>Claude Code Dashboard</h1>
        <p style={{ color: 'red' }}>
          Error connecting to server. Make sure the telemetry server is running on port 4318.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Claude Code Dashboard</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Aggregate Metrics</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          <div>
            <strong>Sessions:</strong> {aggregate.totalSessions}
          </div>
          <div>
            <strong>Tokens:</strong> {formatTokens(aggregate.totalTokens)}
          </div>
          <div>
            <strong>Cost:</strong> {formatCost(aggregate.totalCost)}
          </div>
          <div>
            <strong>Avg Latency:</strong> {formatLatency(aggregate.avgLatencyMs)}
          </div>
          <div>
            <strong>Error Rate:</strong> {aggregate.errorRate.toFixed(1)}%
          </div>
          <div>
            <strong>Tool Calls:</strong> {aggregate.totalToolCalls}
          </div>
        </div>
      </section>

      <section>
        <h2>Active Sessions ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <p>No active sessions. Start a Claude Code session to see it here.</p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <li key={session.id} style={{ marginBottom: '1rem' }}>
                <strong>{session.sessionName || session.id.slice(0, 8)}</strong>
                {session.model && <span> ({session.model})</span>}
                <br />
                <small>
                  Tokens: {formatTokens(session.totalTokens)} |
                  Cost: {formatCost(session.totalCost)} |
                  Tools: {session.toolCallCount}
                  {session.lastTool && ` | Last: ${session.lastTool}`}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
