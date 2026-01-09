/**
 * Pricing Utility for x402 Payments
 *
 * Estimates cost based on model pricing and input tokens.
 * Used to calculate pre-payment amount for x402.
 */

import { STXtoMicroSTX, BTCtoSats, USDCxToMicroUSDCx } from "x402-stacks";
import type { Logger } from "../types";
import type { ChatCompletionRequest } from "../services/openrouter";

// =============================================================================
// Types
// =============================================================================

export type TokenType = "STX" | "sBTC" | "USDCx";

export interface ModelPricing {
  promptPer1k: number; // USD per 1K prompt tokens
  completionPer1k: number; // USD per 1K completion tokens
}

export interface PriceEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  costWithMarginUsd: number;
  amountInToken: bigint;
  tokenType: TokenType;
  model: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Margin added to OpenRouter costs (20% as decided) */
const COST_MARGIN = 0.20;

/** Buffer for output tokens when estimating (assume 2x input for safety) */
const OUTPUT_TOKEN_MULTIPLIER = 2;

/** Minimum payment in USD (floor for very small requests) */
const MIN_PAYMENT_USD = 0.001;

/** Approximate tokens per character (conservative estimate) */
const TOKENS_PER_CHAR = 0.25;

/**
 * Model pricing in USD per 1K tokens
 * Based on OpenRouter pricing - updated periodically
 * https://openrouter.ai/docs/models
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI models
  "openai/gpt-4o": { promptPer1k: 0.0025, completionPer1k: 0.01 },
  "openai/gpt-4o-mini": { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  "openai/gpt-4-turbo": { promptPer1k: 0.01, completionPer1k: 0.03 },
  "openai/gpt-3.5-turbo": { promptPer1k: 0.0005, completionPer1k: 0.0015 },

  // Anthropic models
  "anthropic/claude-3.5-sonnet": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "anthropic/claude-3-opus": { promptPer1k: 0.015, completionPer1k: 0.075 },
  "anthropic/claude-3-haiku": { promptPer1k: 0.00025, completionPer1k: 0.00125 },
  "anthropic/claude-instant-1.2": { promptPer1k: 0.0008, completionPer1k: 0.0024 },

  // Google models
  "google/gemini-pro": { promptPer1k: 0.000125, completionPer1k: 0.000375 },
  "google/gemini-pro-1.5": { promptPer1k: 0.00125, completionPer1k: 0.005 },

  // Meta models
  "meta-llama/llama-3.1-70b-instruct": { promptPer1k: 0.00035, completionPer1k: 0.0004 },
  "meta-llama/llama-3.1-8b-instruct": { promptPer1k: 0.00005, completionPer1k: 0.00005 },

  // Mistral models
  "mistralai/mistral-7b-instruct": { promptPer1k: 0.00006, completionPer1k: 0.00006 },
  "mistralai/mixtral-8x7b-instruct": { promptPer1k: 0.00024, completionPer1k: 0.00024 },
};

/** Default pricing for unknown models (conservative/high estimate) */
const DEFAULT_PRICING: ModelPricing = {
  promptPer1k: 0.01,
  completionPer1k: 0.03,
};

/**
 * Token exchange rates (approximate, for converting USD to tokens)
 * Updated periodically based on market rates
 */
const TOKEN_RATES: Record<TokenType, number> = {
  STX: 0.50, // 1 STX ≈ $0.50 USD
  sBTC: 100000, // 1 sBTC ≈ $100,000 USD
  USDCx: 1.0, // 1 USDCx = $1 USD (Circle USDC via xReserve)
};

// =============================================================================
// Functions
// =============================================================================

/**
 * Get pricing for a model
 */
export function getModelPricing(model: string): ModelPricing {
  // Try exact match
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try prefix match (e.g., "openai/gpt-4o-2024-08-06" matches "openai/gpt-4o")
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) {
      return pricing;
    }
  }

  // Try category match based on model name patterns
  const modelLower = model.toLowerCase();

  if (modelLower.includes("gpt-4o-mini") || modelLower.includes("haiku")) {
    return { promptPer1k: 0.00015, completionPer1k: 0.0006 };
  }
  if (modelLower.includes("gpt-4o") || modelLower.includes("sonnet")) {
    return { promptPer1k: 0.003, completionPer1k: 0.015 };
  }
  if (modelLower.includes("gpt-4") || modelLower.includes("opus")) {
    return { promptPer1k: 0.01, completionPer1k: 0.03 };
  }
  if (modelLower.includes("gpt-3.5") || modelLower.includes("instant")) {
    return { promptPer1k: 0.0005, completionPer1k: 0.0015 };
  }
  if (modelLower.includes("llama") || modelLower.includes("mistral")) {
    return { promptPer1k: 0.0002, completionPer1k: 0.0002 };
  }

  return DEFAULT_PRICING;
}

