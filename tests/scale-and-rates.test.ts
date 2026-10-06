import { test } from "node:test";
import assert from "node:assert/strict";
import { activityRates } from "../public/activity";
import { getSnapshot, Transport } from "../server/service";
import { monitor } from "../server/monitor";

test("admission control rejects concurrent work without queuing it", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = monitor(() => pending);
  const second = monitor(() => pending);
  let started = false;
  await assert.rejects(
    monitor(async () => {
      started = true;
    }),
    (error: any) => error.statusCode === 429,
  );
  assert.equal(started, false);
  release();
  await Promise.all([first, second]);
});

test("rates require 30 seconds and counter resets stay unavailable", () => {
  const a = {
    observedAt: 0,
    counters: {
      indexing: 100,
      indexingMillis: 200,
      search: 50,
      searchMillis: 100,
    },
    values: {},
  };
  assert.equal(activityRates(undefined, a).rates, undefined);
  assert.equal(activityRates(a, { ...a, observedAt: 29000 }).rates, undefined);
  const b = activityRates(a, {
    ...a,
    observedAt: 30000,
    counters: {
      indexing: 160,
      indexingMillis: 320,
      search: 80,
      searchMillis: 160,
    },
  });
  assert.equal(b.rates?.indexing, 2);
  assert.equal(b.rates?.search, 1);
  assert.equal(b.rates?.indexingLatency, 2);
  assert.equal(b.rates?.searchLatency, 2);
  assert.equal(
    activityRates(b, { ...a, observedAt: 60000 }).rates?.indexing,
    null,
  );
});

test("20,000-index discovery only requests routing/stats for 25 indices", async () => {
  const inventory = Array.from({ length: 20000 }, (_, n) => ({
    index: `index-${n}`,
    uuid: `uuid-${n}`,
    pri: n % 4 === 0 ? "2" : "1",
    rep: "1",
    status: "open",
  }));
  // 50,000 copies in the inventory; the backend receives one server page.
  const calls: any[] = [];
  const client: Transport = {
    async request(p) {
      calls.push(p);
      if (p.path.endsWith("/_settings/index.uuid,index.hidden"))
        return {
          body: Object.fromEntries(
            inventory
              .slice(0, 25)
              .map((i) => [i.index, { settings: { index: { uuid: i.uuid } } }]),
          ),
        };
      if (p.path.startsWith("/_list")) {
        assert.equal(p.querystring?.size, 25);
        return {
          body: { indices: inventory.slice(0, 25), next_token: "page-2" },
        };
      }
      if (p.path.startsWith("/_cluster/state"))
        return {
          body: {
            nodes: {},
            metadata: { indices: {} },
            routing_table: { indices: {} },
          },
        };
      return { body: {} };
    },
  };
  const page = await getSnapshot(client, "*");
  assert.equal(page.indices.length, 25);
  assert.equal(page.nextToken, "page-2");
  assert.equal(calls.length, 6);
  for (const call of calls.filter(
    (c) => c.path.includes("/_stats/") || c.path.startsWith("/_cluster/state"),
  )) {
    assert.ok(!call.path.includes("index-25"));
    assert.ok(!call.path.includes("*"));
  }
});

test("oversized page omits routing and shard-fanout metrics", async () => {
  const calls: any[] = [];
  const client: Transport = {
    async request(p) {
      calls.push(p);
      if (p.path.endsWith("/_settings/index.uuid,index.hidden"))
        return { body: { big: { settings: { index: { uuid: "big-id" } } } } };
      if (p.path.startsWith("/_list"))
        return {
          body: {
            indices: [
              {
                index: "big",
                uuid: "big-id",
                pri: "25000",
                rep: "1",
                status: "open",
              },
            ],
            next_token: null,
          },
        };
      return { body: { nodes: {} } };
    },
  };
  const page = await getSnapshot(client, "*");
  assert.equal(page.routingOmitted, true);
  assert.equal(page.complete, false);
  assert.equal(page.copies.length, 0);
  assert.ok(
    calls.every(
      (c) => !c.path.includes("routing_table") && !c.path.includes("/_stats/"),
    ),
  );
});
