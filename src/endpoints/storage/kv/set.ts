/**
 * KV Set Endpoint
 */

import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class KvSet extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - KV"],
    summary: "(paid, storage_write) Set value in KV store",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            required: ["key", "value"],
            properties: {
              key: { type: "string" as const, description: "Key to set" },
              value: { type: "string" as const, description: "Value to store" },
              metadata: { type: "object" as const, description: "Optional metadata" },
              ttl: { type: "integer" as const, description: "TTL in seconds (optional)" },
            },
          },
        },
      },
    },
    parameters: [
      {
        name: "tokenType",
        in: "query" as const,
        required: false,
        schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" },
      },
    ],
    responses: {
      "200": {
        description: "Value set",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                key: { type: "string" as const },
                created: { type: "boolean" as const },
                tokenType: { type: "string" as const },
              },
            },
          },
        },
      },
      "400": { description: "Invalid request" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);

    let body: { key?: string; value?: string; metadata?: Record<string, unknown>; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      return this.errorResponse(c, "Invalid JSON body", 400);
    }

    const { key, value, metadata, ttl } = body;

    if (!key || typeof key !== "string") {
      return this.errorResponse(c, "key is required", 400);
    }
    if (!value || typeof value !== "string") {
      return this.errorResponse(c, "value is required", 400);
    }

    const storageDO = this.getStorageDO(c);
    if (!storageDO) {
      return this.errorResponse(c, "Storage not available", 500);
    }

    const result = await storageDO.kvSet(key, value, { metadata, ttl });

    return c.json({
      ok: true,
      key: result.key,
      created: result.created,
      tokenType,
    });
  }
}
