/* SPDX-License-Identifier: Apache-2.0 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseSnapshot,
  normaliseShardMetrics,
  resolveCopy,
  normaliseRecovery,
} from "../server/normalise";
import { routingFixture, statsFixture, selected } from "./fixtures";
test("multiple replicas have distinct allocation identities and exact-node stats", () => {
  const s = normaliseSnapshot(routingFixture(), null, null, [], "*");
  assert.equal(new Set(s.copies.map((c) => c.id)).size, 3);
  assert.equal(normaliseShardMetrics(statsFixture(), selected)?.documents, 998);
  assert.equal(
    normaliseShardMetrics(statsFixture(), {
      ...selected,
      node: "b",
      allocationId: "r-b",
    })?.segments,
    5,
  );
});
test("missing fields stay null while reported zero remains zero", () => {
  const m = normaliseShardMetrics(statsFixture(), {
    ...selected,
    node: "a",
    primary: true,
    allocationId: "p-a",
  });
  assert.equal(m?.segmentMemoryBytes, 0);
  assert.equal(m?.translogOperations, 0);
  assert.equal(m?.refreshTotal, null);
  assert.equal(
    normaliseSnapshot(routingFixture(), null, null, [], "*").nodes[0]
      .diskUsedPercent,
    null,
  );
});
test("recreated index cannot be mistaken for old allocation", () => {
  assert.equal(
    resolveCopy(routingFixture(), { ...selected, indexUuid: "old-uuid" }),
    null,
  );
  assert.equal(
    normaliseShardMetrics(statsFixture(), {
      ...selected,
      indexUuid: "old-uuid",
    }),
    null,
  );
});
test("allocation identity mismatch returns no copy", () =>
  assert.equal(
    resolveCopy(routingFixture(), { ...selected, allocationId: "old" }),
    null,
  ));
test("statistics from a previous allocation on the same node are not attached", () => {
  const stats: any = statsFixture();
  stats.indices.products.shards["0"][2].routing.allocation_id.id = "old-r-c";
  assert.equal(normaliseShardMetrics(stats, selected), null);
  // Some versions omit the allocation ID in statistics; the exact node and
  // role still permit a match while the service rechecks cluster state.
  delete stats.indices.products.shards["0"][2].routing.allocation_id;
  assert.equal(normaliseShardMetrics(stats, selected)?.documents, 998);
});
test("relocation target is rendered without increasing configured replica count", () => {
  const state: any = routingFixture();
  const source = state.routing_table.indices.products.shards["0"][0];
  source.state = "RELOCATING";
  source.relocating_node = "d";
  source.allocation_id.relocation_id = "p-d";
  const result = normaliseSnapshot(state, null, null, [], "*");
  assert.equal(result.copies.length, 4);
  assert.equal(result.copies.filter((c) => !c.relocationTarget).length, 3);
  assert.equal(
    result.copies.find((c) => c.relocationTarget)?.allocationId,
    "p-d",
  );
  assert.ok(
    resolveCopy(state, {
      ...selected,
      node: "d",
      primary: true,
      allocationId: "p-d",
    }),
  );
});
test("explicit relocation target is not duplicated", () => {
  const state: any = routingFixture();
  const routes = state.routing_table.indices.products.shards["0"];
  routes[0] = {
    primary: true,
    state: "RELOCATING",
    node: "a",
    relocating_node: "d",
    allocation_id: { id: "p-a", relocation_id: "p-d" },
  };
  routes.push({
    primary: true,
    state: "INITIALIZING",
    node: "d",
    relocating_node: "a",
    allocation_id: { id: "p-d" },
  });
  const result = normaliseSnapshot(state, null, null, [], "*");
  assert.equal(result.copies.length, 4);
  assert.equal(result.copies.filter((c) => c.relocationTarget).length, 1);
});
test("multiple unassigned replica slots have unique keys and unavailable stats", () => {
  const state: any = routingFixture();
  state.routing_table.indices.products.shards["0"]
    .slice(1)
    .forEach((r: any) => {
      r.node = null;
      r.state = "UNASSIGNED";
      delete r.allocation_id;
    });
  const s = normaliseSnapshot(state, null, null, [], "*");
  assert.equal(new Set(s.copies.map((c) => c.id)).size, 3);
  assert.equal(
    normaliseShardMetrics(statsFixture(), { ...selected, node: null }),
    null,
  );
});
test("response limit and partial sources are explicit", () => {
  const s = normaliseSnapshot(
    routingFixture(),
    null,
    null,
    [{ name: "Node metrics", ok: false, observedAt: "now", statusCode: 403 }],
    "*",
    2,
  );
  assert.equal(s.complete, false);
  assert.equal(s.truncated, true);
  assert.equal(s.totalCopies, 3);
  assert.equal(s.returnedCopies, 2);
});
test("recovery is matched by logical shard, role and node", () => {
  const r = {
    products: {
      shards: [
        {
          id: 0,
          primary: false,
          source: { id: "a", name: "data-a" },
          target: { id: "c", name: "data-c" },
          stage: "INDEX",
          type: "PEER",
          index: { size: { recovered_in_bytes: 100, total_in_bytes: 200 } },
        },
      ],
    },
  };
  assert.equal(normaliseRecovery(r, selected)?.recoveredBytes, 100);
  assert.equal(normaliseRecovery(r, { ...selected, node: "b" }), null);
});
