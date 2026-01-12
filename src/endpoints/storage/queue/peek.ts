/**
 * Queue Peek Endpoint
 */
import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class QueuePeek extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - Queue"],
    summary: "(paid, storage_read) Peek at queue items without removing",
    parameters: [
      { name: "name", in: "query" as const, required: true, schema: { type: "string" as const } },
      { name: "count", in: "query" as const, required: false, schema: { type: "integer" as const, default: 1 } },
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Queue items" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const name = c.req.query("name");
    const count = parseInt(c.req.query("count") || "1", 10);

    if (!name) return this.errorResponse(c, "name is required", 400);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.queuePeek(name, count) as {
      items: Array<{ id: string; data: unknown; priority: number }>;
      count: number;
    };
    return c.json({ ok: true, items: result.items, count: result.count, tokenType });
  }
}
