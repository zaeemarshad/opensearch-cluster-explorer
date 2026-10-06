/* SPDX-License-Identifier: Apache-2.0 */
import type {
  Snapshot,
  ShardCopy,
  CopySelector,
  ShardDetails,
  ExplainResult,
} from "../common/types";
export interface HttpClient {
  get<T>(
    path: string,
    options?: { query?: Record<string, string>; signal?: AbortSignal },
  ): Promise<T>;
  post<T>(
    path: string,
    options?: { body?: string; signal?: AbortSignal },
  ): Promise<T>;
}
export interface ClusterClient {
  snapshot(
    scope: string,
    signal: AbortSignal,
    nextToken?: string,
  ): Promise<Snapshot>;
  shard(copy: ShardCopy, signal: AbortSignal): Promise<ShardDetails>;
  explain(copy: ShardCopy, signal: AbortSignal): Promise<ExplainResult>;
}
const selector = (c: ShardCopy): CopySelector => ({
  index: c.index,
  indexUuid: c.indexUuid,
  shard: c.shard,
  primary: c.primary,
  node: c.node,
  allocationId: c.allocationId,
});
export class LiveClient implements ClusterClient {
  constructor(private readonly http: HttpClient) {}
  snapshot(scope: string, signal: AbortSignal, nextToken?: string) {
    return this.http.get<Snapshot>("/api/cluster_explorer/snapshot", {
      query: { scope, ...(nextToken ? { nextToken } : {}) },
      signal,
    });
  }
  shard(copy: ShardCopy, signal: AbortSignal) {
    return this.http.post<ShardDetails>("/api/cluster_explorer/shard", {
      body: JSON.stringify(selector(copy)),
      signal,
    });
  }
  explain(copy: ShardCopy, signal: AbortSignal) {
    return this.http.post<ExplainResult>("/api/cluster_explorer/explain", {
      body: JSON.stringify(selector(copy)),
      signal,
    });
  }
}
export function errorMessage(error: unknown): string {
  const e = error as { body?: { message?: string }; message?: string };
  return e?.body?.message || e?.message || "The request failed. Please retry.";
}
export function accessDenied(error: unknown): boolean {
  const e = error as {
    response?: { status?: number };
    body?: { statusCode?: number };
    statusCode?: number;
  };
  const status = e?.response?.status ?? e?.body?.statusCode ?? e?.statusCode;
  return status === 401 || status === 403;
}
