/* SPDX-License-Identifier: Apache-2.0 */
import type { CoreSetup, Plugin } from "../../../src/core/server";
import { defineRoutes } from "./routes";
export class ClusterExplorerPlugin implements Plugin {
  public setup(core: CoreSetup) {
    defineRoutes(core.http.createRouter());
  }
  public start() {}
  public stop() {}
}
