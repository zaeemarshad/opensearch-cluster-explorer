/* SPDX-License-Identifier: Apache-2.0 */
import { activityRates } from "../activity";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  EuiBadge,
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutHeader,
  EuiFlyoutBody,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSelect,
  EuiStat,
  EuiSwitch,
  EuiTab,
  EuiTabs,
  EuiTitle,
} from "@elastic/eui";
import type {
  Snapshot,
  ShardCopy,
  ShardDetails,
  ExplainResult,
  NodeInfo,
  IndexInfo,
} from "../../common/types";
import { ClusterClient, errorMessage, accessDenied } from "../client";

type Selection =
  | { type: "shard"; id: string }
  | { type: "node"; id: string }
  | { type: "index"; id: string }
  | null;
const rateText = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value.toLocaleString("en-AU", { maximumFractionDigits: 2 });
const count = (value: number | null | undefined) =>
  value == null ? "Unavailable" : value.toLocaleString("en-AU");
const bytes = (value: number | null | undefined) => {
  if (value == null) return "Unavailable";
  if (value === 0) return "0 B";
  const unit = Math.min(
    4,
    Math.floor(Math.log(Math.abs(value)) / Math.log(1024)),
  );
  return `${(value / 1024 ** unit).toLocaleString("en-AU", { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
};
const percent = (value: number | null | undefined) =>
  value == null ? "Unavailable" : `${value.toFixed(1)}%`;
const timestamp = (value: string | number | null) =>
  value === null || !Number.isFinite(new Date(value).getTime())
    ? "Unavailable"
    : new Date(value).toLocaleString("en-AU");
const duration = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : `${(value / 1000).toLocaleString("en-AU", { maximumFractionDigits: 1 })} s`;
const displayState = (state: string) =>
  ({
    STARTED: "Started",
    UNASSIGNED: "Unassigned",
    INITIALIZING: "Initialising",
    RELOCATING: "Relocating",
  })[state] || state;
function useSnapshot(
  client: ClusterClient,
  scope: string,
  seconds: number,
  paused: boolean,
  revision: number,
  nextToken?: string,
) {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const previousPage = useRef({ scope, nextToken });
  const samples = useRef(
    new Map<string, import("../../common/types").IndexActivity>(),
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    if (
      previousPage.current.scope !== scope ||
      previousPage.current.nextToken !== nextToken
    ) {
      setData(null);
      setError("");
      previousPage.current = { scope, nextToken };
    }
    async function refresh() {
      if (controller.signal.aborted) return;
      if (document.hidden) {
        if (!paused) timer = setTimeout(refresh, Math.max(30, seconds) * 1000);
        return;
      }
      setLoading(true);
      try {
        const next = await client.snapshot(scope, controller.signal, nextToken);
        for (const index of next.indices) {
          if (!index.activity) continue;
          const key = `${next.clusterUuid}:${index.uuid}`;
          const previous = samples.current.get(key);
          const current = activityRates(previous, index.activity);
          index.activity = current;
          if (!previous || current.observedAt - previous.observedAt >= 30000) {
            samples.current.delete(key);
            samples.current.set(key, current);
          }
          if (samples.current.size > 500)
            samples.current.delete(samples.current.keys().next().value!);
        }
        if (!controller.signal.aborted) {
          setData(next);
          setError("");
          failures = 0;
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          if (accessDenied(e)) {
            setData(null);
            samples.current.clear();
          }
          setError(errorMessage(e));
          failures++;
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (!paused)
            timer = setTimeout(
              refresh,
              Math.min(
                300,
                Math.max(30, seconds) * 2 ** Math.min(failures, 3),
              ) * 1000,
            );
        }
      }
    }
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, scope, seconds, paused, revision, nextToken]);
  return { data, error, loading };
}
export function Explorer({ client }: { client: ClusterClient }) {
  const [scope, setScope] = useState("*"),
    [scopeInput, setScopeInput] = useState("*"),
    [seconds, setSeconds] = useState(30),
    [paused, setPaused] = useState(true),
    [revision, setRevision] = useState(0);
  const [tokens, setTokens] = useState<Array<string | undefined>>([undefined]);
  const { data, error, loading } = useSnapshot(
    client,
    scope,
    seconds,
    paused,
    revision,
    tokens[tokens.length - 1],
  );
  const [view, setView] = useState("Allocation"),
    [search, setSearch] = useState(""),
    [nodeId, setNodeId] = useState("all"),
    [state, setState] = useState("all"),
    [system, setSystem] = useState(false),
    [selection, setSelection] = useState<Selection>(null),
    [table, setTable] = useState(false),
    [page, setPage] = useState(0),
    [nodePage, setNodePage] = useState(0),
    [zoneKey, setZoneKey] = useState(""),
    [zone, setZone] = useState("all");
  const reset = () => {
    setSearch("");
    setNodeId("all");
    setState("all");
    setSystem(false);
    setZoneKey("");
    setZone("all");
  };
  useEffect(() => {
    if (!data) setSelection(null);
  }, [data]);
  useEffect(() => {
    setPage(0);
    setNodePage(0);
  }, [search, nodeId, state, system, zone, zoneKey, scope, view, table]);
  const nodes = data?.nodes || [],
    copies = data?.copies || [];
  const attributes = useMemo(
    () =>
      Array.from(
        new Set(nodes.flatMap((n) => Object.keys(n.attributes))),
      ).sort(),
    [data],
  );
  const visibleNodes = nodes.filter(
    (n) =>
      (nodeId === "all" || n.id === nodeId) &&
      (!zoneKey || zone === "all" || n.attributes[zoneKey] === zone),
  );
  const candidateIndices = (data?.indices || []).filter(
    (i) =>
      (system || !i.hidden) &&
      i.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredCopies = copies.filter(
    (c) =>
      candidateIndices.some((i) => i.name === c.index) &&
      (state === "all" || c.state === state) &&
      (c.node === null
        ? nodeId === "all" && zone === "all"
        : visibleNodes.some((n) => n.id === c.node)),
  );
  const visibleIndices = candidateIndices.filter(
    (i) =>
      (state === "all" && nodeId === "all" && zone === "all") ||
      filteredCopies.some((c) => c.indexUuid === i.uuid),
  );
  const shownIndices = visibleIndices.slice(page * 25, page * 25 + 25);
  const dataNodes = visibleNodes.filter(
    (n) =>
      n.roles.some((r) => r === "data" || r.startsWith("data_")) ||
      copies.some((c) => c.node === n.id),
  );
  const columns = dataNodes.slice(nodePage * 8, nodePage * 8 + 8);
  const assigned = copies.filter((c) => c.node !== null && !c.relocationTarget),
    unassigned = copies.filter((c) => c.node === null),
    matchedUnassigned = filteredCopies.filter((c) => c.node === null);
  const chosen =
    selection?.type === "shard"
      ? copies.find((c) => c.id === selection.id)
      : null;
  const selectedNode =
    selection?.type === "node"
      ? nodes.find((n) => n.id === selection.id)
      : null;
  const selectedIndex =
    selection?.type === "index"
      ? data?.indices.find((i) => i.uuid === selection.id)
      : null;
  const nodeName = (id: string | null) =>
    id === null ? "Unassigned" : nodes.find((n) => n.id === id)?.name || id;
  function tile(c: ShardCopy) {
    const related =
      chosen?.indexUuid === c.indexUuid && chosen?.shard === c.shard;
    return (
      <button
        key={c.id}
        className={`ceShard ceShard--${c.state.toLowerCase()} ${c.primary ? "" : "ceShard--replica"} ${related ? "ceShard--related" : ""}`}
        aria-label={`${c.index}, shard ${c.shard}, ${c.primary ? "primary" : "replica"}, ${displayState(c.state)}, ${nodeName(c.node)}${c.relocationTarget ? ", relocation target" : ""}`}
        aria-pressed={chosen?.id === c.id}
        onClick={() => setSelection({ type: "shard", id: c.id })}
      >
        <b>{c.shard}</b>
        <span>{c.primary ? "P" : "R"}</span>
        {c.state !== "STARTED" && (
          <span>
            {c.state === "UNASSIGNED"
              ? "!"
              : c.state === "RELOCATING"
                ? "↗"
                : "↓"}
          </span>
        )}
      </button>
    );
  }
  return (
    <div className="ceApp">
      <div className="ceHeading">
        <div>
          <EuiTitle size="l">
            <h1>Cluster Explorer</h1>
          </EuiTitle>
          <p className="ceSub">
            {data?.clusterName || "OpenSearch cluster"} · read-only operational
            view
          </p>
        </div>
        <div className="ceControls">
          <span className="ceMuted" aria-live="polite">
            {data ? `Collected ${timestamp(data.observedAt)}` : ""}
          </span>
          <EuiSelect
            aria-label="Refresh interval"
            compressed
            value={paused ? 0 : seconds}
            options={[
              { value: 0, text: "Manual refresh (default)" },
              ...[30, 60, 120].map((v) => ({ value: v, text: `Every ${v}s` })),
            ]}
            onChange={(e) => {
              const value = Number(e.target.value);
              setPaused(value === 0);
              if (value) setSeconds(Math.max(30, value));
            }}
          />
          <EuiButtonEmpty size="s" onClick={() => setPaused(!paused)}>
            {paused ? "Enable auto-refresh" : "Pause"}
          </EuiButtonEmpty>
          <EuiButton
            size="s"
            isLoading={loading}
            onClick={() => setRevision((n) => n + 1)}
          >
            Refresh
          </EuiButton>
        </div>
      </div>
      <form
        className="ceScope"
        onSubmit={(e) => {
          e.preventDefault();
          setScope(scopeInput);
          setTokens([undefined]);
          setSelection(null);
          setRevision((n) => n + 1);
        }}
      >
        <label htmlFor="ceScope">Index scope</label>
        <input
          id="ceScope"
          className="euiFieldText euiFieldText--compressed"
          value={scopeInput}
          onChange={(e) => setScopeInput(e.target.value)}
          maxLength={512}
        />
        <EuiButton size="s" type="submit">
          Load scope
        </EuiButton>
        <span className="ceMuted">
          Use a pattern to bound routing data on large clusters.
        </span>
      </form>
      <div className="cePager">
        <span>
          Index page {tokens.length} · up to 25 indices · routing/statistics
          budget 2,000 copies. Search all indices with Index scope.
        </span>
        <EuiButtonEmpty
          disabled={loading || tokens.length === 1}
          onClick={() => {
            setTokens(tokens.slice(0, -1));
            setSelection(null);
          }}
        >
          Previous index page
        </EuiButtonEmpty>
        <EuiButtonEmpty
          disabled={loading || !data?.nextToken}
          onClick={() => {
            setTokens([...tokens, data!.nextToken!]);
            setSelection(null);
          }}
        >
          Next index page
        </EuiButtonEmpty>
      </div>
      <p className="ceFine">
        Activity rates are last known deltas between samples at least 30 seconds
        apart. First sample shows “—”; collect another sample after 30 seconds
        for rates. Indexing counts primaries; search counts shard query
        operations across all copies, not client requests. Manual refresh
        retains the last known rates.
      </p>
      {error && (
        <EuiCallOut
          title={
            data
              ? "Refresh failed · showing last successful snapshot"
              : "Could not load cluster"
          }
          color="danger"
        >
          <p>{error}</p>
        </EuiCallOut>
      )}
      {data && !data.complete && (
        <EuiCallOut title="Partial cluster view" color="warning">
          <ul>
            {data.sources
              .filter((s) => !s.ok)
              .map((s) => (
                <li key={s.name}>
                  {s.name}: {s.message}
                </li>
              ))}
            {data.truncated && (
              <li>
                Showing {count(data.returnedCopies)} of{" "}
                {count(data.totalCopies)} allocation entries. Narrow the index
                scope; displayed totals and distribution are incomplete.
              </li>
            )}
          </ul>
        </EuiCallOut>
      )}
      {!data && loading && (
        <div className="ceLoading">
          <EuiLoadingSpinner size="xl" />
          <p>Loading cluster routing and node metrics…</p>
        </div>
      )}
      {data && (
        <>
          <EuiPanel paddingSize="m" className="ceSummary">
            <EuiFlexGroup wrap>
              {[
                ["Cluster health", data.health?.status || "Unknown"],
                ["Nodes", count(data.health?.nodes)],
                ["Active primaries", count(data.health?.activePrimaries)],
                [
                  "Active replicas",
                  count(
                    data.health?.activeShards != null &&
                      data.health?.activePrimaries != null
                      ? Math.max(
                          0,
                          data.health.activeShards -
                            data.health.activePrimaries,
                        )
                      : null,
                  ),
                ],
                ["Unassigned", count(data.health?.unassigned)],
                ["Relocating", count(data.health?.relocating)],
              ].map(([title, value]) => (
                <EuiFlexItem key={title}>
                  <EuiStat title={value} description={title} titleSize="m" />
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
            <p className="ceFine">
              Cluster-wide health totals · includes indices outside the current
              scope and filters
            </p>
          </EuiPanel>
          {unassigned.length > 0 && (
            <EuiCallOut
              title={`${unassigned.length} unassigned copies in the loaded scope (${unassigned.filter((c) => c.primary).length} primary)`}
              color={unassigned.some((c) => c.primary) ? "danger" : "warning"}
            >
              <p>
                Select an unassigned copy to inspect its allocation explanation.{" "}
                <EuiButtonEmpty
                  size="s"
                  onClick={() => {
                    reset();
                    setSystem(true);
                    setState("UNASSIGNED");
                    setView("Allocation");
                  }}
                >
                  Show unassigned
                </EuiButtonEmpty>
              </p>
            </EuiCallOut>
          )}
          <EuiTabs aria-label="Explorer views">
            {["Allocation", "Nodes", "Indices"].map((t) => (
              <EuiTab
                key={t}
                isSelected={view === t}
                onClick={() => setView(t)}
              >
                {t}
              </EuiTab>
            ))}
          </EuiTabs>
          <EuiPanel paddingSize="none" className="ceWorkspace">
            <div className="ceFilters">
              <EuiFieldSearch
                aria-label="Filter loaded indices"
                compressed
                placeholder="Filter loaded indices"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <EuiSelect
                aria-label="Filter node"
                compressed
                value={nodeId}
                onChange={(e) => setNodeId(e.target.value)}
                options={[
                  { value: "all", text: "All nodes" },
                  ...nodes.map((n) => ({ value: n.id, text: n.name })),
                ]}
              />
              <EuiSelect
                aria-label="Filter shard state"
                compressed
                value={state}
                onChange={(e) => setState(e.target.value)}
                options={[
                  { value: "all", text: "All shard states" },
                  ...[
                    "STARTED",
                    "UNASSIGNED",
                    "INITIALIZING",
                    "RELOCATING",
                  ].map((v) => ({ value: v, text: displayState(v) })),
                ]}
              />
              <EuiSwitch
                label="System indices"
                checked={system}
                onChange={(e) => setSystem(e.target.checked)}
              />
              <EuiButtonEmpty size="s" onClick={reset}>
                Reset
              </EuiButtonEmpty>
            </div>
            <div className="ceControls ceSecondary">
              <label htmlFor="ceZoneAttribute">Zone attribute</label>
              <EuiSelect
                id="ceZoneAttribute"
                aria-label="Zone attribute"
                compressed
                value={zoneKey}
                onChange={(e) => {
                  setZoneKey(e.target.value);
                  setZone("all");
                }}
                options={[
                  { value: "", text: "None selected" },
                  ...attributes.map((v) => ({ value: v, text: v })),
                ]}
              />
              {zoneKey && (
                <EuiSelect
                  aria-label="Filter zone"
                  compressed
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                  options={[
                    { value: "all", text: "All zones" },
                    ...Array.from(
                      new Set(
                        nodes.map((n) => n.attributes[zoneKey]).filter(Boolean),
                      ),
                    )
                      .sort()
                      .map((v) => ({ value: v, text: v })),
                  ]}
                />
              )}
              <span className="ceMuted" role="status">
                {visibleIndices.length} matching indices ·{" "}
                {filteredCopies.filter((c) => !c.relocationTarget).length}{" "}
                configured copies
                {matchedUnassigned.length < unassigned.length
                  ? ` · ${unassigned.length - matchedUnassigned.length} unassigned hidden by filters`
                  : ""}
              </span>
              {view === "Allocation" && (
                <EuiButtonEmpty size="s" onClick={() => setTable(!table)}>
                  {table ? "Matrix view" : "Shard table"}
                </EuiButtonEmpty>
              )}
            </div>
            {view === "Allocation" && !table ? (
              <div className="ceTableScroll">
                <table className="ceMatrix">
                  <caption className="ceVisuallyHidden">
                    Shard placement by index and node
                  </caption>
                  <thead>
                    <tr>
                      <th>Index</th>
                      {columns.map((n) => (
                        <th key={n.id}>
                          <button
                            className="ceLink"
                            onClick={() =>
                              setSelection({ type: "node", id: n.id })
                            }
                          >
                            {n.name}
                          </button>
                          <small>
                            {zoneKey
                              ? n.attributes[zoneKey] || "No zone value"
                              : n.roles.join(", ")}
                          </small>
                          <small>Disk {percent(n.diskUsedPercent)}</small>
                          <div className="ceBar">
                            <i
                              style={{ width: `${n.diskUsedPercent || 0}%` }}
                            />
                          </div>
                          <small>
                            Heap {percent(n.heapUsedPercent)} ·{" "}
                            {assigned.filter((c) => c.node === n.id).length}{" "}
                            copies in scope
                          </small>
                        </th>
                      ))}
                      {unassigned.length > 0 && (
                        <th>
                          Unassigned
                          <small>
                            {matchedUnassigned.length} matching copies
                          </small>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shownIndices.map((i) => (
                      <tr key={i.uuid}>
                        <th>
                          <button
                            className="ceLink"
                            onClick={() =>
                              setSelection({ type: "index", id: i.uuid })
                            }
                          >
                            {i.name}
                          </button>
                          <small>
                            {count(i.primaries)} primaries · {count(i.replicas)}{" "}
                            replicas each
                          </small>
                        </th>
                        {columns.map((n) => (
                          <td key={n.id}>
                            <div className="ceTiles">
                              {filteredCopies
                                .filter(
                                  (c) =>
                                    c.indexUuid === i.uuid && c.node === n.id,
                                )
                                .slice(0, 100)
                                .map(tile)}
                            </div>
                          </td>
                        ))}
                        {unassigned.length > 0 && (
                          <td>
                            <div className="ceTiles">
                              {filteredCopies
                                .filter(
                                  (c) =>
                                    c.indexUuid === i.uuid && c.node === null,
                                )
                                .slice(0, 100)
                                .map(tile)}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : view === "Allocation" ? (
              <div className="ceTableScroll">
                <table className="ceTable">
                  <caption className="ceVisuallyHidden">
                    Matching shard copies
                  </caption>
                  <thead>
                    <tr>
                      <th>Index</th>
                      <th>Shard</th>
                      <th>Role</th>
                      <th>Node</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCopies
                      .slice(page * 100, page * 100 + 100)
                      .map((c) => (
                        <tr key={c.id}>
                          <td>
                            <button
                              className="ceLink"
                              aria-label={`Inspect ${c.index} shard ${c.shard}, ${c.primary ? "primary" : "replica"}, ${displayState(c.state)} on ${nodeName(c.node)}`}
                              onClick={() =>
                                setSelection({ type: "shard", id: c.id })
                              }
                            >
                              {c.index}
                            </button>
                          </td>
                          <td>{c.shard}</td>
                          <td>
                            {c.primary ? "Primary" : "Replica"}
                            {c.relocationTarget ? " · target" : ""}
                          </td>
                          <td>{nodeName(c.node)}</td>
                          <td>{displayState(c.state)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : view === "Nodes" ? (
              <div className="ceTableScroll">
                <table className="ceTable">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Roles</th>
                      <th>Disk used</th>
                      <th>Heap</th>
                      <th>CPU</th>
                      <th>Copies in scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleNodes.slice(page * 25, page * 25 + 25).map((n) => (
                      <tr key={n.id}>
                        <td>
                          <button
                            className="ceLink"
                            onClick={() =>
                              setSelection({ type: "node", id: n.id })
                            }
                          >
                            {n.name}
                          </button>
                        </td>
                        <td>{n.roles.join(", ")}</td>
                        <td>{percent(n.diskUsedPercent)}</td>
                        <td>{percent(n.heapUsedPercent)}</td>
                        <td>{percent(n.cpuPercent)}</td>
                        <td>
                          {assigned.filter((c) => c.node === n.id).length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="ceFine">
                  Node metrics describe the whole node. Index and shard-state
                  filters do not change these resource measurements.
                </p>
              </div>
            ) : (
              <div className="ceTableScroll">
                <table className="ceTable">
                  <thead>
                    <tr>
                      <th>Index</th>
                      <th>State</th>
                      <th>Primaries</th>
                      <th>Replicas per primary</th>
                      <th>Unassigned</th>
                      <th>Index ops/s</th>
                      <th>Search shard ops/s</th>
                      <th>Index ms/op</th>
                      <th>Search ms/op</th>
                      <th>Documents</th>
                      <th>Primary store</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownIndices.map((i) => (
                      <tr key={i.uuid}>
                        <td>
                          <button
                            className="ceLink"
                            onClick={() =>
                              setSelection({ type: "index", id: i.uuid })
                            }
                          >
                            {i.name}
                          </button>
                        </td>
                        <td>{i.state}</td>
                        <td>{count(i.primaries)}</td>
                        <td>{count(i.replicas)}</td>
                        <td>
                          {
                            unassigned.filter((c) => c.indexUuid === i.uuid)
                              .length
                          }
                        </td>
                        <td>{rateText(i.activity?.rates?.indexing)}</td>
                        <td>{rateText(i.activity?.rates?.search)}</td>
                        <td>{rateText(i.activity?.rates?.indexingLatency)}</td>
                        <td>{rateText(i.activity?.rates?.searchLatency)}</td>
                        <td>{count(i.activity?.values.documents)}</td>
                        <td>{bytes(i.activity?.values.storeBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(view === "Nodes" ? visibleNodes : visibleIndices).length ===
              0 && (
              <p className="ceEmpty">
                No matching results. Clear filters or load a different index
                scope.
              </p>
            )}
            <div className="cePagination">
              <Pager
                page={page}
                total={
                  view === "Nodes"
                    ? visibleNodes.length
                    : table && view === "Allocation"
                      ? filteredCopies.length
                      : visibleIndices.length
                }
                size={table && view === "Allocation" ? 100 : 25}
                setPage={setPage}
                label={
                  table && view === "Allocation"
                    ? "Copies"
                    : view === "Nodes"
                      ? "Nodes"
                      : "Indices"
                }
              />
              {view === "Allocation" && !table && dataNodes.length > 8 && (
                <Pager
                  page={nodePage}
                  total={dataNodes.length}
                  size={8}
                  setPage={setNodePage}
                  label="Node columns"
                />
              )}
            </div>
            <div className="ceLegend">
              Matrix cells show up to 100 copies; the shard table lists all
              matching copies. P = primary · R = replica · ! = unassigned · ↗ =
              relocating · ↓ = initialising. Select a copy to inspect its
              statistics.
            </div>
          </EuiPanel>
        </>
      )}
      {selection && (
        <EuiFlyout
          className="ceFlyout"
          onClose={() => setSelection(null)}
          size="m"
          ownFocus
          aria-labelledby="ceDetailsTitle"
        >
          <EuiFlyoutHeader hasBorder>
            <EuiTitle size="m">
              <h2 id="ceDetailsTitle">
                {chosen
                  ? `Shard ${chosen.shard} · ${chosen.primary ? "Primary" : "Replica"}`
                  : selectedNode
                    ? selectedNode.name
                    : selectedIndex
                      ? selectedIndex.name
                      : "Selection changed"}
              </h2>
            </EuiTitle>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            {chosen ? (
              <ShardPanel
                key={chosen.id}
                copy={chosen}
                client={client}
                observedAt={data?.observedAt || ""}
                related={copies.filter(
                  (c) =>
                    c.indexUuid === chosen.indexUuid &&
                    c.shard === chosen.shard,
                )}
                nodeName={nodeName}
                select={(c) => setSelection({ type: "shard", id: c.id })}
              />
            ) : selectedNode ? (
              <NodePanel
                node={selectedNode}
                copies={copies}
                selectIndex={(id) => setSelection({ type: "index", id })}
              />
            ) : selectedIndex ? (
              <IndexPanel
                index={selectedIndex}
                copies={copies}
                nodeName={nodeName}
                tile={tile}
              />
            ) : (
              <EuiCallOut
                color="warning"
                title="This allocation is no longer in the loaded snapshot"
              >
                <p>
                  It may have moved, been removed or fallen outside the current
                  scope. Close this panel and select a current copy.
                </p>
              </EuiCallOut>
            )}
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </div>
  );
}
function Pager({
  page,
  total,
  size,
  setPage,
  label,
}: {
  page: number;
  total: number;
  size: number;
  setPage: (p: number) => void;
  label: string;
}) {
  const max = Math.max(0, Math.ceil(total / size) - 1);
  useEffect(() => {
    if (page > max) setPage(max);
  }, [page, max]);
  return (
    <div className="ceControls">
      <span>
        {label}:{" "}
        {total
          ? `${page * size + 1}–${Math.min(total, (page + 1) * size)} of ${total}`
          : "0"}
      </span>
      <EuiButtonEmpty
        size="s"
        disabled={page === 0}
        onClick={() => setPage(page - 1)}
      >
        Previous
      </EuiButtonEmpty>
      <EuiButtonEmpty
        size="s"
        disabled={page >= max}
        onClick={() => setPage(page + 1)}
      >
        Next
      </EuiButtonEmpty>
    </div>
  );
}
function ShardPanel({
  copy,
  client,
  observedAt,
  related,
  nodeName,
  select,
}: {
  copy: ShardCopy;
  client: ClusterClient;
  observedAt: string;
  related: ShardCopy[];
  nodeName: (id: string | null) => string;
  select: (c: ShardCopy) => void;
}) {
  const [details, setDetails] = useState<ShardDetails | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [explanation, setExplanation] = useState<ExplainResult | null>(null),
    [explainError, setExplainError] = useState(""),
    [explaining, setExplaining] = useState(false),
    [requestExplain, setRequestExplain] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setDetails(null);
    client
      .shard(copy, controller.signal)
      .then((d) => {
        if (!controller.signal.aborted) setDetails(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(e));
          if (accessDenied(e)) {
            setDetails(null);
            setExplanation(null);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [copy.id, observedAt, client]);
  useEffect(() => {
    if (!requestExplain) return;
    const controller = new AbortController();
    setExplaining(true);
    setExplainError("");
    setExplanation(null);
    client
      .explain(copy, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setExplanation(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setExplainError(errorMessage(e));
          if (accessDenied(e)) {
            setDetails(null);
            setExplanation(null);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setExplaining(false);
      });
    return () => controller.abort();
  }, [requestExplain, copy.id, client]);
  const m = details?.metrics;
  const recovery = details?.recovery;
  const recoveryPercent =
    recovery?.totalBytes != null &&
    recovery.totalBytes > 0 &&
    recovery.recoveredBytes != null
      ? Math.min(
          100,
          Math.max(0, (recovery.recoveredBytes / recovery.totalBytes) * 100),
        )
      : null;
  return (
    <>
      <p className="ceSub">{copy.index}</p>
      <EuiBadge color={copy.state === "UNASSIGNED" ? "warning" : "hollow"}>
        {displayState(copy.state)}
      </EuiBadge>
      {copy.relocationTarget && (
        <span className="ceStatusNote">Relocation target</span>
      )}
      <dl className="ceDetails">
        <dt>Role</dt>
        <dd>{copy.primary ? "Primary" : "Replica"}</dd>
        <dt>Node</dt>
        <dd>{nodeName(copy.node)}</dd>
        <dt>Allocation ID</dt>
        <dd>{copy.allocationId || "Unassigned"}</dd>
        <dt>Statistics collected</dt>
        <dd>
          {details
            ? timestamp(details.observedAt)
            : loading
              ? "Loading"
              : "Unavailable"}
        </dd>
        {copy.relocatingNode && (
          <>
            <dt>{copy.relocationTarget ? "Source" : "Destination"}</dt>
            <dd>{nodeName(copy.relocatingNode)}</dd>
          </>
        )}
      </dl>
      <h3>Shard statistics</h3>
      {loading && (
        <p role="status">
          <EuiLoadingSpinner /> Loading copy statistics…
        </p>
      )}
      {error && (
        <EuiCallOut title="Statistics unavailable" color="warning">
          <p>{error}</p>
        </EuiCallOut>
      )}
      {details?.unavailableReason && (
        <p className="ceMuted">{details.unavailableReason}</p>
      )}
      <div className="ceMetricGrid" aria-label="Key shard metrics">
        {[
          ["Live documents", count(m?.documents)],
          ["Deleted documents", count(m?.deletedDocuments)],
          ["Segments", count(m?.segments)],
          ["Store size", bytes(m?.storeBytes)],
        ].map(([label, value]) => (
          <EuiPanel key={label} paddingSize="m">
            <span className="ceMuted">{label}</span>
            <strong>{value}</strong>
          </EuiPanel>
        ))}
      </div>
      <p className="ceFine">
        Metrics describe this copy, not the whole index. Document counts are
        Lucene-level and may include nested documents. Deleted documents remain
        until segments merge.
      </p>
      <h3>Segments and memory</h3>
      <dl className="ceDetails">
        {[
          ["Segment memory", bytes(m?.segmentMemoryBytes)],
          ["Index writer memory", bytes(m?.indexWriterMemoryBytes)],
          ["Version map memory", bytes(m?.versionMapMemoryBytes)],
          ["Active merges", count(m?.activeMerges)],
          ["Merge time (cumulative)", duration(m?.mergeTimeMillis)],
        ].map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>Store and translog</h3>
      <dl className="ceDetails">
        {[
          ["Store size", bytes(m?.storeBytes)],
          ["Translog size", bytes(m?.translogBytes)],
          ["Translog operations", count(m?.translogOperations)],
          ["Uncommitted operations", count(m?.uncommittedOperations)],
        ].map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>Activity since shard start</h3>
      <dl className="ceDetails">
        {[
          ["Refreshes (cumulative)", count(m?.refreshTotal)],
          ["Refresh time (cumulative)", duration(m?.refreshTimeMillis)],
          ["Index operations (cumulative)", count(m?.indexingTotal)],
          ["Index time (cumulative)", duration(m?.indexingTimeMillis)],
          ["Query operations (cumulative)", count(m?.queryTotal)],
          ["Query time (cumulative)", duration(m?.queryTimeMillis)],
        ].map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {details?.sources
        .filter((s) => !s.ok)
        .map((s) => (
          <EuiCallOut
            key={s.name}
            color="warning"
            title={`${s.name}: ${s.message}`}
          />
        ))}
      {recovery && (
        <>
          <h3>Recovery</h3>
          {recoveryPercent !== null && (
            <p className="ceRecoveryProgress">
              <span>Bytes recovered: {recoveryPercent.toFixed(1)}%</span>
              <progress
                value={recoveryPercent}
                max={100}
                aria-label="Recovery bytes completed"
              />
            </p>
          )}
          <dl className="ceDetails">
            {[
              ["Stage", recovery.stage],
              ["Type", recovery.type],
              ["Source", recovery.source || "Unavailable"],
              ["Target", recovery.target || "Unavailable"],
              ["Bytes recovered", bytes(recovery.recoveredBytes)],
              ["Total bytes", bytes(recovery.totalBytes)],
              ["Elapsed", duration(recovery.elapsedMillis)],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </>
      )}
      <h3>Copies of this shard</h3>
      <div className="ceCopies">
        {related.map((c) => (
          <button
            key={c.id}
            onClick={() => select(c)}
            aria-pressed={c.id === copy.id}
          >
            <span>
              {c.primary ? "Primary" : "Replica"}
              {c.relocationTarget ? " · target" : ""}
            </span>
            <b>{nodeName(c.node)}</b>
            <small>{displayState(c.state)}</small>
          </button>
        ))}
      </div>
      <h3>Allocation explanation</h3>
      {copy.unassignedReason && (
        <p className="ceSub">Unassigned reason: {copy.unassignedReason}</p>
      )}
      <EuiButton
        size="s"
        isLoading={explaining}
        disabled={copy.relocationTarget}
        onClick={() => setRequestExplain((n) => n + 1)}
      >
        Explain allocation
      </EuiButton>
      {copy.relocationTarget && (
        <p className="ceFine">
          Select the source copy to explain a relocation.
        </p>
      )}
      {copy.node === null && !copy.primary && (
        <p className="ceFine">
          OpenSearch explains an unassigned replica for this logical shard;
          individual unassigned replica slots cannot be selected by the API.
        </p>
      )}
      {explainError && (
        <EuiCallOut title="Explanation unavailable" color="warning">
          <p>{explainError}</p>
        </EuiCallOut>
      )}
      {explanation && <ExplainPanel result={explanation} />}
    </>
  );
}
function ExplainPanel({ result }: { result: ExplainResult }) {
  const e = result.explanation as any;
  return (
    <section className="ceExplanation">
      <p className="ceFine">
        Collected {timestamp(result.observedAt)} · may differ from the routing
        snapshot
      </p>
      <p>
        {e.allocate_explanation ||
          e.move_explanation ||
          e.rebalance_explanation ||
          "Review the per-node deciders below."}
      </p>
      {e.node_allocation_decisions?.map((n: any) => (
        <div className="ceDecision" key={n.node_id}>
          <b>{n.node_name || n.node_id}</b>
          <EuiBadge color={n.node_decision === "yes" ? "success" : "hollow"}>
            {n.node_decision}
          </EuiBadge>
          {n.deciders?.map((d: any, i: number) => (
            <p key={i}>
              <strong>
                {d.decider} · {d.decision}
              </strong>
              <br />
              {d.explanation}
            </p>
          ))}
        </div>
      ))}
      <details>
        <summary>Full allocation response</summary>
        <pre>{JSON.stringify(result.explanation, null, 2)}</pre>
      </details>
    </section>
  );
}
function NodePanel({
  node,
  copies,
  selectIndex,
}: {
  node: NodeInfo;
  copies: ShardCopy[];
  selectIndex: (id: string) => void;
}) {
  const resident = copies.filter(
    (c) => c.node === node.id && !c.relocationTarget,
  );
  return (
    <>
      <p className="ceSub">{node.roles.join(", ")}</p>
      <dl className="ceDetails">
        {[
          ["Disk used", percent(node.diskUsedPercent)],
          ["Disk available", bytes(node.diskAvailableBytes)],
          ["Heap used", percent(node.heapUsedPercent)],
          ["CPU", percent(node.cpuPercent)],
          ["Node metrics sample", timestamp(node.sampleAt)],
          ["Assigned copies in scope", count(resident.length)],
        ].map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>Node attributes</h3>
      <dl className="ceDetails">
        {Object.entries(node.attributes).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      <h3>Indices in loaded scope</h3>
      {Array.from(new Map(resident.map((c) => [c.indexUuid, c])).values()).map(
        (c) => (
          <p key={c.indexUuid}>
            <button className="ceLink" onClick={() => selectIndex(c.indexUuid)}>
              {c.index}
            </button>
          </p>
        ),
      )}
    </>
  );
}
function IndexPanel({
  index,
  copies,
  nodeName,
  tile,
}: {
  index: IndexInfo;
  copies: ShardCopy[];
  nodeName: (id: string | null) => string;
  tile: (copy: ShardCopy) => React.ReactNode;
}) {
  const own = copies.filter((c) => c.indexUuid === index.uuid);
  return (
    <>
      <dl className="ceDetails">
        <dt>Index UUID</dt>
        <dd>{index.uuid}</dd>
        <dt>Configured primary shards</dt>
        <dd>{count(index.primaries)}</dd>
        <dt>Replicas per primary</dt>
        <dd>{count(index.replicas)}</dd>
        <dt>Unassigned copies</dt>
        <dd>{own.filter((c) => c.node === null).length}</dd>
      </dl>
      <h3>Last known index activity</h3>
      <p className="ceFine">
        {index.activity?.rateObservedAt
          ? `Rate sample ${timestamp(index.activity.rateObservedAt)} · ${index.activity.intervalSeconds?.toFixed(0)}s window`
          : "Collect a second sample at least 30 seconds later. Missing or reset counters display —."}
      </p>
      <dl className="ceDetails">
        {[
          ["Primary index operations/s", "indexing"],
          ["Primary deletes/s", "deletes"],
          ["Search shard queries/s", "search"],
          ["Fetches/s", "fetch"],
          ["Merges/s", "merges"],
          ["Refreshes/s", "refreshes"],
          ["Flushes/s", "flushes"],
          ["Index latency ms/op", "indexingLatency"],
          ["Query latency ms/op", "searchLatency"],
          ["Fetch latency ms/op", "fetchLatency"],
        ].map(([label, key]) => (
          <React.Fragment key={key}>
            <dt>{label}</dt>
            <dd>{rateText(index.activity?.rates?.[key])}</dd>
          </React.Fragment>
        ))}
        <dt>Current primary indexing operations</dt>
        <dd>{count(index.activity?.values.indexingCurrent)}</dd>
        <dt>Current shard queries</dt>
        <dd>{count(index.activity?.values.searchCurrent)}</dd>
        <dt>Current merges</dt>
        <dd>{count(index.activity?.values.mergeCurrent)}</dd>
        <dt>Cumulative primary indexing failures</dt>
        <dd>{count(index.activity?.values.indexingFailures)}</dd>
      </dl>
      <h3>Placement</h3>
      {Array.from(new Set(own.map((c) => c.node))).map((n) => (
        <div className="cePlacement" key={n || "unassigned"}>
          <h4>{nodeName(n)}</h4>
          <div className="ceTiles">
            {own
              .filter((c) => c.node === n)
              .slice(0, 200)
              .map(tile)}
          </div>
          {own.filter((c) => c.node === n).length > 200 && (
            <p className="ceFine">
              Showing the first 200 copies. Use the shard table to inspect the
              remaining allocations.
            </p>
          )}
        </div>
      ))}
    </>
  );
}
