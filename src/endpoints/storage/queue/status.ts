/**
 * Queue Status Endpoint
 */
import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class QueueStatus extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - Queue"],
    summary: "(paid, storage_read) Get queue status",
    parameters: [
      { name: "name", in: "query" as const, required: true, schema: { type: "string" as const } },
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Queue status" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const name = c.req.query("name");

    if (!name) return this.errorResponse(c, "name is required", 400);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.queueStatus(name);
    return c.json({ ok: true, name, ...result, tokenType });
  }
}
