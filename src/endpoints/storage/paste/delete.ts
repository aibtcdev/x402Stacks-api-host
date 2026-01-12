/**
 * Paste Delete Endpoint
 */

import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class PasteDelete extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - Paste"],
    summary: "(paid, storage_write) Delete a paste",
    parameters: [
      {
        name: "id",
        in: "path" as const,
        required: true,
        schema: { type: "string" as const },
        description: "Paste ID to delete",
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
                id: { type: "string" as const },
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
    const id = c.req.param("id");

    if (!id) {
      return this.errorResponse(c, "id parameter is required", 400);
    }

    const storageDO = this.getStorageDO(c);
    if (!storageDO) {
      return this.errorResponse(c, "Storage not available", 500);
    }

    const result = await storageDO.pasteDelete(id);

    return c.json({
      ok: true,
      deleted: result.deleted,
      id,
      tokenType,
    });
  }
}
