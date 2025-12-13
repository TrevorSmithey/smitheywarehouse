/**
 * Simple in-memory rate limiter
 *
 * Note: This is a basic implementation for single-instance deployments.
 * For distributed deployments, consider using Redis or Upstash.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limit data
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSec: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetIn: number; // seconds until reset
}

/**
 * Check rate limit for a given key
 * @param key - Unique identifier (e.g., IP address, API key)
 * @param config - Rate limit configuration
 * @returns Result indicating if request is allowed
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // If no entry or expired, create new window
  if (!entry || entry.resetTime < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + config.windowSec * 1000,
    };
    rateLimitStore.set(key, newEntry);
    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      resetIn: config.windowSec,
    };
  }

  // Within window, check count
  if (entry.count >= config.limit) {
    return {
      success: false,
      limit: config.limit,
      remaining: 0,
      resetIn: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  // Increment and allow
  entry.count++;
  return {
    success: true,
    limit: config.limit,
    remaining: config.limit - entry.count,
    resetIn: Math.ceil((entry.resetTime - now) / 1000),
  };
}

/**
 * Create a rate-limited response with appropriate headers
 */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: "Too many requests",
      retryAfter: result.resetIn,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": result.resetIn.toString(),
        "Retry-After": result.resetIn.toString(),
      },
    }
  );
}

/**
 * Add rate limit headers to a response
 */
export function addRateLimitHeaders(response: Response, result: RateLimitResult): Response {
  const headers = new Headers(response.headers);
  headers.set("X-RateLimit-Limit", result.limit.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set("X-RateLimit-Reset", result.resetIn.toString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Default rate limit configs for different endpoint types
export const RATE_LIMITS = {
  // API endpoints - 100 requests per minute per IP
  API: { limit: 100, windowSec: 60 },
  // Public dashboards - more lenient
  DASHBOARD: { limit: 200, windowSec: 60 },
  // Webhooks - high frequency from Shopify
  WEBHOOK: { limit: 500, windowSec: 60 },
} as const;
