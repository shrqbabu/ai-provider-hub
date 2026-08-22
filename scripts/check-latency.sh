#!/usr/bin/env bash
# AI Provider Hub — gateway latency checker
#
# Usage:
#   BASE_URL=https://your-domain/v1 KEY=ah-... MODEL=<model-or-combo> bash scripts/check-latency.sh
#
# Example:
#   BASE_URL=https://ai-free.duckdns.org/v1 KEY=ah-xxx MODEL=claude-fable-5 bash scripts/check-latency.sh
set -u

BASE_URL="${BASE_URL:-http://localhost:3000/v1}"
: "${KEY:?Set KEY=ah-... (gateway key)}"
: "${MODEL:?Set MODEL=<model id or combo name>}"

BASE_URL="${BASE_URL%/}"
FMT='  dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s http=%{http_code}\n'

echo "== 1) TLS / connect  (GET $BASE_URL/models) =="
curl -s -o /dev/null -w "$FMT" -H "Authorization: Bearer $KEY" "$BASE_URL/models"

echo
echo "== 2) Chat STREAM TTFB (first token time — ye asli perceived latency hai) =="
curl -s -N -o /dev/null -w "$FMT" -X POST "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"max_tokens\":50,\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}]}"

echo
echo "== 3) Chat NON-STREAM total (poora response ka wait) =="
curl -s -o /dev/null -w "$FMT" -X POST "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":50,\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}]}"

echo
echo "== 4) Anthropic /messages STREAM TTFB (Claude Code wala path) =="
curl -s -N -o /dev/null -w "$FMT" -X POST "$BASE_URL/messages" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"max_tokens\":50,\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}]}"

echo
echo "== 5) Hub-side breakdown (Server-Timing — sirf naye build pe) =="
curl -s -D - -o /dev/null -X POST "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"max_tokens\":10,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
  | grep -i '^server-timing' || echo "  (Server-Timing header nahi mila — naya build deploy karna pending hai)"

echo
echo "Padhne ka tareeka:"
echo "  - 'tls' ya 'connect' slow  → network/TLS issue"
echo "  - stream ttfb slow, tls fast → upstream model ka first-token time (Server-Timing mein up1/up2 dekho)"
echo "  - Server-Timing: auth+cfg bade → hub-side; up1/up2 bade → upstream provider; proj bada → Antigravity project lookup"
