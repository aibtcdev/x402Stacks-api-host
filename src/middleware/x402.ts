/**
 * x402 Payment Middleware
 *
 * Verifies x402 payments for API requests using the x402-stacks library.
 * Based on stx402 implementation pattern.
 */

import type { Context } from "hono";
import { X402PaymentVerifier } from "x402-stacks";
import type { TokenContract } from "x402-stacks";
import { deserializeTransaction } from "@stacks/transactions";
import type { Env, AppVariables, Logger } from "../types";
import type { ChatCompletionRequest } from "../services/openrouter";
import {
  estimatePaymentAmount,
  validateTokenType,
  type TokenType,
  type PriceEstimate,
} from "../utils/pricing";

// =============================================================================
// Types
// =============================================================================

export interface X402PaymentRequired {
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  network: "mainnet" | "testnet";
  nonce: string;
  expiresAt: string;
  tokenType: TokenType;
  tokenContract?: TokenContract;
  estimate: {
    model: string;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCostUsd: string;
  };
}

export interface SettlePaymentResult {
  isValid: boolean;
  txId?: string;
  status?: string;
  blockHeight?: number;
  error?: string;
  reason?: string;
  validationError?: string;
  sender?: string;
  senderAddress?: string;
  sender_address?: string;
  recipient?: string;
  recipientAddress?: string;
  recipient_address?: string;
  [key: string]: unknown; // Index signature for logging compatibility
}

export interface X402Context {
  payerAddress: string;
  settleResult: SettlePaymentResult;
  signedTx: string;
  priceEstimate: PriceEstimate;
  parsedBody: ChatCompletionRequest;
}

// =============================================================================
// Token Contracts
// =============================================================================

