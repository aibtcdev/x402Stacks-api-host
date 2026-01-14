/**
 * X402 Schema Generator
 *
 * Generates x402.json format for StacksX402 scanner discovery.
 * Static generation without network calls (Cloudflare Workers can't self-fetch).
 */

import { TIER_PRICING, stxToTokenAmount } from "../services/pricing";
import type { PricingTier, TokenType } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface X402Entry {
  scheme: "exact";
  network: "stacks";
  asset: TokenType;
  payTo: string;
  maxAmountRequired: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  mimeType: "application/json";
  outputSchema: {
    input: X402InputSchema;
    output: Record<string, string>;
  };
}

export interface X402InputSchema {
  type: "http";
  method: "GET" | "POST" | "DELETE";
  bodyType?: "json";
  bodyFields?: Record<string, X402FieldSchema>;
}

export interface X402FieldSchema {
  type: string;
  required: boolean;
  description?: string;
}

export interface X402Schema {
  x402Version: number;
  name: string;
  image: string;
  accepts: X402Entry[];
}

export interface GeneratorConfig {
  network: "mainnet" | "testnet";
  payTo: string;
  name?: string;
  image?: string;
}

// =============================================================================
// Endpoint Registry (for static generation without OpenAPI fetch)
// =============================================================================

interface EndpointInfo {
  method: "GET" | "POST" | "DELETE";
  description: string;
  tier: PricingTier;
}

const ENDPOINT_REGISTRY: Record<string, EndpointInfo> = {
  // Inference - OpenRouter (dynamic pricing, use standard as placeholder)
  "/inference/openrouter/chat": {
    method: "POST",
    description: "Chat completion via OpenRouter (100+ models)",
    tier: "dynamic",
  },

  // Inference - Cloudflare
  "/inference/cloudflare/chat": {
    method: "POST",
    description: "Chat completion via Cloudflare AI",
    tier: "standard",
  },

  // Stacks endpoints
  "/stacks/address/:address": {
    method: "GET",
    description: "Convert between Stacks address formats",
    tier: "standard",
  },
  "/stacks/decode/clarity": {
    method: "POST",
    description: "Decode Clarity value from hex",
    tier: "standard",
  },
  "/stacks/decode/transaction": {
    method: "POST",
    description: "Decode raw Stacks transaction",
    tier: "standard",
  },
  "/stacks/profile/:address": {
    method: "GET",
    description: "Get BNS profile for address",
    tier: "standard",
  },
  "/stacks/verify/message": {
    method: "POST",
    description: "Verify signed message",
    tier: "standard",
  },
  "/stacks/verify/sip018": {
    method: "POST",
    description: "Verify SIP-018 structured data signature",
    tier: "standard",
  },

  // Hashing endpoints
  "/hashing/sha256": {
    method: "POST",
    description: "SHA256 hash (Clarity-compatible)",
    tier: "standard",
  },
  "/hashing/sha512": {
    method: "POST",
    description: "SHA512 hash",
    tier: "standard",
  },
  "/hashing/sha512-256": {
    method: "POST",
    description: "SHA512/256 hash (Clarity-compatible)",
    tier: "standard",
  },
  "/hashing/keccak256": {
    method: "POST",
    description: "Keccak256 hash (Clarity-compatible)",
    tier: "standard",
  },
  "/hashing/hash160": {
    method: "POST",
    description: "Hash160 (SHA256 + RIPEMD160, Clarity-compatible)",
    tier: "standard",
  },
  "/hashing/ripemd160": {
    method: "POST",
    description: "RIPEMD160 hash",
    tier: "standard",
  },

  // Storage - KV
  "/storage/kv/:key": {
    method: "GET",
    description: "Get value by key",
    tier: "standard",
  },
  "/storage/kv": {
    method: "POST",
    description: "Set key-value pair",
    tier: "standard",
  },
  "/storage/kv/:key:delete": {
    method: "DELETE",
    description: "Delete key",
    tier: "standard",
  },
  "/storage/kv:list": {
    method: "GET",
    description: "List all keys",
    tier: "standard",
  },

  // Storage - Paste
  "/storage/paste": {
    method: "POST",
    description: "Create paste",
    tier: "standard",
  },
  "/storage/paste/:id": {
    method: "GET",
    description: "Get paste by ID",
    tier: "standard",
  },
  "/storage/paste/:id:delete": {
    method: "DELETE",
    description: "Delete paste",
    tier: "standard",
  },

  // Storage - DB
  "/storage/db/query": {
    method: "POST",
    description: "Execute SQL query",
    tier: "standard",
  },
  "/storage/db/execute": {
    method: "POST",
    description: "Execute SQL statement",
    tier: "standard",
  },
  "/storage/db/schema": {
    method: "GET",
    description: "Get database schema",
    tier: "standard",
  },

  // Storage - Sync (Locks)
  "/storage/sync/lock": {
    method: "POST",
    description: "Acquire distributed lock",
    tier: "standard",
  },
  "/storage/sync/unlock": {
    method: "POST",
    description: "Release distributed lock",
    tier: "standard",
  },
  "/storage/sync/extend": {
    method: "POST",
    description: "Extend lock TTL",
    tier: "standard",
  },
  "/storage/sync/status/:name": {
    method: "GET",
    description: "Get lock status",
    tier: "standard",
  },
  "/storage/sync/list": {
    method: "GET",
    description: "List all locks",
    tier: "standard",
  },

  // Storage - Queue
  "/storage/queue/push": {
    method: "POST",
    description: "Push job to queue",
    tier: "standard",
  },
  "/storage/queue/pop": {
    method: "POST",
    description: "Pop job from queue",
    tier: "standard",
  },
  "/storage/queue/peek": {
    method: "GET",
    description: "Peek at next job",
    tier: "standard",
  },
  "/storage/queue/status": {
    method: "GET",
    description: "Get queue status",
    tier: "standard",
  },
  "/storage/queue/clear": {
    method: "POST",
    description: "Clear queue",
    tier: "standard",
  },

  // Storage - Memory (Vector)
  "/storage/memory/store": {
    method: "POST",
    description: "Store memory with embedding",
    tier: "standard",
  },
  "/storage/memory/search": {
    method: "POST",
    description: "Semantic search memories",
    tier: "standard",
  },
  "/storage/memory/delete": {
    method: "POST",
    description: "Delete memory",
    tier: "standard",
  },
  "/storage/memory/list": {
    method: "GET",
    description: "List all memories",
    tier: "standard",
  },
  "/storage/memory/clear": {
    method: "POST",
    description: "Clear all memories",
    tier: "standard",
  },
};

