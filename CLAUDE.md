# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

x402 Stacks API Host - A Cloudflare Worker that exposes third-party APIs on a pay-per-use basis using the x402 protocol. Uses one Durable Object per agent (keyed by Stacks address) for isolated state and usage tracking.

**Status**: Core infrastructure complete. Implementing OpenRouter proxy.

**MVP Target**: OpenRouter chat completions + /v1/models endpoint with x402 payments.

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

## Architecture

**Stack:**
- Cloudflare Workers for deployment
- Hono.js for HTTP routing
- Durable Objects with SQLite for per-agent state
- OpenAI SDK (OpenRouter-compatible) for LLM calls
- worker-logs service binding for centralized logging

**Endpoints:**
- `/` - Service info
- `/health` - Health check
- `/v1/chat/completions` - OpenRouter proxy (x402 paid)
- `/v1/models` - List available models
- `/usage` - Agent's usage stats

**Project Structure:**
```
src/
├── index.ts           # Hono app + OpenRouterDO class
├── types.ts           # TypeScript interfaces
└── utils/
    └── logger.ts      # worker-logs integration
# Planned:
├── services/
│   └── openrouter.ts  # OpenRouter proxy logic
└── middleware/
    └── x402.ts        # x402 payment verification
```

## Key Decisions (from REQUIREMENTS.md)

| Area | Decision |
|------|----------|
| **Pricing** | Pass-through OpenRouter cost + 20% margin |
| **Payment timing** | Pre-pay estimate, credit for retry on failure |
| **Payment tokens** | STX, sBTC, USDC (all supported) |
| **Agent ID** | Stacks address from x402 payment |
| **DO routing** | `idFromName(stacksAddress)` |
| **Streaming** | Pass-through SSE with tight logging |
| **Models** | All OpenRouter models (dynamic pricing) |
| **Rate limits** | Requests per minute (RPM) |
| **Extensibility** | Base class + service extensions |

## Durable Objects

**OpenRouterDO** - Per-agent state (one DO per Stacks address):
- Identity storage (agent_id, created_at)
- Usage tracking (tokens, cost per request)
- Daily stats aggregation
- Rate limiting (TODO)
- Retry credits (TODO)

**Best Practices Applied:**
- `blockConcurrencyWhile()` in constructor for schema init
- RPC methods instead of fetch() handler
- SQLite storage (recommended over KV)
- Error handling with try/catch around all operations

## Configuration

- `wrangler.jsonc` - Cloudflare Workers config (DOs, service bindings, routes)
- Secrets set via `wrangler secret put`:
  - `OPENROUTER_API_KEY` - API key for OpenRouter

## Service Bindings

**LOGS** - Universal logging service (RPC binding to worker-logs)
```typescript
// Via logger utility
const log = getLogger(c);
log.info("Request proxied", { model, tokens });
log.error("OpenRouter error", { error });
```

## Important: Consult Documentation

**ALWAYS check official docs before implementing features:**

### Cloudflare Workers & Durable Objects
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) - **MUST READ** for DO patterns
- [SQLite in DOs](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)

### OpenRouter API
- [API Reference](https://openrouter.ai/docs/api/reference/overview)
- [Chat Completions](https://openrouter.ai/docs/quickstart)
- [Authentication](https://openrouter.ai/docs/api/reference/authentication)
- [Streaming](https://openrouter.ai/docs/api/reference/overview#streaming)
- [Generation Stats](https://openrouter.ai/docs/api-reference/generation-stats)

### x402 Protocol
- [x402 Protocol](https://www.x402.org/)
- [x402 Documentation](https://docs.cdp.coinbase.com/x402/welcome)
- [x402 GitHub](https://github.com/coinbase/x402)

## Best Practices Checklist

When implementing new features, verify:

- [ ] **Consulted official docs** for the API/service being used
- [ ] **Error handling** - try/catch around external calls, log errors
- [ ] **Type safety** - proper TypeScript types, no `any`
- [ ] **DO patterns** - RPC methods, blockConcurrencyWhile for init, no global singleton
- [ ] **Logging** - use `getLogger(c)` for request-correlated logs
- [ ] **Non-blocking** - use `ctx.waitUntil()` for background work
- [ ] **Security** - validate inputs, sanitize outputs, no secrets in logs

## Related Projects

**x402 Infrastructure:**
- `../x402Stacks-sponsor-relay/` - Sponsor relay for gasless transactions

**Best Practice References:**
- `~/dev/whoabuddy/worker-logs/` - Universal logging with DOs
- `~/dev/whoabuddy/stx402/` - Example x402 implementation with DOs

**aibtcdev Resources:**
- `../erc-8004-stacks/` - Agent identity contracts
- `../aibtcdev-cache/` - CF Worker with Durable Objects pattern

## Wrangler Setup

Wrangler commands need environment variables from `.env`:

```bash
npm run wrangler -- <command>
```

### Secrets

Set via `wrangler secret put`:
- `OPENROUTER_API_KEY` - OpenRouter API key

## Development Notes

- Follow existing aibtcdev patterns for Cloudflare Workers
- Use `wrangler.jsonc` format with comments (not .toml)
- Base DO class pattern for extensibility (future: ImageGenDO, etc.)
- Use SQLite in DOs for usage tracking (`new_sqlite_classes` in migrations)
- Integrate worker-logs early for debugging
- OpenRouter uses OpenAI-compatible API format
- Always run `npm run check` before committing
