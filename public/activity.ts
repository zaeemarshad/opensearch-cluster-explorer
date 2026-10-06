/* SPDX-License-Identifier: Apache-2.0 */
import type { IndexActivity } from "../common/types";
export function activityRates(
  previous: IndexActivity | undefined,
  next: IndexActivity,
): IndexActivity {
  const seconds = previous ? (next.observedAt - previous.observedAt) / 1000 : 0;
  if (!previous || seconds < 30)
    return {
      ...next,
      rates: previous?.rates,
      intervalSeconds: previous?.intervalSeconds,
      rateObservedAt: previous?.rateObservedAt,
    };
  const rates: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(next.counters)) {
    const before = previous.counters[key];
    rates[key] =
      value != null && before != null && value >= before
        ? (value - before) / seconds
        : null;
  }
  // Counter resets after moves/restarts must not turn into spikes or negative rates.
  if (rates.indexing == null) rates.indexingLatency = null;
  else
    rates.indexingLatency =
      rates.indexing > 0 && rates.indexingMillis != null
        ? rates.indexingMillis / rates.indexing
        : null;
  rates.searchLatency =
    rates.search != null && rates.search > 0 && rates.searchMillis != null
      ? rates.searchMillis / rates.search
      : null;
  rates.fetchLatency =
    rates.fetch != null && rates.fetch > 0 && rates.fetchMillis != null
      ? rates.fetchMillis / rates.fetch
      : null;
  return {
    ...next,
    rates,
    intervalSeconds: seconds,
    rateObservedAt: next.observedAt,
  };
}
