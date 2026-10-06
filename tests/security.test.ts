/* SPDX-License-Identifier: Apache-2.0 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getShardDetails,
  explainShard,
  getSnapshot,
  Transport,
} from "../server/service";
import { selected } from "./fixtures";
import { accessDenied } from "../public/client";

for (const operation of [getShardDetails, explainShard]) {
  test(`${operation.name} denies forbidden index before cluster-wide reads`, async () => {
    const calls: string[] = [];
    const client: Transport = {
      async request(p) {
        calls.push(p.path);
        throw { statusCode: 403 };
      },
    };
    await assert.rejects(
      operation(client, { ...selected, node: null, allocationId: null }),
      (e: any) => e.statusCode === 403,
    );
    assert.deepEqual(calls, ["/products/_settings/index.uuid,index.hidden"]);
  });
}
test("a filtered settings response cannot authorize a forbidden index directory", async () => {
  const calls: string[] = [];
  const client: Transport = {
    async request(p) {
      calls.push(p.path);
      if (p.path.startsWith("/_list"))
        return {
          body: {
            indices: [
              { index: "secret", uuid: "s", pri: 1, rep: 0, status: "open" },
            ],
          },
        };
      return { body: {} };
    },
  };
  await assert.rejects(
    getSnapshot(client, "*"),
    (e: any) => e.statusCode === 403,
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((path) => !path.startsWith("/_cluster/state")));
});
test("authorization denial recognizes Dashboards HTTP errors", () => {
  assert.equal(accessDenied({ response: { status: 403 } }), true);
  assert.equal(accessDenied({ body: { statusCode: 401 } }), true);
  assert.equal(accessDenied({ statusCode: 429 }), false);
});
