# Contributing

Open an issue before substantial changes. Keep changes read-only, use the signed-in user's client, and preserve the bounded monitoring budget. Explain behavior and include a meaningful regression test.

Use Node 22. Run `npm ci --ignore-scripts --legacy-peer-deps`, `npm test`, `npm run typecheck:portable` and `npm run check:bundles`. Host build and live test instructions are in [local setup](dev/SETUP.md). Security-sensitive changes must pass the secured role matrix.

Contributions are Apache-2.0 licensed. Sign off commits with `git commit -s` to certify the [Developer Certificate of Origin](https://developercertificate.org/). Review your changes for secrets and retain license attribution. Version compatibility must be tested before changing the host version.
