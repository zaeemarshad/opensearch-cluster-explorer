#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose=(docker compose -p cluster-explorer-390-lab -f "$script_dir/compose.yml")

case "${1:-}" in
  start)
    "${compose[@]}" up -d --wait opensearch-a opensearch-b
    python3 "$script_dir/seed.py" --endpoint "${OPENSEARCH_URL:-http://127.0.0.1:19200}"
    python3 "$script_dir/smoke-opensearch.py" --endpoint "${OPENSEARCH_URL:-http://127.0.0.1:19200}"
    ;;
  stop)
    "${compose[@]}" stop
    ;;
  reset)
    # The compose file owns a unique project name; down only touches its resources.
    "${compose[@]}" down --volumes
    ;;
  status)
    "${compose[@]}" ps
    ;;
  *)
    echo "Usage: $0 {start|stop|reset|status}" >&2
    exit 2
    ;;
esac
