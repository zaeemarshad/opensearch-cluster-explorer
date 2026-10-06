/* SPDX-License-Identifier: Apache-2.0 */
import { ApiFailure } from "./service";
// Process-wide admission control, with no user data or response cache.
let active = 0,
  tokens = 4,
  last = Date.now();
export async function monitor<T>(work: () => Promise<T>): Promise<T> {
  const now = Date.now();
  tokens = Math.min(4, tokens + (now - last) / 5000);
  last = now;
  if (active >= 2 || tokens < 1)
    throw new ApiFailure(
      429,
      "Monitoring is busy. Wait a few seconds and retry.",
    );
  tokens--;
  active++;
  try {
    return await work();
  } finally {
    active--;
  }
}
