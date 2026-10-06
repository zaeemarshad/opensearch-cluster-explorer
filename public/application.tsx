/* SPDX-License-Identifier: Apache-2.0 */
import React from "react";
import { createRoot } from "react-dom/client";
import type { HttpStart } from "../../../src/core/public";
import { Explorer } from "./components/explorer";
import { LiveClient } from "./client";
import "./index.scss";
export function renderApp(element: HTMLElement, http: HttpStart) {
  const root = createRoot(element);
  root.render(<Explorer client={new LiveClient(http)} />);
  return () => root.unmount();
}
