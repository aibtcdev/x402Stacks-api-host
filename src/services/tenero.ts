/**
 * Tenero API Service (formerly STXTools)
 *
 * Client for Tenero API - market data and analytics for Stacks.
 * https://docs.tenero.io/
 */

import type { Logger } from "../types";

// =============================================================================
// Constants
// =============================================================================

const TENERO_API_BASE = "https://api.tenero.io";

// =============================================================================
// Types
// =============================================================================

export interface TokenPrice {
  symbol: string;
  name: string;
  contractId: string;
  priceUsd: number;
  priceStx: number;
  marketCapUsd: number;
  volume24hUsd: number;
  change24h: number;
  change7d: number;
}

export interface WalletHolding {
  contractId: string;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  priceUsd?: number;
  valueUsd?: number;
}

export interface PoolInfo {
  poolId: string;
  dex: string;
  token0: {
    symbol: string;
    contractId: string;
  };
  token1: {
    symbol: string;
    contractId: string;
  };
  reserve0: string;
  reserve1: string;
  tvlUsd: number;
  volume24hUsd: number;
  apr: number;
}

// =============================================================================
// Tenero Client
// =============================================================================

export class TeneroClient {
  private log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  private async fetch<T>(path: string): Promise<T> {
    const url = `${TENERO_API_BASE}${path}`;
    this.log.debug("Tenero API request", { path });

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const error = await response.text();
      this.log.error("Tenero API error", { path, status: response.status, error });
      throw new TeneroError(`Tenero API error: ${response.status}`, response.status);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get token price by symbol or contract ID
   */
  async getTokenPrice(tokenIdOrSymbol: string): Promise<TokenPrice | null> {
    try {
      const data = await this.fetch<{ data: TokenPrice[] }>(`/v1/tokens?q=${encodeURIComponent(tokenIdOrSymbol)}`);
      return data.data?.[0] || null;
    } catch (error) {
      if (error instanceof TeneroError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get top tokens by market cap
   */
  async getTopTokens(limit: number = 20): Promise<TokenPrice[]> {
    const data = await this.fetch<{ data: TokenPrice[] }>(`/v1/tokens?sort=marketCap&order=desc&limit=${limit}`);
    return data.data || [];
  }

  /**
   * Get wallet token holdings with values
   */
  async getWalletHoldings(address: string): Promise<WalletHolding[]> {
    const data = await this.fetch<{ data: WalletHolding[] }>(`/v1/wallets/${address}/holdings`);
    return data.data || [];
  }

  /**
   * Get liquidity pools
   */
  async getPools(options?: { dex?: string; limit?: number }): Promise<PoolInfo[]> {
    let path = `/v1/pools?limit=${options?.limit || 20}`;
    if (options?.dex) {
      path += `&dex=${encodeURIComponent(options.dex)}`;
    }
    const data = await this.fetch<{ data: PoolInfo[] }>(path);
    return data.data || [];
  }

  /**
   * Get STX price
   */
  async getStxPrice(): Promise<{ priceUsd: number; change24h: number }> {
    const data = await this.fetch<{ price: number; change24h: number }>("/v1/stx/price");
    return {
      priceUsd: data.price,
      change24h: data.change24h,
    };
  }
}

// =============================================================================
// Error Class
// =============================================================================

export class TeneroError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TeneroError";
    this.status = status;
  }
}
