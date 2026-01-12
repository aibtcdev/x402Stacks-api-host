/**
 * Memory List Endpoint
 */
import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class MemoryList extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - Memory"],
    summary: "(paid, storage_read) List stored memory items",
    parameters: [
      { name: "limit", in: "query" as const, required: false, schema: { type: "integer" as const, default: 100 } },
      { name: "offset", in: "query" as const, required: false, schema: { type: "integer" as const, default: 0 } },
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Memory items" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const limit = parseInt(c.req.query("limit") || "100", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.memoryList({ limit, offset }) as {
      items: Array<{ id: string; text: string; metadata: Record<string, unknown> | null; createdAt: string }>;
      total: number;
    };
    return c.json({ ok: true, items: result.items, total: result.total, tokenType });
  }
}
