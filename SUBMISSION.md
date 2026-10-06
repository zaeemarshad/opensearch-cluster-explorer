# Submission candidate: Cluster Explorer 0.1.0

Target: OpenSearch and OpenSearch Dashboards 3.9.0. Artifact: `build/clusterExplorer-3.9.0.zip`, built by the official Dashboards plugin helper. License: Apache-2.0; LICENSE and NOTICE are included in the archive. No runtime third-party dependencies are bundled beyond the host's UI libraries.

## Scope

Read-only allocation, node and index monitoring with per-copy statistics and on-demand allocation explanations. Manual refresh, paged index discovery and bounded requests support large inventories. Authentication uses Dashboards; OpenSearch action permissions enforce access. [Role template and boundaries](SECURITY.md).

## Review disposition

Independent code and security agents reviewed the full working tree. Fixed findings: failed-page stale data, hidden-index classification, stale files in build staging, missing license files, missing index authorization before allocation reads, and cached views surviving authorization denial. No remaining concrete RBAC bypass was found in the follow-up review.

## Acceptance evidence

- 29 passing unit tests, portable TypeScript and bundle checks.
- Official 3.9.0 helper build and plugin-manager installation.
- Two-node live lab: 300 documents, six shard copies; API and browser checks compare real document and segment counts.
- Security-enabled 3.9.0 lab: unauthenticated/no-monitor denial, scoped allowed reads, forbidden snapshot/shard/unassigned/explain denial, missing explain grant, sequential users, and read/write tenant isolation.
- Browser regressions: failed pagination retry and clearing selected views after access denial.
- Synthetic 20,000-index/50,000-copy tests verify bounded selection; live rate smoke verifies manual refresh and measured search deltas.

Reproduction: [local setup](dev/SETUP.md). CI packages against the exact host tag and runs the secured role matrix.

Local verification: 2026-10-06. Final archive SHA-256: `cdae0d7f97dc33517949d09422cf11be022411dc070ee077ee3a5aeac9a4901f`.

## External acceptance gates

Run CI on the submission repository; it has not been dispatched locally. Maintainers must confirm ownership, naming and distribution policy. Production-scale load, accessibility/theme coverage, DLS/FLS deployments, auth providers beyond Basic, and Security's readonly-role navigation behavior need deployment-specific validation. The plugin is an operational monitoring view, not tenant-isolated document analytics. Multi-data-source selection and historical collection are outside this release.

This is a reviewable submission candidate; upstream approval or acceptance has not been obtained.
