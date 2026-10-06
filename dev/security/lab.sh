#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$ROOT/.local"
if [[ ! -f "$ROOT/.local/security.env" ]]; then
  (umask 077; python3 -c 'import secrets; print("SECURITY_ADMIN_PASSWORD=Aa1!" + secrets.token_hex(24))' > "$ROOT/.local/security.env")
fi
compose=(docker compose --env-file "$ROOT/.local/security.env" -p cluster-explorer-390-security -f "$ROOT/dev/security/compose.yml")
case "${1:-}" in
  start) "${compose[@]}" up -d --build ;;
  stop) "${compose[@]}" stop ;;
  reset) "${compose[@]}" down --volumes ;;
  status) "${compose[@]}" ps ;;
  *) echo "Usage: $0 {start|stop|reset|status}" >&2; exit 2 ;;
esac
