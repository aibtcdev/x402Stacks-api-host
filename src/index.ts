/**
 * x402 Stacks API Host
 *
 * Cloudflare Worker exposing third-party APIs on a pay-per-use basis
 * using the x402 protocol.
 *
 * Architecture follows Cloudflare best practices (Dec 2025):
 * - SQLite-backed Durable Objects with RPC methods
 * - blockConcurrencyWhile() for schema initialization
 * - Hono for HTTP routing
 * - worker-logs integration for centralized logging
 */

import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loggerMiddleware, getLogger } from "./utils/logger";
import {
  OpenRouterClient,
  OpenRouterError,
  type ChatCompletionRequest,
} from "./services/openrouter";
import { x402PaymentMiddleware, getX402Context, type X402Context } from "./middleware/x402";
import { logPnL } from "./utils/pricing";
import { isValidStacksAddress } from "x402-stacks";
import type {
  Env,
  AppVariables,
  UsageRecord,
  DailyStats,
  AgentIdentity,
  HealthResponse,
} from "./types";

// =============================================================================
// Constants
// =============================================================================

/** Margin added to OpenRouter costs (20% as decided) */
const COST_MARGIN = 0.20;

// =============================================================================
// Extended App Variables (includes x402 context)
// =============================================================================

type AppVarsWithX402 = AppVariables & { x402?: X402Context };

// =============================================================================
// OpenRouter Durable Object
// =============================================================================

/**
 * OpenRouter Durable Object
 *
 * Per-agent state for OpenRouter API access:
 * - Usage tracking (tokens, cost per request)
 * - Daily stats aggregation
 * - Rate limiting (TODO)
 *
 * Design follows Cloudflare "Rules of Durable Objects" (Dec 2025):
 * - One DO per agent (not a global singleton)
 * - SQLite storage (recommended over KV)
 * - RPC methods (not fetch handler)
 * - blockConcurrencyWhile() for initialization
 */
