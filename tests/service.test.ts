/* SPDX-License-Identifier: Apache-2.0 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSnapshot,
  getShardDetails,
  explainShard,
  validateIndex,
  validateScope,
  safeFailure,
  Transport,
} from "../server/service";
import { routingFixture, statsFixture, selected } from "./fixtures";
function mockTransport(
  options: {
    deniedStats?: boolean;
    deniedNodes?: boolean;
    changedAllocation?: boolean;
    unassigned?: boolean;
    incompleteState?: boolean;
    hidden?: boolean;
  } = {},
) {
  const calls: any[] = [];
  let stateCalls = 0;
  const client: Transport = {
    async request(p, o) {
      calls.push({ params: p, options: o });
      if (p.path.endsWith("/_settings/index.uuid,index.hidden"))
        return {
          body: {
            products: {
              settings: {
                index: {
                  uuid: "uuid-products",
                  hidden: options.hidden ? "true" : "false",
                },
              },
            },
          },
        };
      if (p.path.startsWith("/_list/indices/"))
        return {
          body: {
            indices: [
              {
                index: "products",
                uuid: "uuid-products",
                pri: "1",
                rep: "2",
                status: "open",
              },
            ],
            next_token: null,
          },
        };
      if (p.path.includes("/_cluster/state/")) {
        const state: any = routingFixture();
        if (options.incompleteState) delete state.routing_table;
        if (p.path.includes("routing_table")) stateCalls++;
        if (options.changedAllocation && stateCalls > 1)
          state.routing_table.indices.products.shards["0"][2].allocation_id.id =
            "new";
        if (options.unassigned) {
          const c = state.routing_table.indices.products.shards["0"][2];
          c.node = null;
          c.state = "UNASSIGNED";
          delete c.allocation_id;
        }
        return { body: state };
      }
      if (p.path === "/_cluster/health")
        return {
          body: {
            status: "green",
            active_primary_shards: 1,
            active_shards: 3,
            unassigned_shards: 0,
          },
        };
      if (p.path.includes("/_nodes/stats")) {
        if (options.deniedNodes) throw { statusCode: 403 };
        return { body: { nodes: {} } };
      }
      if (p.path.includes("/_stats/")) {
        if (options.deniedStats) throw { statusCode: 403 };
        return { body: statsFixture() };
      }
      if (p.path.endsWith("/_recovery")) return { body: {} };
      if (p.path === "/_cluster/allocation/explain")
        return {
          body: {
            can_remain_on_current_node: "yes",
            node_allocation_decisions: [],
          },
        };
      throw new Error(`Unexpected endpoint ${p.path}`);
    },
  };
  return { client, calls };
}
test("snapshot requests only bounded monitoring APIs and preserves partial denial", async () => {
  const { client, calls } = mockTransport({ deniedNodes: true });
  const result = await getSnapshot(client, "products*");
  assert.equal(calls.length, 6);
  assert.equal(result.complete, false);
  assert.equal(result.sources[2].statusCode, 403);
  assert.ok(
    calls.every(
      (c) => c.params.method === "GET" && c.options.requestTimeout === 10000,
    ),
  );
  assert.equal(result.copies.length, 3);
});
test("index directory preserves hidden settings on non-dot indices", async () => {
  const { client } = mockTransport({ hidden: true });
  const result = await getSnapshot(client, "products");
  assert.equal(result.indices[0].hidden, true);
});
test("details requests one concrete index and exact replica statistics", async () => {
  const { client, calls } = mockTransport();
  const result = await getShardDetails(client, selected);
  assert.equal(result.metrics?.documents, 998);
  assert.equal(
    calls.filter((c) => c.params.path.includes("/_stats/")).length,
    1,
  );
  assert.equal(
    calls.find((c) => c.params.path.includes("/_stats/")).params.querystring
      .level,
    "shards",
  );
  assert.equal(
    calls.filter((c) => c.params.path.includes("/_cluster/state/")).length,
    4,
  );
});
test("changed allocation during stats collection returns conflict", async () => {
  const { client } = mockTransport({ changedAllocation: true });
  await assert.rejects(
    getShardDetails(client, selected),
    (e: any) => e.statusCode === 409,
  );
});
test("incomplete state cannot appear as a healthy empty cluster", async () => {
  const { client } = mockTransport({ incompleteState: true });
  await assert.rejects(
    getSnapshot(client, "products"),
    (e: any) => e.statusCode === 502 && /incomplete routing/.test(e.message),
  );
});
test("changed allocation during explanation returns conflict", async () => {
  const { client } = mockTransport({ changedAllocation: true });
  await assert.rejects(
    explainShard(client, selected),
    (e: any) => e.statusCode === 409,
  );
});
test("forbidden shard statistics do not become zero or leak raw error", async () => {
  const { client } = mockTransport({ deniedStats: true });
  const result = await getShardDetails(client, selected);
  assert.equal(result.metrics, null);
  assert.equal(result.sources[0].statusCode, 403);
});
test("unassigned copies skip all stats/recovery requests", async () => {
  const { client, calls } = mockTransport({ unassigned: true });
  const result = await getShardDetails(client, {
    ...selected,
    node: null,
    allocationId: null,
  });
  assert.equal(result.metrics, null);
  assert.equal(calls.length, 3);
});
test("explain specifies selected node and never uses mutation endpoints", async () => {
  const { client, calls } = mockTransport();
  await explainShard(client, selected);
  const request = calls.find(
    (c) => c.params.path === "/_cluster/allocation/explain",
  );
  assert.deepEqual(request.params.body, {
    index: "products",
    shard: 0,
    primary: false,
    current_node: "c",
  });
  assert.equal(request.params.method, "POST");
  assert.ok(calls.every((c) => !c.params.path.includes("reroute")));
});
test("index selectors reject wildcard, lists, cross-cluster and encoded URL injection", () => {
  for (const name of [
    "*",
    "a,b",
    "a/b",
    "a%2fb",
    "a?x=y",
    "remote:index",
    "..",
    "-x",
    "a\\b",
  ])
    assert.throws(() => validateIndex(name));
  assert.equal(validateIndex(".hidden-index"), ".hidden-index");
  assert.equal(validateIndex("products-v2"), "products-v2");
  assert.equal(validateScope("products*,orders-*"), "products*,orders-*");
  assert.throws(() => validateScope("a/_delete"));
});
test("unexpected backend errors are sanitised", () => {
  assert.equal(
    safeFailure({ message: "password=secret", meta: { statusCode: 500 } })
      .statusCode,
    502,
  );
  assert.ok(!safeFailure(new Error("secret")).message.includes("secret"));
});
