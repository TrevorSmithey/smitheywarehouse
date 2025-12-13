import crypto from "crypto";

/**
 * Shopify API version - use latest stable version for consistency
 * Both D2C and B2B stores should use the same version
 * @see https://shopify.dev/docs/api/admin-rest
 */
export const SHOPIFY_API_VERSION = "2024-10";

/**
 * Verify Shopify webhook HMAC signature
 */
export function verifyShopifyWebhook(
  body: string,
  signature: string | null
): boolean {
  if (!signature || !process.env.SHOPIFY_WEBHOOK_SECRET) {
    return false;
  }

  const hmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body, "utf8")
    .digest("base64");

  // Check buffer lengths match to prevent timingSafeEqual from throwing
  const hmacBuffer = Buffer.from(hmac);
  const signatureBuffer = Buffer.from(signature);
  if (hmacBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hmacBuffer, signatureBuffer);
}

/**
 * Extract warehouse tag from Shopify order tags
 * Tags are comma-separated string: "tag1, tag2, smithey, tag3"
 */
export function extractWarehouse(tags: string | null): string | null {
  if (!tags) return null;

  const tagList = tags.toLowerCase().split(",").map((t) => t.trim());

  if (tagList.includes("smithey")) return "smithey";
  if (tagList.includes("selery")) return "selery";

  return null;
}

/**
 * Calculate fulfilled_at timestamp from fulfillments array
 * Returns the most recent fulfillment date if fully fulfilled
 */
export function calculateFulfilledAt(
  fulfillmentStatus: string | null,
  fulfillments: Array<{ created_at: string }> | undefined
): string | null {
  if (fulfillmentStatus !== "fulfilled" || !fulfillments?.length) {
    return null;
  }

  // Get the most recent fulfillment date
  const dates = fulfillments.map((f) => new Date(f.created_at).getTime());
  const mostRecent = Math.max(...dates);

  return new Date(mostRecent).toISOString();
}

/**
 * Retry configuration for Shopify API calls
 */
export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

/**
 * Execute a function with exponential backoff retry
 * Specifically handles Shopify rate limits (429) and transient errors (5xx)
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param context - Optional context for logging
 * @returns The result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
  context?: string
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if this is a retryable error
      const isRetryable = isRetryableError(lastError);

      if (!isRetryable || attempt === maxRetries) {
        // Log final failure
        console.error(
          `[SHOPIFY RETRY] ${context || "Request"} failed after ${attempt + 1} attempt(s): ${lastError.message}`
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      // Check for Retry-After header hint
      const retryAfter = extractRetryAfter(lastError);
      const actualDelay = retryAfter ? Math.max(retryAfter * 1000, delay) : delay;

      console.warn(
        `[SHOPIFY RETRY] ${context || "Request"} attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}. ` +
        `Retrying in ${Math.round(actualDelay / 1000)}s...`
      );

      await sleep(actualDelay);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error("Unknown retry error");
}

/**
 * Check if an error is retryable (rate limit or transient server error)
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Rate limited (429)
  if (message.includes("429") || message.includes("too many requests") || message.includes("rate limit")) {
    return true;
  }

  // Transient server errors (5xx)
  if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
    return true;
  }

  // Network errors
  if (message.includes("network") || message.includes("timeout") || message.includes("econnreset")) {
    return true;
  }

  return false;
}

/**
 * Extract Retry-After value from error message (seconds)
 */
function extractRetryAfter(error: Error): number | null {
  // Check for "Retry-After: X" pattern in error message
  const match = error.message.match(/retry-after:\s*(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
