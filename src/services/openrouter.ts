/**
 * OpenRouter API Service
 *
 * Handles communication with the OpenRouter API.
 * OpenRouter uses OpenAI-compatible format.
 *
 * API Reference: https://openrouter.ai/docs/api/reference/overview
 */

import type { Logger } from "../types";

// =============================================================================
// Constants
// =============================================================================

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const APP_REFERER = "https://aibtc.dev";
const APP_TITLE = "x402 Stacks API Host";

// =============================================================================
// Types
// =============================================================================

/** OpenRouter chat completion request */
export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: { type: "text" | "json_object" };
}

/** OpenRouter chat completion response (non-streaming) */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: unknown[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** OpenRouter model info */
export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: {
    prompt: string; // Cost per token as string (e.g., "0.000001")
    completion: string;
    image?: string;
    request?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  per_request_limits?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/** OpenRouter models list response */
export interface ModelsResponse {
  data: OpenRouterModel[];
}

/** Usage info extracted from response */
export interface UsageInfo {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// =============================================================================
// OpenRouter Client
// =============================================================================

export class OpenRouterClient {
  private apiKey: string;
  private log: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.apiKey = apiKey;
    this.log = logger;
  }

  /**
   * Get common headers for OpenRouter requests
   */
  private getHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": APP_REFERER,
      "X-Title": APP_TITLE,
    };
  }

  /**
   * Fetch available models from OpenRouter
   */
  async getModels(): Promise<ModelsResponse> {
    this.log.debug("Fetching models from OpenRouter");

    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log.error("OpenRouter models request failed", {
        status: response.status,
        error: errorText,
      });
      throw new OpenRouterError(
        `Failed to fetch models: ${response.status}`,
        response.status,
        errorText
      );
    }

    const data = (await response.json()) as ModelsResponse;
    this.log.debug("Models fetched successfully", { count: data.data.length });

    return data;
  }

  /**
   * Create a chat completion (non-streaming)
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<{ response: ChatCompletionResponse; usage: UsageInfo }> {
    this.log.info("Creating chat completion", {
      model: request.model,
      messageCount: request.messages.length,
    });

    // Force non-streaming for now
    const payload = { ...request, stream: false };

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log.error("OpenRouter chat completion failed", {
        status: response.status,
        error: errorText,
        model: request.model,
      });
      throw new OpenRouterError(
        `Chat completion failed: ${response.status}`,
        response.status,
        errorText
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;

    // Extract usage info
    const usage = this.extractUsage(data, request.model);

    this.log.info("Chat completion successful", {
      model: data.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
    });

    return { response: data, usage };
  }

  /**
   * Create a streaming chat completion
   * Returns a ReadableStream that can be piped to the client
   */
  async createChatCompletionStream(
    request: ChatCompletionRequest
  ): Promise<{ stream: ReadableStream; model: string }> {
    this.log.info("Creating streaming chat completion", {
      model: request.model,
      messageCount: request.messages.length,
    });

    const payload = { ...request, stream: true };

    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log.error("OpenRouter streaming request failed", {
        status: response.status,
        error: errorText,
        model: request.model,
      });
      throw new OpenRouterError(
        `Streaming request failed: ${response.status}`,
        response.status,
        errorText
      );
    }

    if (!response.body) {
      throw new OpenRouterError("No response body for stream", 500);
    }

    this.log.debug("Streaming response started", { model: request.model });

    return {
      stream: response.body,
      model: request.model,
    };
  }

  /**
   * Extract usage information from a completion response
   */
  private extractUsage(
    response: ChatCompletionResponse,
    requestModel: string
  ): UsageInfo {
    const usage = response.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    // Estimate cost (we'll need model pricing for accurate calculation)
    // For now, use a rough estimate based on typical pricing
    // TODO: Fetch model pricing and calculate accurately
    const estimatedCostUsd = this.estimateCost(
      usage.prompt_tokens,
      usage.completion_tokens,
      response.model || requestModel
    );

    return {
      model: response.model || requestModel,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedCostUsd,
    };
  }

  /**
   * Estimate cost based on token counts
   * Uses rough averages - actual pricing varies by model
   * TODO: Cache model pricing and calculate accurately
   */
  private estimateCost(
    promptTokens: number,
    completionTokens: number,
    model: string
  ): number {
    // Default pricing (roughly GPT-4 turbo pricing as baseline)
    // These are OpenRouter's prices per token
    let promptCostPer1k = 0.01; // $0.01 per 1K prompt tokens
    let completionCostPer1k = 0.03; // $0.03 per 1K completion tokens

    // Adjust for known model categories
    const modelLower = model.toLowerCase();
    if (modelLower.includes("gpt-3.5") || modelLower.includes("claude-instant")) {
      promptCostPer1k = 0.0005;
      completionCostPer1k = 0.0015;
    } else if (modelLower.includes("gpt-4o-mini") || modelLower.includes("claude-3-haiku")) {
      promptCostPer1k = 0.00015;
      completionCostPer1k = 0.0006;
    } else if (modelLower.includes("gpt-4o") || modelLower.includes("claude-3.5-sonnet")) {
      promptCostPer1k = 0.0025;
      completionCostPer1k = 0.01;
    } else if (modelLower.includes("gpt-4-turbo") || modelLower.includes("claude-3-opus")) {
      promptCostPer1k = 0.01;
      completionCostPer1k = 0.03;
    } else if (modelLower.includes("llama") || modelLower.includes("mistral")) {
      promptCostPer1k = 0.0002;
      completionCostPer1k = 0.0002;
    }

    const promptCost = (promptTokens / 1000) * promptCostPer1k;
    const completionCost = (completionTokens / 1000) * completionCostPer1k;

    return promptCost + completionCost;
  }
}

// =============================================================================
// Error Class
// =============================================================================

export class OpenRouterError extends Error {
  public status: number;
  public details?: string;
  public retryable: boolean;

  constructor(message: string, status: number, details?: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.details = details;

    // 5xx errors and 429 (rate limit) are retryable
    this.retryable = status >= 500 || status === 429;
  }
}
