# Local setup

Requirements: Docker, Node 22, Yarn 1.22.19; optional `mise exec node@22 --` before host scripts.

```sh
./dev/lab.sh start
scripts/bootstrap-dashboards.sh
scripts/dashboards-dev.sh
```

Open [development UI](http://127.0.0.1:15601/app/clusterExplorer). OpenSearch binds to `127.0.0.1:19200`; ports 9200/5601 are untouched. The two-node lab seeds 300 documents with three primaries and one replica. `python3 dev/seed.py --endpoint URL` or `OPENSEARCH_URL` changes the seed endpoint.

Stop the development server before packaging in the same checkout:

```sh
scripts/build-plugin.sh
scripts/verify-install.sh
```

The installed package runs on [15602](http://127.0.0.1:15602/app/clusterExplorer). Restart `scripts/dashboards-dev.sh` afterward. Wait for UI bundles, not just backend status.

```sh
npx playwright install chromium
npm run smoke:api
npm run smoke:browser
python3 scripts/smoke-dashboards.py --dashboards http://127.0.0.1:15602
npm run smoke:browser -- http://127.0.0.1:15602
npm run smoke:ui-regressions
SMOKE_RATES=1 npm run smoke:browser -- http://127.0.0.1:15602 target/browser-rates.png
```

Run smokes sequentially because they share admission limits. API smoke compares all six copies with OpenSearch; browser smoke verifies shard details; rate smoke verifies 31 seconds without default polling and a measured search rate.

## Security acceptance lab

```sh
./dev/security/lab.sh start
python3 scripts/smoke-security.py
./dev/security/lab.sh stop
```

This separate Security-enabled lab uses loopback ports 19201/15603, retains Security Dashboards, and generates an admin password in ignored `.local/security.env` (mode 0600). Its smoke creates isolated fixture roles/users and `ce-rbac-*` indices. Demo TLS certificates and the demo service account are local-test settings only.

## Lifecycle

`dev/lab.sh` and `dev/security/lab.sh` accept `start`, `stop`, `status`, `reset`. Stop retains persistent volumes; reset deletes only the respective named Compose project's containers, network and volumes. Neither script prunes Docker or changes global VM settings. Source Dashboards is stopped separately with Ctrl-C.

The functional lab disables Security, mmap and uses small absolute disk watermarks. It verifies behavior, not production configuration. The security lab is the authorization acceptance gate.
