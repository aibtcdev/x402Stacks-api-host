/**
 * SHA-256 Hash Endpoint
 */

import { SimpleEndpoint } from "../base";
import type { AppContext } from "../../types";

export class HashSha256 extends SimpleEndpoint {
  schema = {
    tags: ["Hashing"],
    summary: "(paid, simple) Compute SHA-256 hash",
    description: "Computes SHA-256 hash using SubtleCrypto. Clarity-compatible output.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object" as const,
            required: ["data"],
            properties: {
              data: {
                type: "string" as const,
                description: "Data to hash (text or hex with 0x prefix)",
              },
              encoding: {
                type: "string" as const,
                enum: ["hex", "base64"],
                default: "hex",
              },
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
        schema: {
          type: "string" as const,
          enum: ["STX", "sBTC", "USDCx"],
          default: "STX",
        },
      },
    ],
    responses: {
      "200": {
        description: "SHA-256 hash",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                hash: { type: "string" as const },
                algorithm: { type: "string" as const },
                encoding: { type: "string" as const },
                inputLength: { type: "integer" as const },
                tokenType: { type: "string" as const },
              },
            },
          },
        },
      },
      "400": { description: "Invalid input" },
      "402": { description: "Payment required" },
    },
  };

  async handle(c: AppContext) {
    const tokenType = this.getTokenType(c);

    let body: { data?: string; encoding?: string };
    try {
      body = await c.req.json();
    } catch {
      return this.errorResponse(c, "Invalid JSON body", 400);
    }

    const { data, encoding = "hex" } = body;

    if (!data || typeof data !== "string") {
      return this.errorResponse(c, "data field is required", 400);
    }

    if (encoding !== "hex" && encoding !== "base64") {
      return this.errorResponse(c, "encoding must be 'hex' or 'base64'", 400);
    }

    // Determine if input is hex or text
    let inputBytes: Uint8Array;
    if (data.startsWith("0x")) {
      const hex = data.slice(2);
      inputBytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    } else {
      inputBytes = new TextEncoder().encode(data);
    }

    // Compute SHA-256
    const hashBuffer = await crypto.subtle.digest("SHA-256", inputBytes);
    const hashArray = new Uint8Array(hashBuffer);

    let hash: string;
    if (encoding === "hex") {
      hash = Array.from(hashArray)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } else {
      hash = btoa(String.fromCharCode(...hashArray));
    }

    return c.json({
      ok: true,
      hash: encoding === "hex" ? `0x${hash}` : hash,
      algorithm: "SHA-256",
      encoding,
      inputLength: inputBytes.length,
      tokenType,
    });
  }
}
