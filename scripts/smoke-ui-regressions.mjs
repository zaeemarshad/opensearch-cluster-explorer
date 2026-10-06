/* SPDX-License-Identifier: Apache-2.0 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.argv[2] || "http://127.0.0.1:15602";
const response = await fetch(
  `${base}/api/cluster_explorer/snapshot?scope=cluster-explorer-demo`,
);
assert.equal(response.status, 200);
const fixture = await response.json();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let pageTwoCalls = 0,
    deny = false;
  await page.route("**/api/cluster_explorer/snapshot?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (deny)
      return route.fulfill({ status: 403, json: { message: "Access denied" } });
    if (query.has("nextToken")) {
      if (++pageTwoCalls === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Temporary failure" },
        });
      return route.fulfill({
        json: {
          ...fixture,
          copies: [],
          indices: [
            {
              name: "page-two",
              uuid: "page-two",
              primaries: 1,
              replicas: 0,
              hidden: false,
              state: "open",
            },
          ],
          nextToken: null,
        },
      });
    }
    return route.fulfill({ json: { ...fixture, nextToken: "page-two-token" } });
  });
  await page.goto(`${base}/app/clusterExplorer`);
  await page.getByRole("tab", { name: "Indices", exact: true }).click();
  await page
    .getByRole("button", { name: "cluster-explorer-demo", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Next index page", exact: true })
    .click();
  await page.getByText("Temporary failure", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "cluster-explorer-demo", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Next index page", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "page-two", exact: true }).waitFor();
  assert.equal(pageTwoCalls, 2);
  console.log(
    "PASS failed page navigation clears mismatched data and retries the same page",
  );
  await page
    .getByRole("combobox", { name: "Refresh interval" })
    .selectOption("30");
  await page.waitForResponse(
    (response) =>
      response.url().includes("/api/cluster_explorer/snapshot") &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "page-two", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  deny = true;
  await page
    .getByText("Access denied", { exact: false })
    .waitFor({ timeout: 45000 });
  assert.equal(
    await page.getByRole("button", { name: "page-two", exact: true }).count(),
    0,
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  console.log("PASS access denial clears snapshot and selected index details");
} finally {
  await browser.close();
}
