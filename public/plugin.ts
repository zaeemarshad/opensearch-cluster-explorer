/* SPDX-License-Identifier: Apache-2.0 */
import type { CoreSetup, Plugin } from "../../../src/core/public";
export class ClusterExplorerPlugin implements Plugin {
  public setup(core: CoreSetup) {
    core.application.register({
      id: "clusterExplorer",
      title: "Cluster Explorer",
      async mount(params) {
        const [coreStart] = await core.getStartServices();
        const { renderApp } = await import("./application");
        coreStart.chrome.setBreadcrumbs([{ text: "Cluster Explorer" }]);
        return renderApp(params.element, coreStart.http);
      },
    });
  }
  public start() {}
  public stop() {}
}
