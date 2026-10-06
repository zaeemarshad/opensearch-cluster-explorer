#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARDS_HOME="${DASHBOARDS_HOME:-/private/tmp/cluster-explorer-dashboards-3.9.0}"
PLUGIN_HOME="$DASHBOARDS_HOME/plugins/cluster_explorer"

if [[ ! -d "$DASHBOARDS_HOME/.git" ]]; then
  git clone --depth 1 --branch 3.9.0 \
    https://github.com/opensearch-project/OpenSearch-Dashboards.git "$DASHBOARDS_HOME"
fi

if [[ "$(git -C "$DASHBOARDS_HOME" rev-parse HEAD)" != "$(git -C "$DASHBOARDS_HOME" rev-parse refs/tags/3.9.0)" ]]; then
  echo "Expected the OpenSearch Dashboards 3.9.0 tag at $DASHBOARDS_HOME" >&2
  exit 1
fi

mkdir -p "$PLUGIN_HOME"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude build --exclude target \
  --exclude .local \
  "$ROOT/" "$PLUGIN_HOME/"

cd "$DASHBOARDS_HOME"
YARN_BIN="${YARN_BIN:-/private/tmp/cluster-explorer-toolchain/node_modules/.bin/yarn}"
if [[ ! -x "$YARN_BIN" ]]; then
  if command -v yarn >/dev/null 2>&1; then
    YARN_BIN="$(command -v yarn)"
  else
    npm install --prefix /private/tmp/cluster-explorer-toolchain --no-save yarn@1.22.19
  fi
fi
"$YARN_BIN" osd bootstrap
