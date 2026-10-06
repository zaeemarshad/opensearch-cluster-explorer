#!/usr/bin/env python3
"""Create dedicated sample data in a local OpenSearch lab, once."""

import argparse
import json
import os
import urllib.error
import urllib.request

INDEX = "cluster-explorer-demo"


def request(base, path, method="GET", data=None, content_type="application/json"):
    payload = data.encode() if isinstance(data, str) else json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        base + path,
        data=payload,
        method=method,
        headers={"Content-Type": content_type},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("OPENSEARCH_URL", "http://127.0.0.1:19200"),
        help="OpenSearch base URL (default: OPENSEARCH_URL or http://127.0.0.1:19200)",
    )
    args = parser.parse_args()
    base = args.endpoint.rstrip("/")

    try:
        request(
            base,
            "/" + INDEX,
            "PUT",
            {
                "settings": {"number_of_shards": 3, "number_of_replicas": 1},
                "mappings": {"_meta": {"cluster_explorer_seed": "v1"}},
            },
        )
    except urllib.error.HTTPError as error:
        if error.code != 400:
            raise
        details = json.load(error)
        if details.get("error", {}).get("type") != "resource_already_exists_exception":
            raise
        mapping = request(base, "/" + INDEX + "/_mapping")
        if mapping[INDEX]["mappings"].get("_meta", {}).get("cluster_explorer_seed") != "v1":
            print(f"{INDEX} already exists without our seed marker; leaving its data unchanged.")
            return

    lines = []
    for i in range(300):
        lines.extend(
            [
                json.dumps({"create": {"_index": INDEX, "_id": str(i)}}),
                json.dumps({"sku": f"demo-{i}", "stock": i % 19, "description": "Cluster Explorer local test document"}),
            ]
        )
    result = request(base, "/_bulk?refresh=true", "POST", "\n".join(lines) + "\n", "application/x-ndjson")
    failures = [
        item["create"]
        for item in result["items"]
        if item["create"]["status"] not in (201, 409)
    ]
    if failures:
        raise RuntimeError(f"{len(failures)} demo documents failed to index: {failures[0]}")
    count = request(base, "/" + INDEX + "/_count")["count"]
    if count != 300:
        raise RuntimeError(f"Expected 300 demo documents; found {count}. Check the dedicated index.")
    print(f"{INDEX} is ready with 300 documents, 3 primaries and 1 replica per primary.")


if __name__ == "__main__":
    main()