const TOKEN_CONTRACTS: Record<"mainnet" | "testnet", Record<"sBTC" | "USDCx", TokenContract>> = {
  mainnet: {
    sBTC: { address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", name: "sbtc-token" },
    USDCx: { address: "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K", name: "token-susdc" }, // xReserve USDCx
  },
  testnet: {
    sBTC: { address: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT", name: "sbtc-token" },
    USDCx: { address: "ST1NXBK3K5YYMD6FD41MVNP3JS1GABZ8TRVX023PT", name: "token-susdc" }, // xReserve USDCx
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract sender hash160 from a signed transaction
 */
function extractSenderFromTx(signedTxHex: string): string | null {
  try {
    const hex = signedTxHex.startsWith("0x") ? signedTxHex.slice(2) : signedTxHex;
    const tx = deserializeTransaction(hex);

    if (tx.auth?.spendingCondition) {
      const spendingCondition = tx.auth.spendingCondition as { signer?: string };
      return spendingCondition.signer || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract payer address from settle result or signed tx
 * Uses both sources with fallback as decided
 */
function extractPayerAddress(
  settleResult: SettlePaymentResult,
  signedTxHex: string,
  network: "mainnet" | "testnet",
  log: Logger
): string | null {
  // Try settle result first (preferred - from facilitator)
  const fromResult =
    settleResult.senderAddress ||
    settleResult.sender_address ||
    settleResult.sender;

  if (fromResult) {
    log.debug("Payer address from settle result", { address: fromResult });
    return fromResult;
  }

  // Fallback: extract hash160 from signed transaction
  // Note: We use hash160 as identifier if full address not available from facilitator
  const hash160 = extractSenderFromTx(signedTxHex);
  if (hash160) {
    // Use hash160 with network prefix as identifier
    // This is a fallback - facilitator should normally return full address
    const identifier = `${network}:${hash160}`;
    log.debug("Payer identifier from tx deserialization (hash160)", { identifier, hash160 });
    return identifier;
  }

  log.warn("Could not extract payer address");
  return null;
}

/**
 * Classify payment errors for appropriate response
 */
function classifyPaymentError(error: unknown, settleResult?: SettlePaymentResult): {
  code: string;
  message: string;
  httpStatus: number;
  retryAfter?: number;
} {
  const errorStr = String(error).toLowerCase();
  const resultError = settleResult?.error?.toLowerCase() || "";
  const resultReason = settleResult?.reason?.toLowerCase() || "";
  const validationError = settleResult?.validationError?.toLowerCase() || "";
  const combined = `${errorStr} ${resultError} ${resultReason} ${validationError}`;

  // Network errors
  if (combined.includes("fetch") || combined.includes("network") || combined.includes("timeout")) {
    return { code: "NETWORK_ERROR", message: "Network error with payment facilitator", httpStatus: 502, retryAfter: 5 };
  }

  // Facilitator unavailable
  if (combined.includes("503") || combined.includes("unavailable")) {
    return { code: "FACILITATOR_UNAVAILABLE", message: "Payment facilitator temporarily unavailable", httpStatus: 503, retryAfter: 30 };
  }

  // Insufficient funds
  if (combined.includes("insufficient") || combined.includes("balance")) {
    return { code: "INSUFFICIENT_FUNDS", message: "Insufficient funds in wallet", httpStatus: 402 };
  }

  // Payment expired
  if (combined.includes("expired") || combined.includes("nonce")) {
    return { code: "PAYMENT_EXPIRED", message: "Payment expired, please sign a new payment", httpStatus: 402 };
  }

  // Amount too low
  if (combined.includes("amount") && (combined.includes("low") || combined.includes("minimum"))) {
    return { code: "AMOUNT_TOO_LOW", message: "Payment amount below minimum required", httpStatus: 402 };
  }

  // Invalid payment
  if (combined.includes("invalid") || combined.includes("signature")) {
    return { code: "PAYMENT_INVALID", message: "Invalid payment signature", httpStatus: 400 };
  }

  // Default
  return { code: "UNKNOWN_ERROR", message: "Payment processing error", httpStatus: 500, retryAfter: 5 };
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create x402 payment middleware for chat completions
 *
 * This middleware:
 * 1. Checks for X-PAYMENT header
 * 2. If missing, returns 402 with payment requirements
 * 3. If present, verifies payment with facilitator
 * 4. Extracts payer address and stores in context
 */
export function x402PaymentMiddleware() {
  return async (
    c: Context<{ Bindings: Env; Variables: AppVariables & { x402?: X402Context } }>,
    next: () => Promise<Response | void>
  ) => {
    const log = c.var.logger;

    // Check if x402 is configured
    if (!c.env.X402_SERVER_ADDRESS) {
      log.warn("X402_SERVER_ADDRESS not configured, skipping payment verification");
      return next();
    }

    // Get token type from header or query
    const tokenTypeStr = c.req.header("X-PAYMENT-TOKEN-TYPE") || c.req.query("tokenType") || "STX";
    let tokenType: TokenType;
    try {
      tokenType = validateTokenType(tokenTypeStr);
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }

    // Parse request body to estimate cost
    let body: ChatCompletionRequest;
    try {
      body = await c.req.json<ChatCompletionRequest>();
    } catch {
      return c.json({ error: "Invalid JSON in request body" }, 400);
    }

    // Calculate price estimate
    const priceEstimate = estimatePaymentAmount(body, tokenType, log);

    const config = {
      minAmount: priceEstimate.amountInToken,
      address: c.env.X402_SERVER_ADDRESS,
      network: c.env.X402_NETWORK,
      facilitatorUrl: c.env.X402_FACILITATOR_URL,
    };

    // Check for payment header
    const signedTx = c.req.header("X-PAYMENT");

    if (!signedTx) {
      // Return 402 with payment requirements
      log.info("No payment header, returning 402", {
        model: body.model,
        amountRequired: config.minAmount.toString(),
        tokenType,
      });

      // Get token contract for sBTC/USDCx
      let tokenContract: TokenContract | undefined;
      if (tokenType === "sBTC" || tokenType === "USDCx") {
        tokenContract = TOKEN_CONTRACTS[config.network][tokenType];
      }

      const paymentRequest: X402PaymentRequired = {
        maxAmountRequired: config.minAmount.toString(),
        resource: c.req.path,
        payTo: config.address,
        network: config.network,
        nonce: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        tokenType,
        ...(tokenContract && { tokenContract }),
        estimate: {
          model: priceEstimate.model,
          estimatedInputTokens: priceEstimate.estimatedInputTokens,
          estimatedOutputTokens: priceEstimate.estimatedOutputTokens,
          estimatedCostUsd: priceEstimate.costWithMarginUsd.toFixed(6),
        },
      };

      return c.json(paymentRequest, 402);
    }

    // Verify payment with facilitator
    const verifier = new X402PaymentVerifier(config.facilitatorUrl, config.network);

    log.debug("Verifying payment", {
      facilitatorUrl: config.facilitatorUrl,
      expectedRecipient: config.address,
      minAmount: config.minAmount.toString(),
      tokenType,
    });

    let settleResult: SettlePaymentResult;
    try {
      settleResult = (await verifier.settlePayment(signedTx, {
        expectedRecipient: config.address,
        minAmount: config.minAmount,
        tokenType,
      })) as unknown as SettlePaymentResult;

      log.debug("Settle result", settleResult);
    } catch (error) {
      log.error("Payment verification exception", { error: String(error) });

      const classified = classifyPaymentError(error);
      if (classified.retryAfter) {
        c.header("Retry-After", String(classified.retryAfter));
      }

      return c.json(
        {
          error: classified.message,
          code: classified.code,
          tokenType,
          resource: c.req.path,
        },
        classified.httpStatus as 400 | 402 | 500 | 502 | 503
      );
    }

    if (!settleResult.isValid) {
      log.error("Payment invalid", settleResult);

      const classified = classifyPaymentError(
        settleResult.validationError || settleResult.error || "invalid",
        settleResult
      );

      if (classified.retryAfter) {
        c.header("Retry-After", String(classified.retryAfter));
      }

      return c.json(
        {
          error: classified.message,
          code: classified.code,
          tokenType,
          resource: c.req.path,
          details: {
            settleError: settleResult.error,
            settleReason: settleResult.reason,
            validationError: settleResult.validationError,
          },
        },
        classified.httpStatus as 400 | 402 | 500 | 502 | 503
      );
    }

    // Extract payer address
    const payerAddress = extractPayerAddress(settleResult, signedTx, config.network, log);

    if (!payerAddress) {
      log.error("Could not extract payer address from valid payment");
      return c.json(
        { error: "Could not identify payer from payment", code: "PAYER_UNKNOWN" },
        500
      );
    }

    log.info("Payment verified successfully", {
      txId: settleResult.txId,
      payerAddress,
      tokenType,
      amount: config.minAmount.toString(),
    });

    // Store payment context for downstream use
    c.set("x402", {
      payerAddress,
      settleResult,
      signedTx,
      priceEstimate,
      parsedBody: body,
    } as X402Context);

    // Add response headers
    c.header("X-PAYMENT-RESPONSE", JSON.stringify(settleResult));
    c.header("X-PAYER-ADDRESS", payerAddress);

    return next();
  };
}

/**
 * Get x402 context from Hono context
 */
export function getX402Context(
  c: Context<{ Bindings: Env; Variables: AppVariables & { x402?: X402Context } }>
): X402Context | null {
  return c.var.x402 || null;
}
