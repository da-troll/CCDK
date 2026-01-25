#!/usr/bin/env node

/**
 * Claude Code → Telemetry Server Hook
 *
 * Handles multiple hook events:
 * - PostToolUse: sends tool_result event with cwd
 * - UserPromptSubmit: sends keepalive (user is active)
 * - Stop: sends keepalive (Claude finished responding)
 *
 * Any event with a session_id keeps the session alive on the server.
 * The cwd attribute enables session naming from the project folder.
 */

const TELEMETRY_URL = process.env.DASH_TELEMETRY_URL || 'http://localhost:4318';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    handleEvent(data);
  } catch {
    // Silent fail — don't block Claude Code
  }
});

function handleEvent(data) {
  const { session_id, hook_event_name } = data;
  if (!session_id) return;

  // Get cwd from hook data or fall back to CLAUDE_PROJECT_DIR env var
  const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || null;

  switch (hook_event_name) {
    case 'PostToolUse':
      sendToolResult(data, cwd);
      break;
    case 'UserPromptSubmit':
      sendEvent(session_id, 'user_prompt', cwd);
      break;
    case 'Stop':
      sendEvent(session_id, 'stop', cwd);
      break;
    default:
      sendEvent(session_id, 'keepalive', cwd);
  }
}

function sendToolResult(data, cwd) {
  const { session_id, tool_name, tool_response } = data;
  if (!tool_name) return;

  const success = tool_response?.success !== false
    && !tool_response?.error
    && !tool_response?.stderr;

  const attrs = [
    { key: 'event.name', value: { stringValue: 'tool_result' } },
    { key: 'tool_name', value: { stringValue: tool_name } },
    { key: 'success', value: { boolValue: success } },
    { key: 'duration_ms', value: { intValue: 0 } },
  ];
  if (cwd) {
    attrs.push({ key: 'cwd', value: { stringValue: cwd } });
  }
  sendLog(session_id, attrs);
}

function sendEvent(sessionId, eventName, cwd) {
  const attrs = [
    { key: 'event.name', value: { stringValue: eventName } },
  ];
  if (cwd) {
    attrs.push({ key: 'cwd', value: { stringValue: cwd } });
  }
  sendLog(sessionId, attrs);
}

function sendLog(sessionId, extraAttributes) {
  const payload = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          attributes: [
            { key: 'session.id', value: { stringValue: sessionId } },
            ...extraAttributes,
          ],
        }],
      }],
    }],
  };

  fetch(`${TELEMETRY_URL}/v1/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}