/**
 * Estimate token count from messages
 */
export function estimateInputTokens(messages: ChatCompletionRequest["messages"]): number {
  let totalChars = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    }
    // Add overhead for role, formatting
    totalChars += 10;
  }

  // Convert chars to tokens (conservative estimate)
  return Math.ceil(totalChars * TOKENS_PER_CHAR);
}

/**
 * Convert USD to token amount
 */
export function usdToTokenAmount(usd: number, tokenType: TokenType): bigint {
  const rate = TOKEN_RATES[tokenType];
  const tokenAmount = usd / rate;

  switch (tokenType) {
    case "STX":
      return STXtoMicroSTX(tokenAmount.toFixed(6));
    case "sBTC":
      return BTCtoSats(tokenAmount);
    case "USDCx":
      // USDCx has 6 decimals (Circle USDC via xReserve)
      return USDCxToMicroUSDCx(tokenAmount);
    default:
      throw new Error(`Unknown token type: ${tokenType}`);
  }
}

/**
 * Estimate payment amount for a chat completion request
 */
export function estimatePaymentAmount(
  request: ChatCompletionRequest,
  tokenType: TokenType,
  log?: Logger
): PriceEstimate {
  const pricing = getModelPricing(request.model);
  const estimatedInputTokens = estimateInputTokens(request.messages);

  // Estimate output tokens (use max_tokens if provided, otherwise estimate)
  const estimatedOutputTokens = request.max_tokens
    ? Math.min(request.max_tokens, estimatedInputTokens * OUTPUT_TOKEN_MULTIPLIER)
    : estimatedInputTokens * OUTPUT_TOKEN_MULTIPLIER;

  // Calculate cost in USD
  const promptCost = (estimatedInputTokens / 1000) * pricing.promptPer1k;
  const completionCost = (estimatedOutputTokens / 1000) * pricing.completionPer1k;
  const estimatedCostUsd = promptCost + completionCost;

  // Apply margin and minimum
  const costWithMarginUsd = Math.max(
    estimatedCostUsd * (1 + COST_MARGIN),
    MIN_PAYMENT_USD
  );

  // Convert to token amount
  const amountInToken = usdToTokenAmount(costWithMarginUsd, tokenType);

  const estimate: PriceEstimate = {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    costWithMarginUsd,
    amountInToken,
    tokenType,
    model: request.model,
  };

  // Log for PnL tracking
  if (log) {
    log.debug("Price estimate calculated", {
      model: request.model,
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      promptPer1k: pricing.promptPer1k,
      completionPer1k: pricing.completionPer1k,
      estimatedCostUsd: estimatedCostUsd.toFixed(6),
      costWithMarginUsd: costWithMarginUsd.toFixed(6),
      tokenType,
      amountInToken: amountInToken.toString(),
    });
  }

  return estimate;
}

/**
 * Log actual vs estimated cost for PnL tracking
 */
export function logPnL(
  estimate: PriceEstimate,
  actualCostUsd: number,
  actualInputTokens: number,
  actualOutputTokens: number,
  log: Logger
): void {
  const estimateError = ((estimate.estimatedCostUsd - actualCostUsd) / actualCostUsd) * 100;
  const profit = estimate.costWithMarginUsd - actualCostUsd;

  log.info("PnL tracking", {
    model: estimate.model,
    // Estimated
    estimatedInputTokens: estimate.estimatedInputTokens,
    estimatedOutputTokens: estimate.estimatedOutputTokens,
    estimatedCostUsd: estimate.estimatedCostUsd.toFixed(6),
    // Actual
    actualInputTokens,
    actualOutputTokens,
    actualCostUsd: actualCostUsd.toFixed(6),
    // Analysis
    estimateErrorPct: estimateError.toFixed(1),
    chargedUsd: estimate.costWithMarginUsd.toFixed(6),
    profitUsd: profit.toFixed(6),
    profitPct: ((profit / actualCostUsd) * 100).toFixed(1),
  });
}

/**
 * Validate token type
 */
export function validateTokenType(tokenTypeStr: string): TokenType {
  const upper = tokenTypeStr.toUpperCase();
  const validMap: Record<string, TokenType> = {
    STX: "STX",
    SBTC: "sBTC",
    USDCX: "USDCx",
    USDC: "USDCx", // Alias USDC to USDCx for convenience
  };

  if (validMap[upper]) {
    return validMap[upper];
  }

  throw new Error(`Invalid tokenType: ${tokenTypeStr}. Supported: STX, sBTC, USDCx`);
}