export class OpenRouterDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Use blockConcurrencyWhile to prevent race conditions during schema init
    // This ensures no requests are processed until schema is ready
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
    });
  }

  /**
   * Initialize database schema
   * Called in constructor via blockConcurrencyWhile
   */
  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS identity (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT PRIMARY KEY,
        total_requests INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_request_id ON usage(request_id);
    `);
  }

  // ===========================================================================
  // Identity Management (RPC methods)
  // ===========================================================================

  /**
   * Initialize the DO with an agent ID
   * Called once when first routing to this DO
   * DOs don't know their own name/ID, so we store it explicitly
   */
  async init(agentId: string): Promise<AgentIdentity> {
    try {
      const existing = this.sql
        .exec("SELECT value FROM identity WHERE key = 'agent_id'")
        .toArray();

      if (existing.length > 0) {
        const createdAt = this.sql
          .exec("SELECT value FROM identity WHERE key = 'created_at'")
          .toArray();
        return {
          agentId: existing[0].value as string,
          createdAt: createdAt[0]?.value as string,
        };
      }

      const now = new Date().toISOString();
      this.sql.exec(
        "INSERT INTO identity (key, value) VALUES ('agent_id', ?)",
        agentId
      );
      this.sql.exec(
        "INSERT INTO identity (key, value) VALUES ('created_at', ?)",
        now
      );

      return { agentId, createdAt: now };
    } catch (error) {
      console.error("[OpenRouterDO] Failed to init identity:", error);
      throw error;
    }
  }

  /**
   * Get the agent's identity
   */
  async getIdentity(): Promise<AgentIdentity | null> {
    try {
      const agentId = this.sql
        .exec("SELECT value FROM identity WHERE key = 'agent_id'")
        .toArray();

      if (agentId.length === 0) {
        return null;
      }

      const createdAt = this.sql
        .exec("SELECT value FROM identity WHERE key = 'created_at'")
        .toArray();

      return {
        agentId: agentId[0].value as string,
        createdAt: createdAt[0]?.value as string,
      };
    } catch (error) {
      console.error("[OpenRouterDO] Failed to get identity:", error);
      throw error;
    }
  }

  // ===========================================================================
  // Usage Tracking (RPC methods)
  // ===========================================================================

  /**
   * Record usage for a request
   */
  async recordUsage(data: UsageRecord): Promise<void> {
    try {
      const today = new Date().toISOString().split("T")[0];

      // Insert usage record
      this.sql.exec(
        `INSERT INTO usage (request_id, model, prompt_tokens, completion_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?)`,
        data.requestId,
        data.model,
        data.promptTokens,
        data.completionTokens,
        data.costUsd
      );

      // Update daily stats (atomic via write coalescing)
      this.sql.exec(
        `INSERT INTO daily_stats (date, total_requests, total_tokens, total_cost_usd)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           total_requests = total_requests + 1,
           total_tokens = total_tokens + excluded.total_tokens,
           total_cost_usd = total_cost_usd + excluded.total_cost_usd`,
        today,
        data.promptTokens + data.completionTokens,
        data.costUsd
      );
    } catch (error) {
      console.error("[OpenRouterDO] Failed to record usage:", error);
      throw error;
    }
  }

  /**
   * Get usage stats for the agent
   */
  async getStats(days: number = 7): Promise<DailyStats[]> {
    try {
      const result = this.sql.exec(
        `SELECT date, total_requests, total_tokens, total_cost_usd
         FROM daily_stats
         ORDER BY date DESC
         LIMIT ?`,
        days
      );

      return result.toArray().map((row) => ({
        date: row.date as string,
        totalRequests: row.total_requests as number,
        totalTokens: row.total_tokens as number,
        totalCostUsd: row.total_cost_usd as number,
      }));
    } catch (error) {
      console.error("[OpenRouterDO] Failed to get stats:", error);
      throw error;
    }
  }

  /**
   * Get total usage across all time
   */
  async getTotalUsage(): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
  }> {
    try {
      const result = this.sql
        .exec(
          `SELECT
            COALESCE(SUM(total_requests), 0) as total_requests,
            COALESCE(SUM(total_tokens), 0) as total_tokens,
            COALESCE(SUM(total_cost_usd), 0) as total_cost_usd
           FROM daily_stats`
        )
        .toArray();

      const row = result[0];
      return {
        totalRequests: row?.total_requests as number ?? 0,
        totalTokens: row?.total_tokens as number ?? 0,
        totalCostUsd: row?.total_cost_usd as number ?? 0,
      };
    } catch (error) {
      console.error("[OpenRouterDO] Failed to get total usage:", error);
      throw error;
    }
  }

  /**
   * Get recent usage records
   */
  async getRecentUsage(limit: number = 10): Promise<
    Array<{
      requestId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
      timestamp: string;
    }>
  > {
    try {
      const result = this.sql.exec(
        `SELECT request_id, model, prompt_tokens, completion_tokens, cost_usd, timestamp
         FROM usage
         ORDER BY timestamp DESC
         LIMIT ?`,
        limit
      );

      return result.toArray().map((row) => ({
        requestId: row.request_id as string,
        model: row.model as string,
        promptTokens: row.prompt_tokens as number,
        completionTokens: row.completion_tokens as number,
        costUsd: row.cost_usd as number,
        timestamp: row.timestamp as string,
      }));
    } catch (error) {
      console.error("[OpenRouterDO] Failed to get recent usage:", error);
      throw error;
    }
  }
}

// =============================================================================
// Hono App
// =============================================================================

const app = new Hono<{ Bindings: Env; Variables: AppVarsWithX402 }>();

// CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["X-PAYMENT", "X-PAYMENT-TOKEN-TYPE", "Authorization", "X-Agent-ID", "X-Stacks-Address", "Content-Type"],
    exposeHeaders: ["X-PAYMENT-RESPONSE", "X-PAYER-ADDRESS", "X-Request-ID"],
  })
);

// Logger middleware - creates logger with CF-Ray ID
app.use("*", loggerMiddleware);

// =============================================================================
// Health & Info Endpoints
// =============================================================================

app.get("/", (c) => {
  return c.json({
    service: "x402-api-host",
    version: "0.1.0",
    description: "x402 micropayment-gated API proxy for OpenRouter",
    endpoints: {
      "GET /health": "Health check",
      "POST /v1/chat/completions": "OpenRouter proxy (x402 paid)",
      "GET /v1/models": "List available models",
      "GET /usage": "Get usage stats (requires auth)",
    },
  });
});

app.get("/health", (c) => {
  const log = getLogger(c);
  log.debug("Health check requested");

  const response: HealthResponse = {
    status: "ok",
    environment: c.env.ENVIRONMENT,
    services: ["openrouter"],
  };

  return c.json(response);
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get DO stub for an agent
 * Uses Stacks address as the DO key
 * Returns typed stub for RPC method calls
 */
function getAgentDO(env: Env, agentId: string): DurableObjectStub<OpenRouterDO> {
  const id = env.OPENROUTER_DO.idFromName(agentId);
  return env.OPENROUTER_DO.get(id) as DurableObjectStub<OpenRouterDO>;
}

/**
 * Extract agent ID from request
 * TODO: Get from x402 payment header once implemented
 * For now, uses X-Agent-ID header for testing
 */
function getAgentId(c: { req: { header: (name: string) => string | undefined } }): string | null {
  // Check for x402 payment header (future)
  // const paymentHeader = c.req.header("X-PAYMENT");
  // if (paymentHeader) { extract payer address }

  // For testing: use X-Agent-ID header
  const agentId = c.req.header("X-Agent-ID");
  return agentId || null;
}

// =============================================================================
// OpenRouter Proxy Endpoints
// =============================================================================

app.get("/v1/models", async (c) => {
  const log = getLogger(c);

  log.info("Models list requested");

  try {
    // Check for API key
    if (!c.env.OPENROUTER_API_KEY) {
      log.error("OPENROUTER_API_KEY not configured");
      return c.json(
        { error: "Service not configured" },
        { status: 503 }
      );
    }

    const client = new OpenRouterClient(c.env.OPENROUTER_API_KEY, log);
    const models = await client.getModels();

    log.info("Models fetched successfully", { count: models.data.length });

    return c.json(models);
  } catch (error) {
    if (error instanceof OpenRouterError) {
      log.error("OpenRouter error fetching models", {
        status: error.status,
        details: error.details,
      });
      const status = error.status >= 500 ? 502 : error.status;
      return c.json({ error: error.message }, status as 400 | 401 | 402 | 403 | 404 | 429 | 502);
    }

    log.error("Failed to fetch models", {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
});

app.post("/v1/chat/completions", x402PaymentMiddleware(), async (c) => {
  const log = getLogger(c);
  const requestId = c.get("requestId");

  log.info("Chat completion request received (x402 verified)");

  try {
    // Check for API key
    if (!c.env.OPENROUTER_API_KEY) {
      log.error("OPENROUTER_API_KEY not configured");
      return c.json(
        { error: "Service not configured", request_id: requestId },
        { status: 503 }
      );
    }

    // Get x402 context (set by middleware after payment verification)
    const x402 = getX402Context(c);
    if (!x402) {
      // This shouldn't happen - middleware should have returned 402
      log.error("x402 context not found after middleware");
      return c.json(
        { error: "Payment verification failed", request_id: requestId },
        { status: 500 }
      );
    }

    // Get body from x402 context (middleware already parsed and validated)
    const body = x402.parsedBody;
    const agentId = x402.payerAddress;

    // Validate required fields (middleware validates for pricing, but double-check)
    if (!body.model) {
      return c.json(
        { error: "Missing required field: model", request_id: requestId },
        { status: 400 }
      );
    }
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json(
        { error: "Missing required field: messages", request_id: requestId },
        { status: 400 }
      );
    }

    log.info("Processing chat completion", {
      model: body.model,
      messageCount: body.messages.length,
      stream: body.stream,
      agentId,
      tokenType: x402.priceEstimate.tokenType,
      estimatedCostUsd: x402.priceEstimate.costWithMarginUsd.toFixed(6),
    });

    // Create OpenRouter client
    const client = new OpenRouterClient(c.env.OPENROUTER_API_KEY, log);

    // Handle streaming vs non-streaming
    if (body.stream) {
      // Streaming response with usage tracking
      const { stream, model, usagePromise } = await client.createChatCompletionStream(body);

      log.info("Streaming response started", { model, agentId });

      // Track usage after stream completes (non-blocking)
      c.executionCtx.waitUntil(
        usagePromise.then(async (usage) => {
          if (!usage) {
            log.warn("No usage data from stream", { model, agentId });
            return;
          }

          // Calculate cost with margin
          const totalCost = usage.estimatedCostUsd * (1 + COST_MARGIN);

          log.info("Streaming completion finished", {
            model: usage.model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            actualCostUsd: usage.estimatedCostUsd,
            totalCostWithMargin: totalCost,
            agentId,
          });

          // Log PnL (estimated vs actual costs)
          logPnL(
            x402.priceEstimate,
            usage.estimatedCostUsd,
            usage.promptTokens,
            usage.completionTokens,
            log
          );

          // Record usage in agent's DO
          try {
            const stub = getAgentDO(c.env, agentId);
            await stub.init(agentId);
            const usageRecord: UsageRecord = {
              requestId,
              model: usage.model,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              costUsd: totalCost,
            };
            await stub.recordUsage(usageRecord);
            log.debug("Streaming usage recorded in DO", { agentId, requestId });
          } catch (doError) {
            log.error("Failed to record streaming usage in DO", {
              error: doError instanceof Error ? doError.message : String(doError),
              agentId,
            });
          }
        }).catch((err) => {
          log.error("Error tracking streaming usage", {
            error: err instanceof Error ? err.message : String(err),
            agentId,
          });
        })
      );

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Request-ID": requestId,
          "X-PAYER-ADDRESS": agentId,
        },
      });
    } else {
      // Non-streaming response
      const { response, usage } = await client.createChatCompletion(body);

      // Calculate cost with margin
      const totalCost = usage.estimatedCostUsd * (1 + COST_MARGIN);

      log.info("Chat completion successful", {
        model: usage.model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        actualCostUsd: usage.estimatedCostUsd,
        totalCostWithMargin: totalCost,
        agentId,
      });

      // Log PnL (estimated vs actual costs)
      logPnL(
        x402.priceEstimate,
        usage.estimatedCostUsd,
        usage.promptTokens,
        usage.completionTokens,
        log
      );

      // Record usage in agent's DO
      try {
        const stub = getAgentDO(c.env, agentId);

        // Initialize agent if first request
        await stub.init(agentId);

        // Record usage
        const usageRecord: UsageRecord = {
          requestId,
          model: usage.model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          costUsd: totalCost,
        };
        await stub.recordUsage(usageRecord);

        log.debug("Usage recorded in DO", { agentId, requestId });
      } catch (doError) {
        // Log but don't fail the request if DO recording fails
        log.error("Failed to record usage in DO", {
          error: doError instanceof Error ? doError.message : String(doError),
          agentId,
        });
      }

      return c.json(response);
    }
  } catch (error) {
    if (error instanceof OpenRouterError) {
      log.error("OpenRouter error", {
        status: error.status,
        details: error.details,
        retryable: error.retryable,
      });

      // Map OpenRouter errors to appropriate status codes
      const statusCode = (error.status >= 500 ? 502 : error.status) as 400 | 401 | 402 | 403 | 404 | 429 | 502;
      return c.json(
        {
          error: error.message,
          request_id: requestId,
          retryable: error.retryable,
        },
        statusCode
      );
    }

    log.error("Chat completion failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json(
      {
        error: "Internal server error",
        request_id: requestId,
      },
      { status: 500 }
    );
  }
});

// =============================================================================
// Usage Stats Endpoint
// =============================================================================

app.get("/usage", async (c) => {
  const log = getLogger(c);

  log.info("Usage stats requested");

  try {
    // Get Stacks address from header
    // Note: For production, this should require a signed message to prove ownership
    // For MVP, we validate address format only (usage stats aren't sensitive)
    const agentId = c.req.header("X-Stacks-Address") || c.req.header("X-Agent-ID");

    if (!agentId) {
      return c.json(
        {
          error: "Missing Stacks address",
          hint: "Provide your Stacks address in the X-Stacks-Address header",
        },
        { status: 401 }
      );
    }

    // Validate Stacks address format
    if (!isValidStacksAddress(agentId)) {
      return c.json(
        {
          error: "Invalid Stacks address format",
          hint: "Address should start with SP (mainnet) or ST (testnet)",
        },
        { status: 400 }
      );
    }

    log.debug("Fetching usage for agent", { agentId });

    // Get agent's DO
    const stub = getAgentDO(c.env, agentId);

    // Fetch stats
    const [identity, dailyStats, totalUsage, recentUsage] = await Promise.all([
      stub.getIdentity(),
      stub.getStats(30), // Last 30 days
      stub.getTotalUsage(),
      stub.getRecentUsage(20), // Last 20 requests
    ]);

    log.info("Usage stats fetched", {
      agentId,
      totalRequests: totalUsage.totalRequests,
    });

    return c.json({
      ok: true,
      data: {
        agent: identity,
        totals: totalUsage,
        dailyStats,
        recentRequests: recentUsage,
      },
    });
  } catch (error) {
    log.error("Failed to get usage stats", {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
});

// =============================================================================
// Error Handler
// =============================================================================

app.onError((err, c) => {
  const log = getLogger(c);
  const requestId = c.get("requestId") || "unknown";

  log.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
  });

  return c.json(
    {
      ok: false,
      error: "Internal server error",
      requestId,
    },
    { status: 500 }
  );
});

// =============================================================================
// 404 Handler
// =============================================================================

app.notFound((c) => {
  const log = getLogger(c);
  log.warn("Route not found", { path: c.req.path });

  return c.json(
    {
      ok: false,
      error: "Not found",
      path: c.req.path,
    },
    { status: 404 }
  );
});

// =============================================================================
// Export
// =============================================================================

export default app;
