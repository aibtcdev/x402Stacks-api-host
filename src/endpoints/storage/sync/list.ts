/**
 * Sync List Endpoint
 */
import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class SyncList extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - Sync"],
    summary: "(paid, storage_read) List active locks",
    parameters: [
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "List of locks" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const locks = await storageDO.syncList();
    return c.json({ ok: true, locks, count: locks.length, tokenType });
  }
}
