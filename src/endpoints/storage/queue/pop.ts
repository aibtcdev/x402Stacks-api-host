/**
 * Queue Pop Endpoint
 */
import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class QueuePop extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - Queue"],
    summary: "(paid, storage_write) Pop items from a queue",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            required: ["name"],
            properties: {
              name: { type: "string" as const, description: "Queue name" },
              count: {
                type: "integer" as const,
                description: "Number of items to pop",
                default: 1,
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
      "200": { description: "Popped items" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    let body: { name?: string; count?: number };
    try { body = await c.req.json(); } catch { return this.errorResponse(c, "Invalid JSON body", 400); }

    const { name, count = 1 } = body;
    if (!name) return this.errorResponse(c, "name is required", 400);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.queuePop(name, count) as {
      items: Array<{ id: string; data: unknown }>;
      count: number;
    };
    return c.json({ ok: true, items: result.items, count: result.count, tokenType });
  }
}
