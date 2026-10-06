#!/usr/bin/env python3
"""Validate and stage a versioned official-helper ZIP and checksum."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / "package.json").read_text())
manifest = json.loads((root / "opensearch_dashboards.json").read_text())
version = package["version"]
host = manifest["opensearchDashboardsVersion"]
source = root / "build" / f"clusterExplorer-{host}.zip"
prefix = "opensearch-dashboards/clusterExplorer/"
with zipfile.ZipFile(source) as archive:
    bundled = json.loads(archive.read(prefix + "opensearch_dashboards.json"))
    bundled_package = json.loads(archive.read(prefix + "package.json"))
    assert bundled["version"] == version and bundled["opensearchDashboardsVersion"] == host
    assert bundled_package["version"] == version
    assert bundled_package["repository"] == package["repository"]
    for name in ("LICENSE", "NOTICE", "server/index.js", "target/public/clusterExplorer.plugin.js"):
        assert prefix + name in archive.namelist(), f"Missing {name}"
    assert not any("/.local/" in name or "/dev/" in name or "/tests/" in name for name in archive.namelist())
destination = root / "target" / "release"
destination.mkdir(parents=True, exist_ok=True)
asset = destination / f"clusterExplorer-{version}-opensearch-dashboards-{host}.zip"
shutil.copyfile(source, asset)
digest = hashlib.sha256(asset.read_bytes()).hexdigest()
(destination / "SHA256SUMS.txt").write_text(f"{digest}  {asset.name}\n")
print(f"Release asset: {asset}")
print(f"SHA256: {digest}")
