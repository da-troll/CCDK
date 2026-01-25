#!/bin/bash
# Quick test: starts server, sends fake OTLP events, verifies /api/sessions response
# Usage: bash test-server.sh

echo "Starting server..."
node server.js &
SERVER_PID=$!
sleep 2

echo ""
echo "=== Sending fake api_request event ==="
curl -s -X POST http://localhost:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{
    "resourceLogs": [{
      "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "claude-code"}}]},
      "scopeLogs": [{"logRecords": [{
        "attributes": [
          {"key": "session.id", "value": {"stringValue": "test-session-1"}},
          {"key": "event.name", "value": {"stringValue": "api_request"}},
          {"key": "model", "value": {"stringValue": "claude-opus-4-5-20251101"}},
          {"key": "input_tokens", "value": {"stringValue": "500"}},
          {"key": "output_tokens", "value": {"stringValue": "200"}},
          {"key": "cache_read_tokens", "value": {"stringValue": "10000"}},
          {"key": "cost_usd", "value": {"stringValue": "0.025"}},
          {"key": "duration_ms", "value": {"stringValue": "3200"}}
        ]
      }]}]
    }]
  }' > /dev/null

echo "=== Sending fake tool_result event ==="
curl -s -X POST http://localhost:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{
    "resourceLogs": [{
      "resource": {"attributes": []},
      "scopeLogs": [{"logRecords": [{
        "attributes": [
          {"key": "session.id", "value": {"stringValue": "test-session-1"}},
          {"key": "event.name", "value": {"stringValue": "tool_result"}},
          {"key": "tool_name", "value": {"stringValue": "Edit"}},
          {"key": "success", "value": {"stringValue": "true"}},
          {"key": "duration_ms", "value": {"stringValue": "150"}}
        ]
      }]}]
    }]
  }' > /dev/null

echo "=== Sending second session ==="
curl -s -X POST http://localhost:4318/v1/logs \
  -H 'Content-Type: application/json' \
  -d '{
    "resourceLogs": [{
      "resource": {"attributes": []},
      "scopeLogs": [{"logRecords": [{
        "attributes": [
          {"key": "session.id", "value": {"stringValue": "test-session-2"}},
          {"key": "event.name", "value": {"stringValue": "tool_result"}},
          {"key": "tool_name", "value": {"stringValue": "Bash"}},
          {"key": "success", "value": {"stringValue": "true"}},
          {"key": "duration_ms", "value": {"stringValue": "800"}}
        ]
      }]}]
    }]
  }' > /dev/null

echo ""
echo "=== GET /api/sessions ==="
curl -s http://localhost:4318/api/sessions | python3 -m json.tool

echo ""
echo "=== GET /api/health ==="
curl -s http://localhost:4318/api/health | python3 -m json.tool

# Cleanup
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
echo ""
echo "Done."
