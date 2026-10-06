#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -p cluster-explorer-390-lab -f "$ROOT/dev/compose.yml" --profile packaged)

test -s "$ROOT/build/clusterExplorer-3.9.0.zip" || {
  echo "Build the official plugin archive first: scripts/build-plugin.sh" >&2
  exit 1
}

"${COMPOSE[@]}" up -d --build dashboards
IMAGE="$("${COMPOSE[@]}" images -q dashboards)"
test -n "$IMAGE"
docker run --rm --entrypoint /usr/share/opensearch-dashboards/bin/opensearch-dashboards-plugin \
  "$IMAGE" list | grep -F 'clusterExplorer@0.1.0'

for attempt in {1..90}; do
  if curl -fsS --max-time 3 http://127.0.0.1:15602/api/status 2>/dev/null \
    | python3 -c 'import json, sys; sys.exit(json.load(sys.stdin)["status"]["overall"]["state"] != "green")' 2>/dev/null; then
    echo "Verified plugin installation and packaged Dashboards at http://127.0.0.1:15602"
    exit 0
  fi
  sleep 5
done

echo "Packaged Dashboards did not become ready at http://127.0.0.1:15602/api/status" >&2
"${COMPOSE[@]}" logs --tail=100 dashboards >&2
exit 1
