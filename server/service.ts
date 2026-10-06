/* SPDX-License-Identifier: Apache-2.0 */
import type { CopySelector, ShardDetails, SourceStatus } from "../common/types";
import {
  normaliseSnapshot,
  normaliseShardMetrics,
  normaliseRecovery,
  resolveCopy,
  ApiObject,
} from "./normalise";
export interface Transport {
  request(
    params: {
      method: string;
      path: string;
      querystring?: Record<string, unknown>;
      body?: unknown;
    },
    options?: { requestTimeout?: number },
  ): Promise<{ body: any }>;
}
export class ApiFailure extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function safeFailure(error: any): ApiFailure {
  if (error instanceof ApiFailure) return error;
  const status = error?.statusCode || error?.meta?.statusCode;
  if (status === 401 || status === 403)
    return new ApiFailure(
      status,
      "Your account is not permitted to read this cluster information.",
    );
  if (status === 404)
    return new ApiFailure(
      404,
      "The index or shard is no longer available. Refresh the cluster view.",
    );
  if (status === 429)
    return new ApiFailure(
      429,
      "OpenSearch is busy. Reduce the refresh frequency and retry.",
    );
  return new ApiFailure(
    502,
    "OpenSearch did not return the requested information. Retry or check the cluster connection.",
  );
}
export function validateIndex(index: string): string {
  if (
    !index ||
    index.length > 255 ||
    /[\\/*?,#\s:%<>|\[\]{}]/.test(index) ||
    index === "." ||
    index === ".." ||
    /^[+_-]/.test(index)
  )
    throw new ApiFailure(
      400,
      "Select one concrete index. Wildcards and index lists are not allowed here.",
    );
  return index;
}
export function validateScope(scope: string): string {
  // Allows index patterns and lists, but never URL syntax, date math or encoded path segments.
  if (
    !scope ||
    scope.length > 512 ||
    /[\\/#\s:%<>|\[\]{}]/.test(scope) ||
    scope.split(",").some((s) => !s || s === "." || s === "..")
  )
    throw new ApiFailure(
      400,
      "Enter a valid index pattern or comma-separated list.",
    );
  return scope;
}
const stateFields =
  "cluster_name,cluster_uuid,version,nodes.*.name,nodes.*.roles,nodes.*.attributes,metadata.indices.*.state,metadata.indices.*.settings.index.uuid,metadata.indices.*.settings.index.number_of_shards,metadata.indices.*.settings.index.number_of_replicas,metadata.indices.*.settings.index.hidden,routing_table.indices";
const bounded = (
  client: Transport,
  method: string,
  path: string,
  querystring: Record<string, unknown> = {},
  body?: unknown,
) =>
  client
    .request(
      { method, path, querystring, ...(body ? { body } : {}) },
      { requestTimeout: 10000 },
    )
    .then((r) => r.body);
async function sample(
  name: string,
  request: () => Promise<ApiObject>,
): Promise<{ data: ApiObject | null; status: SourceStatus }> {
  try {
    const data = await request();
    const failed =
      Number(data?._nodes?.failed || data?._shards?.failed || 0) > 0 ||
      data?.timed_out === true;
    return {
      data,
      status: {
        name,
        ok: !failed,
        observedAt: new Date().toISOString(),
        ...(failed
          ? { message: "OpenSearch returned an incomplete response." }
          : {}),
      },
    };
  } catch (error) {
    const e = safeFailure(error);
    return {
      data: null,
      status: {
        name,
        ok: false,
        observedAt: new Date().toISOString(),
        statusCode: e.statusCode,
        message: e.message,
      },
    };
  }
}
export async function getSnapshot(
  client: Transport,
  scope: string,
  nextToken?: string,
) {
  validateScope(scope);
  const directory = await bounded(
    client,
    "GET",
    `/_list/indices/${encodeURIComponent(scope)}`,
    {
      format: "json",
      size: 25,
      h: "index,uuid,pri,rep,status",
      expand_wildcards: "all",
      cluster_manager_timeout: "5s",
      ...(nextToken ? { next_token: nextToken } : {}),
    },
  );
  if (!Array.isArray(directory.indices) || directory.indices.length > 25)
    throw new ApiFailure(
      502,
      "Invalid index directory page. Reload the index scope.",
    );
  const names = directory.indices.map((i: any) => validateIndex(i.index));
  const authorizedSettings = names.length
    ? await authorizeIndices(client, names)
    : {};
  const shardWork = directory.indices.reduce(
    (n: number, i: any) => n + Number(i.pri || 0) * (1 + Number(i.rep || 0)),
    0,
  );
  const routingOmitted = !Number.isFinite(shardWork) || shardWork > 2000;
  const scopePage = names.map(encodeURIComponent).join(",");
  const [state, health, nodes, activity] = await Promise.all([
    sample("Routing and nodes", () =>
      bounded(
        client,
        "GET",
        names.length && !routingOmitted
          ? `/_cluster/state/metadata,routing_table,nodes/${scopePage}`
          : "/_cluster/state/nodes",
        {
          filter_path: stateFields,
          cluster_manager_timeout: "5s",
        },
      ),
    ),
    sample("Cluster health", () =>
      bounded(client, "GET", "/_cluster/health", {
        cluster_manager_timeout: "5s",
      }),
    ),
    sample("Node metrics", () =>
      bounded(client, "GET", "/_nodes/stats/os,jvm,fs", {
        filter_path:
          "_nodes.failed,nodes.*.timestamp,nodes.*.fs.total,nodes.*.jvm.mem.heap_used_percent,nodes.*.os.cpu.percent",
        timeout: "5s",
      }),
    ),
    names.length && !routingOmitted
      ? sample("Index activity", () =>
          bounded(
            client,
            "GET",
            `/${scopePage}/_stats/docs,store,indexing,search,merge,refresh,flush`,
            {
              level: "indices",
              expand_wildcards: "all",
              filter_path:
                "_shards,indices.*.uuid,indices.*.primaries.docs,indices.*.primaries.store,indices.*.primaries.indexing,indices.*.total.search,indices.*.total.merges,indices.*.total.refresh,indices.*.total.flush",
            },
          ),
        )
      : Promise.resolve({
          data: null,
          status: {
            name: "Index activity",
            ok: !routingOmitted,
            observedAt: new Date().toISOString(),
            message:
              "Page exceeds the 2,000-copy monitoring budget. Narrow the index scope.",
          },
        }),
  ]);
  if (!state.data)
    throw new ApiFailure(
      state.status.statusCode || 502,
      state.status.message || "Routing information is unavailable.",
    );
  if (
    names.length &&
    !routingOmitted &&
    (!state.data.routing_table?.indices ||
      !state.data.metadata?.indices ||
      !state.data.nodes)
  )
    throw new ApiFailure(
      502,
      "OpenSearch returned incomplete routing information. Refresh the cluster view.",
    );
  state.data.routing_table ||= { indices: {} };
  state.data.metadata ||= { indices: {} };
  const result = normaliseSnapshot(
    state.data,
    health.data,
    nodes.data,
    [state.status, health.status, nodes.status, activity.status],
    scope,
    4000,
  );
  // The directory is server paged; metadata and stats never fan out to off-page indices.
  result.indices = directory.indices.map((i: any) => ({
    name: i.index,
    uuid: i.uuid,
    primaries: Number(i.pri),
    replicas: Number(i.rep),
    hidden:
      i.index.startsWith(".") ||
      authorizedSettings?.[i.index]?.settings?.index?.hidden === true ||
      authorizedSettings?.[i.index]?.settings?.index?.hidden === "true",
    state: i.status,
    activity:
      activity.status.ok && activity.data?.indices?.[i.index]?.uuid === i.uuid
        ? indexActivity(activity.data!.indices[i.index], Date.now())
        : undefined,
  }));
  result.nextToken = directory.next_token || null;
  result.routingOmitted = routingOmitted;
  return result;
}
async function authorizeIndex(client: Transport, selected: CopySelector) {
  validateIndex(selected.index);
  // Cluster-state and allocation-explain privileges are cluster-wide. An
  // index-scoped read must succeed before either can expose a selected index.
  await authorizeIndices(client, [selected.index]);
}
async function authorizeIndices(client: Transport, names: string[]) {
  const settings = await bounded(
    client,
    "GET",
    `/${names.map(encodeURIComponent).join(",")}/_settings/index.uuid,index.hidden`,
    {
      filter_path: "*.settings.index.uuid,*.settings.index.hidden",
      expand_wildcards: "all",
    },
  );
  // Some Security configurations omit forbidden indices instead of failing.
  // Fail closed for incomplete pages rather than exposing directory metadata.
  if (names.some((name) => !settings?.[name]?.settings?.index?.uuid))
    throw new ApiFailure(
      403,
      "Your account is not permitted to monitor every index in this page. Narrow the index scope to permitted indices.",
    );
  return settings;
}
async function currentCopy(client: Transport, selected: CopySelector) {
  validateIndex(selected.index);
  const metadata = await bounded(
    client,
    "GET",
    `/_cluster/state/metadata/${encodeURIComponent(selected.index)}`,
    {
      filter_path:
        "metadata.indices.*.settings.index.number_of_shards,metadata.indices.*.settings.index.number_of_replicas",
      cluster_manager_timeout: "5s",
    },
  );
  const settings =
    metadata.metadata?.indices?.[selected.index]?.settings?.index;
  if (
    Number(settings?.number_of_shards) *
      (1 + Number(settings?.number_of_replicas)) >
    2000
  )
    throw new ApiFailure(
      413,
      "This index exceeds the 2,000-copy monitoring budget. Shard statistics are disabled to protect the cluster.",
    );
  const state = await bounded(
    client,
    "GET",
    `/_cluster/state/metadata,routing_table/${encodeURIComponent(selected.index)}`,
    { filter_path: stateFields, cluster_manager_timeout: "5s" },
  );
  const copy = resolveCopy(state, selected);
  if (!copy)
    throw new ApiFailure(
      409,
      "This shard allocation has changed. Refresh and select its current copy.",
    );
  return copy;
}
export async function getShardDetails(
  client: Transport,
  selected: CopySelector,
): Promise<ShardDetails> {
  await authorizeIndex(client, selected);
  const copy = await currentCopy(client, selected);
  if (copy.node === null)
    return {
      observedAt: new Date().toISOString(),
      metrics: null,
      unavailableReason:
        "This copy is unassigned. No node can provide its shard statistics.",
      recovery: null,
      sources: [],
    };
  const index = encodeURIComponent(selected.index);
  const [stats, recovery] = await Promise.all([
    sample("Shard statistics", () =>
      bounded(
        client,
        "GET",
        `/${index}/_stats/docs,store,segments,translog,merge,refresh,indexing,search`,
        {
          level: "shards",
          filter_path:
            "_shards,indices.*.uuid,indices.*.shards.*.routing,indices.*.shards.*.docs,indices.*.shards.*.store,indices.*.shards.*.segments,indices.*.shards.*.translog,indices.*.shards.*.merges,indices.*.shards.*.refresh,indices.*.shards.*.indexing,indices.*.shards.*.search",
        },
      ),
    ),
    sample("Recovery", () =>
      bounded(client, "GET", `/${index}/_recovery`, {
        active_only: true,
        detailed: false,
      }),
    ),
  ]);
  // Detect relocation/reallocation between routing and statistics collection.
  await currentCopy(client, selected);
  const metrics = stats.data
    ? normaliseShardMetrics(stats.data, selected)
    : null;
  return {
    observedAt: new Date().toISOString(),
    metrics,
    unavailableReason: metrics
      ? null
      : stats.status.message ||
        "Statistics are not yet available for this copy. It may be initialising.",
    recovery: recovery.data ? normaliseRecovery(recovery.data, selected) : null,
    sources: [stats.status, recovery.status],
  };
}
export async function explainShard(client: Transport, selected: CopySelector) {
  await authorizeIndex(client, selected);
  const copy = await currentCopy(client, selected);
  if (copy.relocationTarget)
    throw new ApiFailure(
      400,
      "Select the relocating source to explain this allocation.",
    );
  const explanation = await bounded(
    client,
    "POST",
    "/_cluster/allocation/explain",
    { include_yes_decisions: true, include_disk_info: true },
    {
      index: selected.index,
      shard: selected.shard,
      primary: selected.primary,
      ...(selected.node ? { current_node: selected.node } : {}),
    },
  );
  // An allocation may move while the explain request is in flight. Do not
  // present a decision for an old node as if it described the selected copy.
  await currentCopy(client, selected);
  // Unassigned replica copies cannot be individually addressed by this API. The UI labels this explicitly.
  return { observedAt: new Date().toISOString(), explanation };
}

function indexActivity(raw: any, observedAt: number) {
  const p = raw.primaries || {},
    t = raw.total || {};
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    observedAt,
    counters: {
      indexing: n(p.indexing?.index_total),
      indexingMillis: n(p.indexing?.index_time_in_millis),
      deletes: n(p.indexing?.delete_total),
      search: n(t.search?.query_total),
      searchMillis: n(t.search?.query_time_in_millis),
      fetch: n(t.search?.fetch_total),
      fetchMillis: n(t.search?.fetch_time_in_millis),
      merges: n(t.merges?.total),
      refreshes: n(t.refresh?.total),
      flushes: n(t.flush?.total),
    },
    values: {
      documents: n(p.docs?.count),
      storeBytes: n(p.store?.size_in_bytes),
      indexingCurrent: n(p.indexing?.index_current),
      searchCurrent: n(t.search?.query_current),
      mergeCurrent: n(t.merges?.current),
      indexingFailures: n(p.indexing?.index_failed),
    },
  };
}
