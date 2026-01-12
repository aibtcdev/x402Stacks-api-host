/**
 * KV Get Endpoint
 */

import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class KvGet extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - KV"],
    summary: "(paid, storage_read) Get value from KV store",
    parameters: [
      {
        name: "key",
        in: "path" as const,
        required: true,
        schema: { type: "string" as const },
        description: "Key to retrieve",
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
        description: "Value retrieved",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                key: { type: "string" as const },
                value: { type: "string" as const },
                metadata: { type: "object" as const },
                tokenType: { type: "string" as const },
              },
            },
          },
        },
      },
      "402": { description: "Payment required" },
      "404": { description: "Key not found" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const key = c.req.param("key");

    if (!key) {
      return this.errorResponse(c, "key parameter is required", 400);
    }

    const storageDO = this.getStorageDO(c);
    if (!storageDO) {
      return this.errorResponse(c, "Storage not available", 500);
    }

    const result = await storageDO.kvGet(key) as {
      key: string;
      value: string;
      metadata: Record<string, unknown> | null;
      createdAt: string;
      updatedAt: string;
    } | null;

    if (!result) {
      return this.errorResponse(c, `Key '${key}' not found`, 404);
    }

    return c.json({
      ok: true,
      key: result.key,
      value: result.value,
      metadata: result.metadata,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      tokenType,
    });
  }
}
