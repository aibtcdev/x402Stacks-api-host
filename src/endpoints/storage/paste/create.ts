/**
 * Paste Create Endpoint
 */

import { StorageWriteLargeEndpoint } from "../../base";
import type { AppContext } from "../../../types";

export class PasteCreate extends StorageWriteLargeEndpoint {
  schema = {
    tags: ["Storage - Paste"],
    summary: "(paid, storage_write_large) Create a new paste",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            required: ["content"],
            properties: {
              content: { type: "string" as const, description: "Paste content" },
              title: { type: "string" as const, description: "Optional title" },
              language: { type: "string" as const, description: "Programming language for syntax highlighting" },
              ttl: { type: "integer" as const, description: "TTL in seconds (optional)" },
            },
          },
        },
      },
    },
    parameters: [
      {
        name: "tokenType",
        in: "query" as const,
        required: false,
        schema: { type: "string" as const, enum: ["STX", "sBTC", "USDCx"], default: "STX" },
      },
    ],
    responses: {
      "200": {
        description: "Paste created",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                id: { type: "string" as const },
                createdAt: { type: "string" as const },
                expiresAt: { type: "string" as const },
                tokenType: { type: "string" as const },
              },
            },
          },
        },
      },
      "400": { description: "Invalid request" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);

    let body: { content?: string; title?: string; language?: string; ttl?: number };
    try {
      body = await c.req.json();
    } catch {
      return this.errorResponse(c, "Invalid JSON body", 400);
    }

    const { content, title, language, ttl } = body;

    if (!content || typeof content !== "string") {
      return this.errorResponse(c, "content is required", 400);
    }

    const storageDO = this.getStorageDO(c);
    if (!storageDO) {
      return this.errorResponse(c, "Storage not available", 500);
    }

    const result = await storageDO.pasteCreate(content, { title, language, ttl });

    return c.json({
      ok: true,
      id: result.id,
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
      tokenType,
    });
  }
}
