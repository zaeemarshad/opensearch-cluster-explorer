# Security and permissions

All OpenSearch requests use Dashboards' authenticated `asCurrentUser` client. No service-account fallback, role-name allowlist, shared response cache, credentials in the browser, saved objects or mutation endpoints are used. Authentication and app visibility remain under Dashboards Security.

Runtime UI dependencies are supplied by Dashboards; apply host security updates separately. Local validation pins patched PrismJS and trim transitive dependencies. The plugin does not render Markdown or syntax-highlight user-provided HTML.

Index discovery, shard details (including unassigned copies) and allocation explanations require an index-scoped settings read before exposing results. Missing or forbidden settings fail closed. Access-denied refreshes clear the snapshot and rate history; detail denials clear prior detail results. HTTP responses disable caching and sanitize upstream errors.

## Role template

Administrators may provision this role with their permitted index patterns. It is additive to their normal Dashboards login role; the plugin does not provision it automatically.

```json
{
  "cluster_permissions": [
    "cluster:monitor/main",
    "cluster:monitor/state",
    "cluster:monitor/health",
    "cluster:monitor/nodes/stats",
    "cluster:monitor/allocation/explain"
  ],
  "index_permissions": [{
    "index_patterns": ["YOUR-ALLOWED-PATTERN-*"],
    "allowed_actions": [
      "indices:monitor/settings/get",
      "indices:monitor/stats",
      "indices:monitor/recovery"
    ]
  }],
  "tenant_permissions": []
}
```

Omit `cluster:monitor/allocation/explain` to deny allocation explanations. Use a concrete permitted index scope if a discovery page contains unauthorized indices. System-index access remains governed by Security's separate restrictions; the UI toggle grants no access.

Cluster permissions expose cluster-wide routing, health and node information. Index statistics describe physical shards, not a DLS-filtered document view. This is an operational monitoring role for trusted users, not a tenant-isolated analytics role. Tenant grants apply to saved objects and do not replace monitoring permissions. The plugin uses the Dashboards instance's configured cluster, without multi-data-source support.

The exact 3.9 Security Dashboards setup contract has no app authorization registration hook. The plugin respects Security's global app restrictions rather than overriding them. Native OpenSearch action permissions enforce every route; hiding navigation is not an authorization boundary.

## Acceptance test

Run `dev/security/lab.sh start`, then `python3 scripts/smoke-security.py`. This verifies authentication, scoped allowed/forbidden reads, unassigned-copy denial, explanation permissions and sequential user isolation against Security-enabled OpenSearch/Dashboards 3.9.0. Fixtures are restricted to the isolated local lab; see [setup](dev/SETUP.md).

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/zaeemarshad/opensearch-cluster-explorer/security/advisories/new), rather than a public issue. Include affected versions, reproduction steps and impact; never submit credentials or production data. [OpenSearch permission reference](https://docs.opensearch.org/latest/security/access-control/permissions/).
