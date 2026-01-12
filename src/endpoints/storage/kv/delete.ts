/**
 * KV Delete Endpoint
 */

import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class KvDelete extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - KV"],
    summary: "(paid, storage_write) Delete key from KV store",
    parameters: [
      {
        name: "key",
        in: "path" as const,
        required: true,
        schema: { type: "string" as const },
        description: "Key to delete",
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
        description: "Delete result",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                deleted: { type: "boolean" as const },
                key: { type: "string" as const },
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
    const key = c.req.param("key");

    if (!key) {
      return this.errorResponse(c, "key parameter is required", 400);
    }

    const storageDO = this.getStorageDO(c);
    if (!storageDO) {
      return this.errorResponse(c, "Storage not available", 500);
    }

    const result = await storageDO.kvDelete(key);

    return c.json({
      ok: true,
      deleted: result.deleted,
      key,
      tokenType,
    });
  }
}
