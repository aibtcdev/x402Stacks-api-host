# x402 Stacks API Host

A Cloudflare Worker that exposes third-party APIs on a pay-per-use basis using the x402 protocol. Each API service gets its own Durable Object for isolated state, usage tracking, and rate limiting.

## Domains

| Environment | Domain | Network |
|-------------|--------|---------|
| **Production** | `x402-apis.aibtc.com` | mainnet |
| **Staging** | `x402-apis.aibtc.dev` | testnet |

## Overview

This service acts as an x402-enabled proxy for third-party APIs:

1. Agent requests an API endpoint (e.g., `/openrouter/v1/chat/completions`)
2. If unpaid, server responds with HTTP 402 and payment requirements
3. Agent signs payment and resends with `X-PAYMENT` header
4. Request is proxied to the upstream API using our API key
5. Usage is recorded in agent-specific Durable Object (keyed by Stacks address)
6. Response is returned to agent

**First target**: [OpenRouter API](https://openrouter.ai/docs) - unified access to 100+ LLM models.

## Goals

### Primary Goals

- [x] **Pay-per-use API access**: Agents pay per request/token via x402
- [x] **One DO per agent**: Isolated state per Stacks address
- [x] **Usage tracking**: Per-agent token counts, costs, request history
- [x] **OpenRouter integration**: Proxy `/openrouter/v1/chat/completions` and `/openrouter/v1/models`

### Secondary Goals

- [ ] **Rate limiting**: Per-agent rate limits to prevent abuse
- [ ] **Spending caps**: Optional per-agent spending limits
- [x] **Multi-service**: Extensible pattern for adding more API services (subfolder per service)
- [x] **Streaming support**: Handle SSE streaming with usage tracking from final chunk

## Architecture

### Durable Object Pattern

Each API service gets its own DO class:

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Agent     │────▶│  API Host Worker     │────▶│  OpenRouter API │
│             │     │                      │     │                 │
└─────────────┘     │  ┌────────────────┐  │     └─────────────────┘
                    │  │ OpenRouterDO   │  │
                    │  │ (per agent)    │  │
                    │  │ - usage stats  │  │
                    │  │ - rate limits  │  │
                    │  └────────────────┘  │
                    └──────────────────────┘
```

Each agent gets their own DO instance (by agent ID), providing:
- Isolated SQLite storage for usage tracking
- Per-agent rate limiting
- Request history and audit trail

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service info and available APIs |
| `/health` | GET | Health check |
| `/openrouter/v1/models` | GET | List available models |
| `/openrouter/v1/chat/completions` | POST | Chat completions (x402 paid) |
| `/openrouter/usage` | GET | Agent's usage stats (by Stacks address) |

## OpenRouter Integration

### API Reference

- [API Overview](https://openrouter.ai/docs/api/reference/overview)
- [Chat Completions](https://openrouter.ai/docs/quickstart)
- [Authentication](https://openrouter.ai/docs/api/reference/authentication)
- [Generation Stats](https://openrouter.ai/docs/api-reference/generation-stats)

### Key Features

- OpenAI-compatible API (`/v1/chat/completions`)
- Access to 100+ models (GPT-4, Claude, Llama, etc.)
- Automatic fallback routing
- Usage stats via `/api/v1/generation` endpoint

### Pricing Considerations

OpenRouter charges per token based on the model. We need to:
1. Pass through OpenRouter costs
2. Add our margin for x402 infrastructure
3. Handle different pricing per model

## Decisions

Decisions made on 2025-01-09:

### Payment & Pricing

| Question | Decision |
|----------|----------|
| **Pricing model** | Pass-through OpenRouter costs + **20% margin** |
| **Payment timing** | **Pre-pay** based on estimate. Credit stored in DO for free retry on upstream failure (with loop protection) |
| **Payment tokens** | **All three**: STX, sBTC, and USDC on Stacks |

### Agent Identity

| Question | Decision |
|----------|----------|
| **Agent identification** | **Stacks address** from x402 payment |
| **DO routing** | Use payer's Stacks address as DO key via `idFromName(stacksAddress)` |

### API Design

| Question | Decision |
|----------|----------|
| **Streaming** | **Pass-through** SSE stream with tight logging for PnL tracking |
| **Model selection** | **All OpenRouter models** allowed, dynamic pricing based on model |
| **Error handling** | **Credit for retry** stored in DO. Guard against retry loops (max retries, cooldown) |

### Operations

| Question | Decision |
|----------|----------|
| **Rate limits** | **Requests per minute** (RPM). Start simple, can add token limits later |
| **Cost tracking** | **DO-only tracking**. Query agent DOs for reports and reconciliation |

### Architecture

| Question | Decision |
|----------|----------|
| **Service extensibility** | **Base class + extensions**. Abstract BaseDO with service-specific subclasses |
| **MVP scope** | **OpenRouter chat completions + /v1/models**. Get x402 flow working end-to-end |

## Open Questions (Resolved)

<details>
<summary>Original questions (click to expand)</summary>

### Payment & Pricing

1. **Pricing model**: How to price requests?
   - Pass-through OpenRouter costs + fixed margin? ✅ **Selected**
   - Flat rate per request regardless of model?
   - Token-based pricing matching upstream?

2. **Payment timing**: When does payment happen?
   - Pre-pay before request (estimate tokens)? ✅ **Selected** (with retry credit)
   - Post-pay after response (actual tokens)?
   - Hybrid with deposits?

3. **Payment token**: What token for payments?
   - STX native? ✅ **Selected**
   - aBTC? ✅ **Selected** (as sBTC)
   - USDC on Stacks? ✅ **Selected**

### Agent Identity

4. **Agent identification**: How to identify agents?
   - x402 payment includes agent identity? ✅ **Selected** (Stacks address)
   - Separate API key per agent?
   - ERC-8004 identity registry lookup?

5. **DO routing**: How to route to agent's DO?
   - Hash of agent's Stacks address? ✅ **Selected**
   - Agent ID from x402 payment?
   - API key maps to DO ID?

### API Design

6. **Streaming**: How to handle SSE streaming?
   - Pass through stream with x402 header? ✅ **Selected**
   - Buffer and charge after completion?
   - Different pricing for streaming?

7. **Model selection**: How to handle model routing?
   - Allow any OpenRouter model? ✅ **Selected**
   - Whitelist specific models?
   - Different pricing tiers?

8. **Error handling**: What if OpenRouter fails?
   - Refund x402 payment?
   - Retry with different provider?
   - Partial refund for partial responses?
   - ✅ **Selected**: Credit for retry (stored in DO)

### Operations

9. **Rate limits**: What limits are appropriate?
   - Requests per minute/hour? ✅ **Selected** (RPM)
   - Tokens per day?
   - Concurrent requests?

10. **Cost tracking**: How to track our costs?
    - OpenRouter provides usage stats
    - Store in DO for reconciliation ✅ **Selected**
    - Dashboard for monitoring?

### Future Services

11. **Service extensibility**: How to add more APIs?
    - One DO class per service?
    - Shared base class with service-specific logic? ✅ **Selected**
    - Plugin architecture?

12. **Other APIs to add** (future):
    - Image generation (DALL-E, Midjourney)?
    - Voice/TTS (ElevenLabs)?
    - Search APIs?
    - Database services?

</details>

## Context

### Related Projects

**x402 Infrastructure:**
- `../x402Stacks-sponsor-relay/` - Sponsor relay for gasless transactions

**Best Practice References:**
- `~/dev/absorbingchaos/thundermountainbuilders/` - CF Worker patterns
- `~/dev/whoabuddy/worker-logs/` - Universal logging with DOs

**aibtcdev Resources:**
- `../erc-8004-stacks/` - Agent identity contracts
- `../aibtcdev-cache/` - CF Worker with Durable Objects pattern

## Implementation Status

### Completed
1. ~~Implement basic OpenRouter proxy~~ ✅
2. ~~Add usage tracking in DO~~ ✅
3. ~~Integrate x402 payment verification~~ ✅
4. ~~Add streaming support with usage tracking~~ ✅
5. ~~Add service subfolder structure (`/openrouter`)~~ ✅

### Remaining
1. **Rate limiting** - RPM per agent
2. **Credit/retry system** - Store credit for upstream failures
3. **Signature auth for /usage** - Prove wallet ownership
4. **Additional services** - Image generation, TTS, etc.

## Resources

### OpenRouter
- [API Reference](https://openrouter.ai/docs/api/reference/overview)
- [Quickstart](https://openrouter.ai/docs/quickstart)
- [TypeScript SDK](https://openrouter.ai/docs/sdks/typescript/endpoints)
- [Authentication](https://openrouter.ai/docs/api/reference/authentication)

### x402 Protocol
- [x402 Protocol](https://www.x402.org/)
- [x402 GitHub](https://github.com/coinbase/x402)
- [x402 Documentation](https://docs.cdp.coinbase.com/x402/welcome)

### Cloudflare
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [SQLite in DOs](https://developers.cloudflare.com/durable-objects/api/storage-api/#sql-api)
- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

### Local Resources
- [CF Best Practices - Thunder Mountain](~/dev/absorbingchaos/thundermountainbuilders/)
- [Universal Logger](~/dev/whoabuddy/worker-logs/) - https://logs.wbd.host
- [x402 Sponsor Relay](../x402Stacks-sponsor-relay/)