// =============================================================================
// Conversion Helpers
// =============================================================================

const TOKENS: TokenType[] = ["STX", "sBTC", "USDCx"];

/**
 * Get timeout based on endpoint type
 */
function getTimeoutForTier(tier: PricingTier): number {
  switch (tier) {
    case "dynamic":
      return 120; // LLM requests can take longer
    default:
      return 60;
  }
}

/**
 * Get amount in smallest unit for a tier and token
 */
function getAmountForTier(tier: PricingTier, token: TokenType): string {
  // Skip free tier
  if (tier === "free") return "0";

  // For dynamic pricing, use standard tier as the base (actual price varies)
  const effectiveTier = tier === "dynamic" ? "standard" : tier;
  const tierPricing = TIER_PRICING[effectiveTier];

  if (!tierPricing || tierPricing.stx === 0) return "0";

  const amount = stxToTokenAmount(tierPricing.stx, token);
  return amount.toString();
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate x402.json schema statically
 * Uses hardcoded endpoint registry - no network calls needed
 */
export function generateX402Schema(config: GeneratorConfig): X402Schema {
  const accepts: X402Entry[] = [];

  // Process each paid endpoint
  for (const [path, info] of Object.entries(ENDPOINT_REGISTRY)) {
    // Skip free tier
    if (info.tier === "free") continue;

    const timeout = getTimeoutForTier(info.tier);

    // Create entry for each supported token
    for (const token of TOKENS) {
      const amount = getAmountForTier(info.tier, token);

      // Skip if amount is 0
      if (amount === "0") continue;

      accepts.push({
        scheme: "exact",
        network: "stacks",
        asset: token,
        payTo: config.payTo,
        maxAmountRequired: amount,
        maxTimeoutSeconds: timeout,
        resource: path,
        description: info.description,
        mimeType: "application/json",
        outputSchema: {
          input: {
            type: "http",
            method: info.method,
          },
          output: {},
        },
      });
    }
  }

  return {
    x402Version: 1,
    name: config.name || "x402 Stacks API",
    image: config.image || "https://aibtc.dev/logos/aibtcdev-avatar-1000px.png",
    accepts,
  };
}
