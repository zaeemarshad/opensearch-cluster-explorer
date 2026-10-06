# Changelog

## 0.1.0 — initial preview

Targets OpenSearch and OpenSearch Dashboards 3.9.0.

- Allocation, Nodes and Indices views with live shard-copy document and segment counts.
- Index activity rates and on-demand recovery/allocation explanations.
- Caller-scoped permissions with index authorization before metadata exposure.
- Manual refresh by default, a 30-second automatic minimum, pagination and bounded monitoring requests.
- Official build/install, secured-role acceptance and browser smoke tests.

Known limits: cluster monitoring is cluster-wide; statistics are not DLS-filtered analytics. No multi-data-source selection or historical collection. Large-cluster coverage is synthetic; production-scale load, full accessibility/theme coverage and non-Basic authentication need further validation.
