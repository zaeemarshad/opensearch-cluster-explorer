#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARDS_HOME="${DASHBOARDS_HOME:-/private/tmp/cluster-explorer-dashboards-3.9.0}"
PLUGIN_HOME="$DASHBOARDS_HOME/plugins/cluster_explorer"
ARCHIVE="clusterExplorer-3.9.0.zip"

if [[ ! -d "$DASHBOARDS_HOME/node_modules" ]]; then
  echo "Bootstrap Dashboards first: scripts/bootstrap-dashboards.sh" >&2
  exit 1
fi

rsync -a --delete \
  --exclude .git --exclude node_modules --exclude build --exclude target \
  --exclude .local \
  "$ROOT/" "$PLUGIN_HOME/"

cd "$PLUGIN_HOME"
YARN_BIN="${YARN_BIN:-/private/tmp/cluster-explorer-toolchain/node_modules/.bin/yarn}"
if [[ ! -x "$YARN_BIN" ]]; then YARN_BIN="$(command -v yarn)"; fi
"$YARN_BIN" build --opensearch-dashboards-version 3.9.0

test -s "$PLUGIN_HOME/build/$ARCHIVE"
mkdir -p "$ROOT/build"
cp "$PLUGIN_HOME/build/$ARCHIVE" "$ROOT/build/$ARCHIVE"
python3 - "$ROOT/build/$ARCHIVE" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    names = set(archive.namelist())
    prefix = "opensearch-dashboards/clusterExplorer/"
    for required in ("LICENSE", "NOTICE", "opensearch_dashboards.json", "server/index.js"):
        assert prefix + required in names, f"Missing release file: {required}"
    assert not any("/.local/" in n or "/dev/" in n or "/tests/" in n for n in names), "Development files in release archive"
PY
echo "Installable archive: $ROOT/build/$ARCHIVE"
