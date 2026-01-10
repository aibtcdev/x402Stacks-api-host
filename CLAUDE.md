# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

x402 Stacks API Host - A Cloudflare Worker that exposes third-party APIs on a pay-per-use basis using the x402 protocol. Uses one Durable Object per agent (keyed by Stacks address) for isolated state and usage tracking.

**Status**: MVP complete. OpenRouter integration with x402 payments working.

## Commands

```bash
# Install dependencies
npm install

# Local development
npm run dev

# Type check
npm run check

# Dry-run deploy (verify build)
npm run deploy:dry-run

# DO NOT run npm run deploy - commit and push for automatic deployment
```

## Domains

| Environment | Domain | Network |
|-------------|--------|---------|
| Production | `x402-apis.aibtc.com` | mainnet |
| Staging | `x402-apis.aibtc.dev` | testnet |

## API Endpoints

### Global
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |

### OpenRouter (`/openrouter`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/openrouter/v1/models` | List models |
| POST | `/openrouter/v1/chat/completions` | Chat (x402 paid) |
| GET | `/openrouter/usage` | Usage stats |

## Architecture

**Stack:**
- Cloudflare Workers for deployment
- Hono.js for HTTP routing
- Durable Objects with SQLite for per-agent state
- x402-stacks for payment verification
- worker-logs service binding for centralized logging

**Project Structure:**
```
src/
├── index.ts              # Hono app + OpenRouterDO class
├── types.ts              # TypeScript interfaces
├── middleware/
│   └── x402.ts           # x402 payment verification middleware
├── services/
│   └── openrouter.ts     # OpenRouter API client
└── utils/
    ├── logger.ts         # worker-logs integration
    └── pricing.ts        # Dynamic price estimation
```

## Key Decisions (from REQUIREMENTS.md)

| Area | Decision |
|------|----------|
| **Pricing** | Pass-through OpenRouter cost + 20% margin |
| **Payment timing** | Pre-pay estimate based on model + input tokens |
| **Payment tokens** | STX, sBTC, USDCx (all supported) |
| **Agent ID** | Stacks address from x402 payment |
| **DO routing** | `idFromName(stacksAddress)` |
| **Streaming** | Pass-through SSE, capture usage from final chunk |
| **Models** | All OpenRouter models (dynamic pricing) |

## Durable Objects

**OpenRouterDO** - Per-agent state (one DO per Stacks address):
- Identity storage (agent_id, created_at)
- Usage tracking (tokens, cost per request)
- Daily stats aggregation
- Rate limiting (TODO)

**Best Practices Applied:**
- `blockConcurrencyWhile()` in constructor for schema init
- RPC methods instead of fetch() handler
- SQLite storage (recommended over KV)
- Error handling with try/catch around all operations

## x402 Payment Flow

1. Client POSTs to `/openrouter/v1/chat/completions` without payment
2. Middleware returns 402 with payment requirements (amount, recipient, token type)
3. Client signs transaction and resends with `X-PAYMENT` header
4. Middleware verifies payment via facilitator
5. On success, payer address stored in context, request proceeds
6. Usage recorded in agent's DO, PnL logged

## Configuration

**wrangler.jsonc** - Cloudflare Workers config

**Secrets** (set via `wrangler secret put`):
- `OPENROUTER_API_KEY` - API key for OpenRouter

**Environment Variables:**
- `X402_SERVER_ADDRESS` - Stacks address to receive payments
- `X402_NETWORK` - `mainnet` or `testnet`
- `X402_FACILITATOR_URL` - x402 facilitator endpoint

## Service Bindings

**LOGS** - Universal logging service (RPC binding to worker-logs)
```typescript
const log = getLogger(c);
log.info("Request proxied", { model, tokens });
log.error("OpenRouter error", { error });
```

## Important: Consult Documentation

**ALWAYS check official docs before implementing features:**

### Cloudflare Workers & Durable Objects
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [SQLite in DOs](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

### OpenRouter API
- [API Reference](https://openrouter.ai/docs/api/reference/overview)
- [Streaming](https://openrouter.ai/docs/api/reference/streaming)
- [Usage Accounting](https://openrouter.ai/docs/use-cases/usage-accounting)

### x402 Protocol
- [x402 Protocol](https://www.x402.org/)
- [x402-stacks npm](https://www.npmjs.com/package/x402-stacks)

## Related Projects

**x402 Infrastructure:**
- `../x402Stacks-sponsor-relay/` - Sponsor relay for gasless transactions

**References:**
- `~/dev/whoabuddy/worker-logs/` - Universal logging with DOs
