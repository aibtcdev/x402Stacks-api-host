/**
 * Memory Clear Endpoint
 */
import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class MemoryClear extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - Memory"],
    summary: "(paid, storage_write) Clear all memory items",
    parameters: [
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Clear result" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    const result = await storageDO.memoryClear();
    return c.json({ ok: true, ...result, tokenType });
  }
}
