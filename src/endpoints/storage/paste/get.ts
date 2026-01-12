/**
 * Paste Get Endpoint
 */

import { StorageReadEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class PasteGet extends StorageReadEndpoint {
  schema = {
    tags: ["Storage - Paste"],
    summary: "(paid, storage_read) Get a paste by ID",
    parameters: [
      {
        name: "id",
        in: "path" as const,
        required: true,
        schema: { type: "string" as const },
        description: "Paste ID",
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
        description: "Paste retrieved",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                id: { type: "string" as const },
                content: { type: "string" as const },
                title: { type: "string" as const },
                language: { type: "string" as const },
                createdAt: { type: "string" as const },
                expiresAt: { type: "string" as const },
                tokenType: { type: "string" as const },
              },
            },
          },
        },
      },
      "402": { description: "Payment required" },
      "404": { description: "Paste not found" },
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

    const result = await storageDO.pasteGet(id);

    if (!result) {
      return this.errorResponse(c, `Paste '${id}' not found`, 404);
    }

    return c.json({
      ok: true,
      ...result,
      tokenType,
    });
  }
}
