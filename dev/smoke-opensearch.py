#!/usr/bin/env python3
"""Assert that the local lab exposes real shard document and segment counts."""

import argparse
import json
import os
import urllib.request

INDEX = "cluster-explorer-demo"


def get(base, path):
    with urllib.request.urlopen(base + path, timeout=75) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default=os.environ.get("OPENSEARCH_URL", "http://127.0.0.1:19200"))
    base = parser.parse_args().endpoint.rstrip("/")

    root = get(base, "/")
    assert root["version"]["number"] == "3.9.0", root["version"]
    health = get(base, "/_cluster/health/" + INDEX + "?wait_for_status=green&timeout=60s")
    assert health["number_of_nodes"] == 2, health
    assert health["status"] == "green", health
    assert health["active_primary_shards"] == 3, health
    assert health["active_shards"] == 6, health

    stats = get(base, "/" + INDEX + "/_stats/docs,segments?level=shards")
    shards = stats["indices"][INDEX]["shards"]
    assert len(shards) == 3, shards.keys()
    copies = [copy for copies in shards.values() for copy in copies]
    assert len(copies) == 6, len(copies)
    assert all(copy["docs"]["count"] > 0 for copy in copies), copies
    assert all(copy["segments"]["count"] > 0 for copy in copies), copies
    assert sum(copy["docs"]["count"] for copy in copies if copy["routing"]["primary"]) == 300
    print("PASS: OpenSearch 3.9.0, two nodes, green 3+3 shards, 300 primary documents, nonzero per-copy segments.")


if __name__ == "__main__":
    main()
