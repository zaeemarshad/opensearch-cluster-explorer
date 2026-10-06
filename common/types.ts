/* SPDX-License-Identifier: Apache-2.0 */
export type ShardState =
  | "STARTED"
  | "UNASSIGNED"
  | "INITIALIZING"
  | "RELOCATING";
export interface ShardCopy {
  id: string;
  index: string;
  indexUuid: string;
  shard: number;
  primary: boolean;
  node: string | null;
  state: ShardState;
  allocationId: string | null;
  relocatingNode: string | null;
  relocationTarget: boolean;
  unassignedReason: string | null;
}
export interface NodeInfo {
  id: string;
  name: string;
  roles: string[];
  attributes: Record<string, string>;
  diskUsedPercent: number | null;
  diskAvailableBytes: number | null;
  heapUsedPercent: number | null;
  cpuPercent: number | null;
  sampleAt: number | null;
}
export interface IndexInfo {
  name: string;
  uuid: string;
  primaries: number | null;
  replicas: number | null;
  hidden: boolean;
  state: string;
  activity?: IndexActivity;
}
export interface SourceStatus {
  name: string;
  ok: boolean;
  observedAt: string;
  statusCode?: number;
  message?: string;
}
export interface Snapshot {
  clusterName: string;
  clusterUuid: string;
  observedAt: string;
  stateVersion: number | null;
  health: {
    status: string;
    nodes: number | null;
    activePrimaries: number | null;
    activeShards: number | null;
    unassigned: number | null;
    initialising: number | null;
    relocating: number | null;
  } | null;
  nodes: NodeInfo[];
  indices: IndexInfo[];
  copies: ShardCopy[];
  sources: SourceStatus[];
  complete: boolean;
  truncated: boolean;
  returnedCopies: number;
  totalCopies: number;
  scope: string;
  nextToken?: string | null;
  routingOmitted?: boolean;
}
export interface CopySelector {
  index: string;
  indexUuid: string;
  shard: number;
  primary: boolean;
  node: string | null;
  allocationId: string | null;
}
export interface ShardMetrics {
  documents: number | null;
  deletedDocuments: number | null;
  segments: number | null;
  storeBytes: number | null;
  segmentMemoryBytes: number | null;
  indexWriterMemoryBytes: number | null;
  versionMapMemoryBytes: number | null;
  translogBytes: number | null;
  translogOperations: number | null;
  uncommittedOperations: number | null;
  activeMerges: number | null;
  mergeTimeMillis: number | null;
  refreshTotal: number | null;
  refreshTimeMillis: number | null;
  indexingTotal: number | null;
  indexingTimeMillis: number | null;
  queryTotal: number | null;
  queryTimeMillis: number | null;
}
export interface Recovery {
  stage: string;
  type: string;
  source: string | null;
  target: string | null;
  recoveredBytes: number | null;
  totalBytes: number | null;
  elapsedMillis: number | null;
}
export interface ShardDetails {
  observedAt: string;
  metrics: ShardMetrics | null;
  unavailableReason: string | null;
  recovery: Recovery | null;
  sources: SourceStatus[];
}
export interface ExplainResult {
  observedAt: string;
  explanation: Record<string, unknown>;
}

export interface IndexActivity {
  observedAt: number;
  counters: Record<string, number | null>;
  values: Record<string, number | null>;
  rates?: Record<string, number | null>;
  intervalSeconds?: number;
  rateObservedAt?: number;
}
