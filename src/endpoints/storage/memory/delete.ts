/**
 * Memory Delete Endpoint
 */
import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class MemoryDelete extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - Memory"],
    summary: "(paid, storage_write) Delete items from memory",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            required: ["ids"],
            properties: {
              ids: {
                type: "array" as const,
                items: { type: "string" as const },
                description: "IDs to delete",
              },
            },
          },
        },
      },
    },
    parameters: [
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Delete result" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    let body: { ids?: string[] };
    try { body = await c.req.json(); } catch { return this.errorResponse(c, "Invalid JSON body", 400); }

    const { ids } = body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return this.errorResponse(c, "ids array is required", 400);
    }

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.memoryDelete(ids);
    return c.json({ ok: true, ...result, tokenType });
  }
}
