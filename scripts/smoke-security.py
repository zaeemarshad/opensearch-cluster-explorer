#!/usr/bin/env python3
"""RBAC acceptance test. Writes only to the isolated security lab on 19201."""
import base64
import json
import pathlib
import secrets
import ssl
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PASSWORD = (ROOT / ".local/security.env").read_text().strip().split("=", 1)[1]
OS = "https://127.0.0.1:19201"
OSD = "http://127.0.0.1:15603"
TLS = ssl._create_unverified_context()  # Isolated demo certificate, loopback only.


def call(base, path, user=None, password=None, method="GET", body=None, tenant=None):
    headers = {"osd-xsrf": "security-smoke", "content-type": "application/json"}
    if user:
        headers["authorization"] = "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()
    if tenant:
        headers["securitytenant"] = tenant
    request = urllib.request.Request(base + path, headers=headers, method=method,
                                     data=json.dumps(body).encode() if body is not None else None)
    for attempt in range(8):
        try:
            with urllib.request.urlopen(request, context=TLS, timeout=15) as response:
                raw = response.read().decode()
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            if error.code == 429 and attempt < 7:
                time.sleep(5)
                continue
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, raw


def admin(path, method="GET", body=None):
    status, result = call(OS, path, "admin", PASSWORD, method, body)
    assert status in (200, 201), f"Admin fixture request failed ({status}): {path}"
    return result


for _ in range(90):
    try:
        if call(OS, "/", "admin", PASSWORD)[0] == 200 and call(OSD, "/api/status", "admin", PASSWORD)[0] == 200:
            break
    except (OSError, urllib.error.URLError):
        pass
    time.sleep(2)
else:
    raise SystemExit("Security lab did not become ready")
assert admin("/").get("cluster_name") == "cluster-explorer-security", "Refusing fixtures outside this project's Security lab"

# Every fixture uses a unique prefix; no production endpoint is configurable.
cluster = ["cluster:monitor/state", "cluster:monitor/health", "cluster:monitor/nodes/stats",
           "cluster:monitor/main", "cluster:monitor/allocation/explain"]
index_actions = ["indices:monitor/stats", "indices:monitor/recovery", "indices:monitor/settings/get"]
for tenant in ("ce-tenant-read", "ce-tenant-write"):
    admin(f"/_plugins/_security/api/tenants/{tenant}", "PUT", {"description": "Cluster Explorer acceptance fixture"})
for name, allowed in (("ce_allowed", True), ("ce_no_explain", True), ("ce_denied", False)):
    role = {"cluster_permissions": [x for x in cluster if name != "ce_no_explain" or x != "cluster:monitor/allocation/explain"],
            "index_permissions": [{"index_patterns": ["ce-rbac-allowed"], "allowed_actions": index_actions}] if allowed else [],
            "tenant_permissions": [
                {"tenant_patterns": ["ce-tenant-read"], "allowed_actions": ["kibana_all_read"]},
                {"tenant_patterns": ["ce-tenant-write"], "allowed_actions": ["kibana_all_write"]}
            ] if allowed else []}
    if not allowed:
        role["cluster_permissions"] = ["cluster:monitor/main"]
    admin(f"/_plugins/_security/api/roles/{name}", "PUT", role)

credentials = {}
for name in ("ce_allowed", "ce_no_explain", "ce_denied"):
    credentials[name] = "Aa1!" + secrets.token_hex(16)
    admin(f"/_plugins/_security/api/internalusers/{name}", "PUT", {"password": credentials[name], "backend_roles": []})
    admin(f"/_plugins/_security/api/rolesmapping/{name}", "PUT", {"users": [name]})

selectors = {}
for name in ("ce-rbac-allowed", "ce-rbac-forbidden"):
    status, _ = call(OS, f"/{name}", "admin", PASSWORD, "PUT", {"settings": {"number_of_shards": 1, "number_of_replicas": 1}})
    assert status in (200, 400), "Index fixture failed"
    admin(f"/{name}/_doc/1?refresh=true", "PUT", {"value": "rbac"})
    state = admin(f"/_cluster/state/metadata,routing_table/{name}")
    uuid = state["metadata"]["indices"][name]["settings"]["index"]["uuid"]
    for copy in state["routing_table"]["indices"][name]["shards"]["0"]:
        if copy["primary"]:
            selectors[name] = {"index": name, "indexUuid": uuid, "shard": 0, "primary": True,
                               "node": copy["node"], "allocationId": copy.get("allocation_id", {}).get("id")}


def check(label, user, path, expected, method="GET", body=None):
    status, result = call(OSD, path, user, credentials.get(user), method, body)
    assert status == expected, f"{label}: expected {expected}, got {status}"
    if expected in (401, 403):
        text = json.dumps(result)
        assert PASSWORD not in text and "backend_roles" not in text, f"{label}: raw security error leaked"
    print(f"PASS {label} ({status})")
    return result


check("unauthenticated", None, "/api/cluster_explorer/snapshot?scope=ce-rbac-allowed", 401)
check("no monitoring permission", "ce_denied", "/api/cluster_explorer/snapshot?scope=ce-rbac-allowed", 403)
snapshot = check("allowed index snapshot", "ce_allowed", "/api/cluster_explorer/snapshot?scope=ce-rbac-allowed", 200)
assert [i["name"] for i in snapshot["indices"]] == ["ce-rbac-allowed"]
assert snapshot["indices"][0].get("activity"), "Allowed activity unavailable; check required index grants"
check("allowed shard", "ce_allowed", "/api/cluster_explorer/shard", 200, "POST", selectors["ce-rbac-allowed"])
check("allowed explain", "ce_allowed", "/api/cluster_explorer/explain", 200, "POST", selectors["ce-rbac-allowed"])
check("forbidden shard", "ce_allowed", "/api/cluster_explorer/shard", 403, "POST", selectors["ce-rbac-forbidden"])
check("forbidden explain", "ce_allowed", "/api/cluster_explorer/explain", 403, "POST", selectors["ce-rbac-forbidden"])
unassigned = {**selectors["ce-rbac-forbidden"], "primary": False, "node": None, "allocationId": None}
check("forbidden unassigned shard", "ce_allowed", "/api/cluster_explorer/shard", 403, "POST", unassigned)
check("forbidden index scope", "ce_allowed", "/api/cluster_explorer/snapshot?scope=ce-rbac-forbidden", 403)
check("mixed wildcard fails closed", "ce_allowed", "/api/cluster_explorer/snapshot?scope=ce-rbac-*", 403)
check("missing explain permission", "ce_no_explain", "/api/cluster_explorer/explain", 403, "POST", selectors["ce-rbac-allowed"])
check("sequential user isolation", "ce_denied", "/api/cluster_explorer/snapshot?scope=ce-rbac-allowed", 403)
for tenant in ("ce-tenant-read", "ce-tenant-write"):
    status, result = call(OSD, "/api/cluster_explorer/snapshot?scope=ce-rbac-allowed", "ce_allowed", credentials["ce_allowed"], tenant=tenant)
    assert status == 200 and result["indices"][0]["name"] == "ce-rbac-allowed", f"{tenant}: monitoring changed with tenant"
    status, _ = call(OSD, "/api/cluster_explorer/explain", "ce_allowed", credentials["ce_allowed"], "POST", selectors["ce-rbac-forbidden"], tenant)
    assert status == 403, f"{tenant}: tenant grant bypassed index permissions"
    print(f"PASS {tenant}: tenant grants do not bypass index monitoring permissions")
print("PASS Security-enabled Dashboards forwards caller authorization; no service-account fallback")
