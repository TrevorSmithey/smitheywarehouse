import crypto from "crypto";

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
