#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARDS_HOME="${DASHBOARDS_HOME:-/private/tmp/cluster-explorer-dashboards-3.9.0}"
PLUGIN_HOME="$DASHBOARDS_HOME/plugins/cluster_explorer"

if [[ ! -d "$DASHBOARDS_HOME/node_modules" ]]; then
  echo "Bootstrap Dashboards first: scripts/bootstrap-dashboards.sh" >&2
  exit 1
fi

rsync -a --delete \
  --exclude .git --exclude node_modules --exclude build --exclude target \
  --exclude .local \
  "$ROOT/" "$PLUGIN_HOME/"

cd "$DASHBOARDS_HOME"
YARN_BIN="${YARN_BIN:-/private/tmp/cluster-explorer-toolchain/node_modules/.bin/yarn}"
if [[ ! -x "$YARN_BIN" ]]; then YARN_BIN="$(command -v yarn)"; fi
"$YARN_BIN" start --no-base-path --no-dev-config \
  --host 127.0.0.1 --port 15601 --opensearch http://127.0.0.1:19200 "$@"
