/**
 * Cloudflare AI List Models Endpoint
 *
 * Free endpoint that lists available Cloudflare AI models.
 */

import { FreeEndpoint } from "../../base";
import type { AppContext } from "../../../types";

// Cloudflare AI models available for text generation
// https://developers.cloudflare.com/workers-ai/models/
const CLOUDFLARE_MODELS = [
  {
    id: "@cf/meta/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B Instruct",
    provider: "Meta",
    contextLength: 8192,
    description: "Fast, efficient model good for general tasks",
  },
  {
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B Instruct (FP8 Fast)",
    provider: "Meta",
    contextLength: 8192,
    description: "High-quality model for complex tasks",
  },
  {
    id: "@cf/mistral/mistral-7b-instruct-v0.1",
    name: "Mistral 7B Instruct",
    provider: "Mistral",
    contextLength: 8192,
    description: "Efficient instruction-following model",
  },
  {
    id: "@hf/thebloke/deepseek-coder-6.7b-instruct-awq",
    name: "DeepSeek Coder 6.7B",
    provider: "DeepSeek",
    contextLength: 8192,
    description: "Specialized for code generation",
  },
  {
    id: "@cf/qwen/qwen1.5-14b-chat-awq",
    name: "Qwen 1.5 14B Chat",
    provider: "Qwen",
    contextLength: 8192,
    description: "Multilingual chat model",
  },
  {
    id: "@cf/google/gemma-7b-it-lora",
    name: "Gemma 7B Instruct",
    provider: "Google",
    contextLength: 8192,
    description: "Google's efficient instruction model",
  },
];

export class CloudflareListModels extends FreeEndpoint {
  schema = {
    tags: ["Inference"],
    summary: "(free) List available Cloudflare AI models",
    description: "Returns a list of text generation models available through Cloudflare AI.",
    responses: {
      "200": {
        description: "List of available models",
        content: {
          "application/json": {
            schema: {
              type: "object" as const,
              properties: {
                ok: { type: "boolean" as const },
                models: {
                  type: "array" as const,
                  items: {
                    type: "object" as const,
                    properties: {
                      id: { type: "string" as const },
                      name: { type: "string" as const },
                      provider: { type: "string" as const },
                      contextLength: { type: "integer" as const },
                      description: { type: "string" as const },
                    },
                  },
                },
                count: { type: "integer" as const },
              },
            },
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    return c.json({
      ok: true,
      models: CLOUDFLARE_MODELS,
      count: CLOUDFLARE_MODELS.length,
    });
  }
}
