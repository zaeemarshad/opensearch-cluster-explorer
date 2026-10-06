/* SPDX-License-Identifier: Apache-2.0 */
import type {
  Snapshot,
  ShardCopy,
  NodeInfo,
  IndexInfo,
  SourceStatus,
  CopySelector,
  ShardMetrics,
  Recovery,
} from "../common/types";
// OpenSearch's API objects are dynamic at the boundary. Only explicitly selected fields
// enter the browser contract; missing values are preserved as null, never invented zeros.
export type ApiObject = Record<string, any>;
export const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const settingNumber = (value: unknown): number | null =>
  value === undefined || value === null || value === ""
    ? null
    : numeric(Number(value));
const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
function copiesFromState(state: ApiObject): ShardCopy[] {
  const copies: ShardCopy[] = [];
  for (const [index, entry] of Object.entries(
    state.routing_table?.indices || {},
  ) as Array<[string, ApiObject]>) {
    const uuid =
      state.metadata?.indices?.[index]?.settings?.index?.uuid ||
      state.metadata?.indices?.[index]?.uuid ||
      index;
    for (const [shardNumber, routes] of Object.entries(
      entry.shards || {},
    ) as Array<[string, ApiObject[]]>) {
      const groupStart = copies.length;
      routes.forEach((route, ordinal) => {
        const allocationId = text(route.allocation_id?.id);
        copies.push({
          id: `${uuid}:${shardNumber}:${allocationId || `unassigned-${route.primary ? "p" : "r"}-${ordinal}`}`,
          index,
          indexUuid: uuid,
          shard: Number(shardNumber),
          primary: route.primary === true,
          node: text(route.node),
          state: route.state,
          allocationId,
          relocatingNode: text(route.relocating_node),
          relocationTarget: false,
          unassignedReason: text(route.unassigned_info?.reason),
        });
        // Routing tables normally contain the relocating source, not a second configured copy.
        if (route.state === "RELOCATING" && route.relocating_node) {
          const targetId = text(route.allocation_id?.relocation_id);
          const alreadyListed = routes.some(
            (r) =>
              r.node === route.relocating_node &&
              r.state === "INITIALIZING" &&
              r.relocating_node === route.node,
          );
          if (!alreadyListed)
            copies.push({
              ...copies[copies.length - 1],
              id: `${uuid}:${shardNumber}:${targetId || `${allocationId}-target`}`,
              node: route.relocating_node,
              state: "INITIALIZING",
              allocationId: targetId,
              relocatingNode: text(route.node),
              relocationTarget: true,
            });
        }
      });
      for (const copy of copies
        .slice(groupStart)
        .filter((c) => c.state === "INITIALIZING")) {
        copy.relocationTarget = routes.some(
          (r) =>
            r.state === "RELOCATING" &&
            r.relocating_node === copy.node &&
            r.node === copy.relocatingNode,
        );
      }
    }
  }
  return copies;
}
export function normaliseSnapshot(
  state: ApiObject,
  health: ApiObject | null,
  nodeStats: ApiObject | null,
  sources: SourceStatus[],
  scope: string,
  maxCopies = 25000,
): Snapshot {
  const allCopies = copiesFromState(state);
  const indices: IndexInfo[] = Object.entries(
    state.metadata?.indices || {},
  ).map(([name, raw]) => {
    const index = raw as ApiObject;
    const settings = index.settings?.index || {};
    return {
      name,
      uuid: settings.uuid || index.uuid || name,
      primaries: settingNumber(settings.number_of_shards),
      replicas: settingNumber(settings.number_of_replicas),
      hidden:
        settings.hidden === "true" ||
        settings.hidden === true ||
        name.startsWith("."),
      state: index.state || "open",
    };
  });
  for (const name of new Set(allCopies.map((c) => c.index)))
    if (!indices.some((i) => i.name === name)) {
      indices.push({
        name,
        uuid: allCopies.find((c) => c.index === name)!.indexUuid,
        primaries: null,
        replicas: null,
        hidden: name.startsWith("."),
        state: "unknown",
      });
    }
  const nodes: NodeInfo[] = Object.entries(state.nodes || {}).map(
    ([id, raw]) => {
      const node = raw as ApiObject;
      const stats = nodeStats?.nodes?.[id];
      const total = numeric(stats?.fs?.total?.total_in_bytes),
        available = numeric(stats?.fs?.total?.available_in_bytes);
      return {
        id,
        name: node.name || id,
        roles: node.roles || [],
        attributes: node.attributes || {},
        diskUsedPercent:
          total !== null && total > 0 && available !== null
            ? Math.min(100, Math.max(0, ((total - available) / total) * 100))
            : null,
        diskAvailableBytes: available,
        heapUsedPercent: numeric(stats?.jvm?.mem?.heap_used_percent),
        cpuPercent: numeric(stats?.os?.cpu?.percent),
        sampleAt: numeric(stats?.timestamp),
      };
    },
  );
  const truncated = allCopies.length > maxCopies;
  return {
    clusterName:
      state.cluster_name || health?.cluster_name || "Unknown cluster",
    clusterUuid: state.cluster_uuid || "",
    observedAt: new Date().toISOString(),
    stateVersion: numeric(state.version),
    scope,
    health: health
      ? {
          status: health.status || "unknown",
          nodes: numeric(health.number_of_nodes),
          activePrimaries: numeric(health.active_primary_shards),
          activeShards: numeric(health.active_shards),
          unassigned: numeric(health.unassigned_shards),
          initialising: numeric(health.initializing_shards),
          relocating: numeric(health.relocating_shards),
        }
      : null,
    nodes: nodes.sort((a, b) => a.name.localeCompare(b.name)),
    indices: indices.sort((a, b) => a.name.localeCompare(b.name)),
    copies: allCopies.slice(0, maxCopies),
    sources,
    complete: sources.every((s) => s.ok) && !truncated,
    truncated,
    returnedCopies: Math.min(allCopies.length, maxCopies),
    totalCopies: allCopies.length,
  };
}
export function resolveCopy(
  state: ApiObject,
  selected: CopySelector,
): ShardCopy | null {
  return (
    copiesFromState(state).find(
      (c) =>
        c.index === selected.index &&
        c.indexUuid === selected.indexUuid &&
        c.shard === selected.shard &&
        c.primary === selected.primary &&
        c.node === selected.node &&
        c.allocationId === selected.allocationId,
    ) || null
  );
}
export function normaliseShardMetrics(
  stats: ApiObject,
  selected: CopySelector,
): ShardMetrics | null {
  if (!selected.node) return null;
  const index = stats.indices?.[selected.index];
  if (index?.uuid && index.uuid !== selected.indexUuid) return null;
  const candidates = (index?.shards?.[String(selected.shard)] || []).filter(
    (s: ApiObject) =>
      s.routing?.node === selected.node &&
      s.routing?.primary === selected.primary &&
      (!s.routing?.allocation_id?.id ||
        s.routing.allocation_id.id === selected.allocationId),
  );
  if (candidates.length !== 1) return null;
  const s = candidates[0];
  return {
    documents: numeric(s.docs?.count),
    deletedDocuments: numeric(s.docs?.deleted),
    segments: numeric(s.segments?.count),
    storeBytes: numeric(s.store?.size_in_bytes),
    segmentMemoryBytes: numeric(s.segments?.memory_in_bytes),
    indexWriterMemoryBytes: numeric(s.segments?.index_writer_memory_in_bytes),
    versionMapMemoryBytes: numeric(s.segments?.version_map_memory_in_bytes),
    translogBytes: numeric(s.translog?.size_in_bytes),
    translogOperations: numeric(s.translog?.operations),
    uncommittedOperations: numeric(s.translog?.uncommitted_operations),
    activeMerges: numeric(s.merges?.current),
    mergeTimeMillis: numeric(s.merges?.total_time_in_millis),
    refreshTotal: numeric(s.refresh?.total),
    refreshTimeMillis: numeric(s.refresh?.total_time_in_millis),
    indexingTotal: numeric(s.indexing?.index_total),
    indexingTimeMillis: numeric(s.indexing?.index_time_in_millis),
    queryTotal: numeric(s.search?.query_total),
    queryTimeMillis: numeric(s.search?.query_time_in_millis),
  };
}
export function normaliseRecovery(
  raw: ApiObject,
  selected: CopySelector,
): Recovery | null {
  const items = raw[selected.index]?.shards || [];
  const r = items.find(
    (v: ApiObject) =>
      v.id === selected.shard &&
      v.primary === selected.primary &&
      (v.target?.id === selected.node || v.source?.id === selected.node),
  );
  if (!r) return null;
  return {
    stage: r.stage,
    type: r.type,
    source: text(r.source?.name),
    target: text(r.target?.name),
    recoveredBytes: numeric(r.index?.size?.recovered_in_bytes),
    totalBytes: numeric(r.index?.size?.total_in_bytes),
    elapsedMillis: numeric(r.total_time_in_millis),
  };
}
