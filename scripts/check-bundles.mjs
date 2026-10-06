/* SPDX-License-Identifier: Apache-2.0 */
import { build } from "esbuild";
await build({
  entryPoints: ["public/index.ts"],
  tsconfig: "tsconfig.portable.json",
  bundle: true,
  packages: "external",
  outdir: "target/portable/public",
  format: "esm",
  platform: "browser",
  loader: { ".scss": "empty" },
  logLevel: "info",
});
await build({
  entryPoints: ["server/index.ts"],
  tsconfig: "tsconfig.portable.json",
  bundle: true,
  packages: "external",
  outdir: "target/portable/server",
  format: "cjs",
  platform: "node",
  target: "node22",
  logLevel: "info",
});
console.log(
  "Portable bundles passed. These are compile checks, not Dashboards installation archives.",
);
