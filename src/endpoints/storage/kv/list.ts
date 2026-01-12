/**
 * KV List Endpoint
 */

import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class KvList extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - KV"],
    summary: "(paid, storage_read) List keys in KV store",
    parameters: [
      {
        name: "prefix",
        in: "query" as const,
        required: false,
        schema: { type: "string" as const },
        description: "Filter by key prefix",
      },
      {
        name: "limit",
        in: "query" as const,
        required: false,
        schema: { type: "integer" as const, default: 100 },
        description: "Max results to return",
      },
      {
        name: "tokenType",
        in: "query" as const,
        required: false,
        schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" },
      },
    ],
    responses: {
      "200": {
        description: "List of keys",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                keys: {
                  type: "array" as const,
                  items: {
                    type: "object" as const,
                    properties: {
                      key: { type: "string" as const },
                      metadata: { type: "object" as const },
                      updatedAt: { type: "string" as const },
                    },
                  },
                },
                count: { type: "integer" as const },
                tokenType: { type: "string" as const },
              },
            },
          },
        },
      },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const prefix = c.req.query("prefix");
    const limit = parseInt(c.req.query("limit") || "100", 10);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) {
      return this.errorResponse(c, "Storage not available", 500);
    }

    const keys = await storageDO.kvList({ prefix, limit }) as Array<{
      key: string;
      metadata: Record<string, unknown> | null;
      updatedAt: string;
    }>;

    return c.json({
      ok: true,
      keys,
      count: keys.length,
      tokenType,
    });
  }
}
