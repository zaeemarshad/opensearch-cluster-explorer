/* SPDX-License-Identifier: Apache-2.0 */
import { monitor } from "./monitor";
import { schema } from "@osd/config-schema";
import type { IRouter } from "../../../src/core/server";
import {
  getSnapshot,
  getShardDetails,
  explainShard,
  safeFailure,
  validateIndex,
} from "./service";
const selector = schema.object({
  index: schema.string({
    minLength: 1,
    maxLength: 255,
    validate(value) {
      try {
        validateIndex(value);
      } catch {
        return "A concrete index is required.";
      }
    },
  }),
  indexUuid: schema.string({ minLength: 1, maxLength: 255 }),
  shard: schema.number({
    min: 0,
    validate(value) {
      if (!Number.isInteger(value)) return "Shard must be an integer.";
    },
  }),
  primary: schema.boolean(),
  node: schema.nullable(schema.string({ minLength: 1, maxLength: 255 })),
  allocationId: schema.nullable(
    schema.string({ minLength: 1, maxLength: 255 }),
  ),
});
export function defineRoutes(router: IRouter) {
  router.get(
    {
      path: "/api/cluster_explorer/snapshot",
      validate: {
        query: schema.object({
          scope: schema.string({ defaultValue: "*", maxLength: 512 }),
          nextToken: schema.maybe(schema.string({ maxLength: 2048 })),
        }),
      },
    },
    async (context, request, response) => {
      try {
        const client = context.core.opensearch.client.asCurrentUser;
        return response.ok({
          body: await monitor(() =>
            getSnapshot(
              client.transport,
              request.query.scope,
              request.query.nextToken,
            ),
          ),
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        const failure = safeFailure(error);
        return response.customError({
          statusCode: failure.statusCode,
          body: failure.message,
        });
      }
    },
  );
  router.post(
    {
      path: "/api/cluster_explorer/shard",
      validate: { body: selector },
      options: { body: { maxBytes: 4096 } },
    },
    async (context, request, response) => {
      try {
        return response.ok({
          body: await monitor(() =>
            getShardDetails(
              context.core.opensearch.client.asCurrentUser.transport,
              request.body,
            ),
          ),
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        const failure = safeFailure(error);
        return response.customError({
          statusCode: failure.statusCode,
          body: failure.message,
        });
      }
    },
  );
  router.post(
    {
      path: "/api/cluster_explorer/explain",
      validate: { body: selector },
      options: { body: { maxBytes: 4096 } },
    },
    async (context, request, response) => {
      try {
        return response.ok({
          body: await monitor(() =>
            explainShard(
              context.core.opensearch.client.asCurrentUser.transport,
              request.body,
            ),
          ),
          headers: { "cache-control": "no-store" },
        });
      } catch (error) {
        const failure = safeFailure(error);
        return response.customError({
          statusCode: failure.statusCode,
          body: failure.message,
        });
      }
    },
  );
}
