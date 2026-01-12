/**
 * DB Execute Endpoint
 */
import { StorageWriteEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class DbExecute extends StorageWriteEndpoint {
  schema = {
    tags: ["Storage - DB"],
    summary: "(paid, storage_write) Execute a write SQL statement",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            required: ["query"],
            properties: {
              query: { type: "string" as const, description: "SQL statement (CREATE, INSERT, UPDATE, DELETE)" },
              params: { type: "array" as const, description: "Query parameters" },
            },
          },
        },
      },
    },
    parameters: [
      { name: "tokenType", in: "query" as const, required: false, schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" } },
    ],
    responses: {
      "200": { description: "Execution result" },
      "400": { description: "Invalid query" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);
    let body: { query?: string; params?: unknown[] };
    try { body = await c.req.json(); } catch { return this.errorResponse(c, "Invalid JSON body", 400); }

    const { query, params = [] } = body;
    if (!query) return this.errorResponse(c, "query is required", 400);

    const storageDO = this.getStorageDO(c);
    if (!storageDO) return this.errorResponse(c, "Storage not available", 500);

    try {
      const result = await storageDO.sqlExecute(query, params);
      return c.json({ ok: true, ...result, tokenType });
    } catch (e) {
      return this.errorResponse(c, String(e), 400);
    }
  }
}
