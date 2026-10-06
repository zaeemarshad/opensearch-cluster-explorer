/* SPDX-License-Identifier: Apache-2.0 */
export function routingFixture() {
  return {
    cluster_name: "test-cluster",
    cluster_uuid: "cluster-uuid",
    version: 42,
    nodes: {
      a: { name: "data-a", roles: ["data"], attributes: { zone: "a" } },
      b: { name: "data-b", roles: ["data"], attributes: { zone: "b" } },
      c: { name: "data-c", roles: ["data"], attributes: { zone: "c" } },
    },
    metadata: {
      indices: {
        products: {
          state: "open",
          settings: {
            index: {
              uuid: "index-uuid",
              number_of_shards: "1",
              number_of_replicas: "2",
            },
          },
        },
      },
    },
    routing_table: {
      indices: {
        products: {
          shards: {
            "0": [
              {
                primary: true,
                state: "STARTED",
                node: "a",
                relocating_node: null,
                allocation_id: { id: "p-a" },
              },
              {
                primary: false,
                state: "STARTED",
                node: "b",
                relocating_node: null,
                allocation_id: { id: "r-b" },
              },
              {
                primary: false,
                state: "STARTED",
                node: "c",
                relocating_node: null,
                allocation_id: { id: "r-c" },
              },
            ],
          },
        },
      },
    },
  };
}
export function statsFixture() {
  return {
    _shards: { total: 3, successful: 3, failed: 0 },
    indices: {
      products: {
        uuid: "index-uuid",
        shards: {
          "0": [
            {
              routing: {
                node: "a",
                primary: true,
                allocation_id: { id: "p-a" },
              },
              docs: { count: 1000, deleted: 7 },
              segments: { count: 4, memory_in_bytes: 0 },
              store: { size_in_bytes: 2048 },
              translog: { operations: 0, size_in_bytes: 55 },
              merges: { current: 0 },
            },
            {
              routing: {
                node: "b",
                primary: false,
                allocation_id: { id: "r-b" },
              },
              docs: { count: 999, deleted: 8 },
              segments: { count: 5 },
              store: { size_in_bytes: 2000 },
            },
            {
              routing: {
                node: "c",
                primary: false,
                allocation_id: { id: "r-c" },
              },
              docs: { count: 998, deleted: 9 },
              segments: { count: 6 },
              store: { size_in_bytes: 1990 },
            },
          ],
        },
      },
    },
  };
}
export const selected = {
  index: "products",
  indexUuid: "index-uuid",
  shard: 0,
  primary: false,
  node: "c",
  allocationId: "r-c",
};
