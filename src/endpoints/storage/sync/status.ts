/**
 * Sync Status Endpoint
 */
import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class SyncStatus extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - Sync"],
    summary: "(paid, storage_read) Check lock status",
    parameters: [
      { name: "name", in: "path" as const, required: true, schema: { type: "string" as const } },
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Lock status" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    const name = c.req.param("name");
    if (!name) return this.errorResponse(c, "name is required", 400);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.syncStatus(name);
    return c.json({ ok: true, name, ...result, tokenType });
  }
}
