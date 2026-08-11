#!/usr/bin/env bash
# Smoke test against a running HTTP-mode server.
# Usage: MCP_AUTH_TOKEN=... [PORT=8931] bash scripts/smoke.sh
set -euo pipefail

PORT="${PORT:-8931}"
TOKEN="${MCP_AUTH_TOKEN:?set MCP_AUTH_TOKEN to the server token}"
URL="http://127.0.0.1:${PORT}/mcp"

# The Accept header is mandatory: the SDK responds 406 without BOTH types.
call() {
  curl -sS -X POST "$URL" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d "$1"
}

echo '── healthz'
curl -sS "http://127.0.0.1:${PORT}/healthz"
echo

echo '── initialize'
call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}'
echo

echo '── tools/list'
call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
echo

echo '── tools/call list_incidents {"since":"7d"}'
call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_incidents","arguments":{"since":"7d"}}}'
echo

echo '── negative: no Authorization header → 401'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/list"}'

echo '── negative: no Accept header → 406'
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$URL" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}'

echo '── negative: GET /mcp → 405'
curl -sS -o /dev/null -w '%{http_code}\n' "$URL" -H "Authorization: Bearer ${TOKEN}"

echo 'smoke: all requests issued'
