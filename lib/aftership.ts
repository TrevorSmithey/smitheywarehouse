/**
 * Aftership Returns API Client
 * Fetches return label and shipment tracking data for restoration orders
 *
 * API Documentation: https://www.aftership.com/docs/returns/quickstart/api-quick-start
 *
 * Key concepts:
 * - Returns have shipments (with tracking numbers and status)
 * - Returns link to Shopify orders via order.order_number
 * - Tracking status progresses: null → InfoReceived → InTransit → Delivered
 * - Receivings track when items are marked as received in Aftership
 *
 * Webhook events we care about:
 * - return.shipment.provided: Label generated with tracking number
 * - return.shipment.updated: Tracking status changed (per-shipment)
 */

import crypto from "crypto";

const AFTERSHIP_API_BASE = "https://api.aftership.com/returns";
const AFTERSHIP_API_VERSION = "2024-10";

// ============================================================
// Types
// ============================================================

export interface AftershipReturn {
  id: string;
  rma_number: string;
  approval_status: string;
  approved_at: string | null;
  resolved_at: string | null;
  expired_at: string | null;
  created_at: string;
  order: AftershipOrder;
  return_items: AftershipReturnItem[];
  shipments: AftershipShipment[];
  receivings: AftershipReceiving[];
}

export interface AftershipOrder {
  external_id: string;
  order_number: string;
  order_name: string;
  customer: {
    emails: string[];
  };
  country: string;
  store: {
    platform: string;
    external_id: string;
  };
  placed_at: string;
}

export interface AftershipReturnItem {
  id: string;
  external_order_item_id: string;
  sku: string;
  product_title: string;
  variant_title: string;
  return_reason: string;
  return_subreason: string;
  return_quantity: number;
  received_quantity: number;
}

export interface AftershipShipment {
  id: string;
  tracking_number: string;
  tracking_status: string | null;
  tracking_status_updated_at: string | null; // ISO timestamp when carrier status changed (e.g., delivery date)
  slug: string; // carrier slug (fedex, ups, etc.)
  label: {
    url: string;
    aftership_shipping_slug: string;
    slug: string;
    total_charge: {
      amount: string;
      currency: string;
    };
  } | null;
  source: string;
  created_at?: string; // When shipment was created in AfterShip
}

export interface AftershipReceiving {
  id: string;
  received_at: string;
  items: Array<{
    external_order_item_id: string;
    quantity: number;
  }>;
}

interface AftershipApiResponse<T> {
  meta: {
    code: number;
    type: string;
    message: string;
  };
  data: T;
}

interface AftershipListResponse<T> {
  meta: {
    code: number;
    type: string;
    message: string;
  };
  data: T[];
  pagination?: {
    cursor?: string;
    has_next_page?: boolean;
  };
}

// ============================================================
// Parsed types for database insertion
// ============================================================

export interface ParsedAftershipReturn {
  aftership_return_id: string;
  rma_number: string;
  shopify_order_number: string;
  shopify_order_id: string;
  customer_email: string | null;
  approval_status: string;
  approved_at: string | null;
  resolved_at: string | null;
  created_at: string;

  // Return shipment (inbound to warehouse)
  return_tracking_number: string | null;
  return_carrier: string | null;
  return_tracking_status: string | null;
  label_sent_at: string | null;

  // Return item info
  sku: string | null;
  product_title: string | null;
  return_reason: string | null;

  // Receiving status
  is_received_in_aftership: boolean;
  received_at: string | null;
}

// ============================================================
// Webhook Types
// ============================================================

export interface AftershipWebhookPayload {
  event: string;
  is_test: boolean;
  data: AftershipReturn;
}

export type AftershipWebhookEvent =
  | "return.submitted"
  | "return.approved"
  | "return.rejected"
  | "return.expired"
  | "return.resolved"
  | "return.shipment.provided"
  | "return.shipment.updated"
  | "return.shipment.recorded"
  | "return.received";

// ============================================================
// Client Configuration
// ============================================================

interface AftershipClientConfig {
  apiKey: string;
}

// ============================================================
// Client
// ============================================================

export class AftershipClient {
  private apiKey: string;

  constructor(config: AftershipClientConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Make authenticated request to Aftership API with retry on rate limit
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 3
  ): Promise<T> {
    const url = `${AFTERSHIP_API_BASE}/${AFTERSHIP_API_VERSION}${endpoint}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      console.log(
        `[AFTERSHIP] Request: ${endpoint}${attempt > 0 ? ` (retry ${attempt})` : ""}`
      );

      const response = await fetch(url, {
        ...options,
        headers: {
          "as-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options.headers,
        },
      });

      // Handle rate limiting
      if (response.status === 429 && attempt < retries) {
        const retryAfter = response.headers.get("Retry-After");
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 30 * Math.pow(2, attempt);

        console.log(`[AFTERSHIP] Rate limited, waiting ${waitSeconds}s before retry...`);
        await new Promise((r) => setTimeout(r, waitSeconds * 1000));
        continue;
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Aftership API error ${response.status}: ${errorText}`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.meta?.message) {
            errorMessage = `Aftership API error ${response.status}: ${errorJson.meta.message}`;
          }
        } catch {
          // Use original error text
        }

        throw new Error(errorMessage);
      }

      return response.json();
    }

    throw new Error(`Aftership API request failed after ${retries} retries`);
  }

  /**
   * Get all returns from Aftership with pagination
   * @param options - Filter options
   */
  async getReturns(options: {
    limit?: number;
    cursor?: string;
    createdAtMin?: string;
    createdAtMax?: string;
  } = {}): Promise<{ returns: AftershipReturn[]; nextCursor: string | null }> {
    const params = new URLSearchParams();

    if (options.limit) params.set("limit", options.limit.toString());
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.createdAtMin) params.set("created_at_min", options.createdAtMin);
    if (options.createdAtMax) params.set("created_at_max", options.createdAtMax);

    const queryString = params.toString();
    const endpoint = `/returns${queryString ? `?${queryString}` : ""}`;

    const response = await this.request<AftershipListResponse<AftershipReturn>>(endpoint);

    return {
      returns: response.data || [],
      nextCursor: response.pagination?.has_next_page ? response.pagination.cursor || null : null,
    };
  }

  /**
   * Get all returns (paginating automatically using date-based pagination)
   * Use for initial sync or full resync
   *
   * Aftership Returns API doesn't support cursor or offset pagination,
   * so we use created_at_max to fetch progressively older data.
   */
  async getAllReturns(options: {
    createdAtMin?: string;
    createdAtMax?: string;
    onProgress?: (count: number) => void;
  } = {}): Promise<AftershipReturn[]> {
    const allReturns: AftershipReturn[] = [];
    const seenIds = new Set<string>();
    // Aftership Returns API has a max limit of 50 per page
    const limit = 50;

    // Use date-based pagination - fetch from most recent backwards
    let currentMaxDate = options.createdAtMax || undefined;
    const minDate = options.createdAtMin ? new Date(options.createdAtMin).getTime() : null;

    while (true) {
      const result = await this.getReturns({
        limit,
        createdAtMin: options.createdAtMin,
        createdAtMax: currentMaxDate,
      });

      if (result.returns.length === 0) {
        break;
      }

      // Add returns we haven't seen before
      let newReturnsCount = 0;
      for (const ret of result.returns) {
        if (!seenIds.has(ret.id)) {
          seenIds.add(ret.id);
          allReturns.push(ret);
          newReturnsCount++;
        }
      }

      if (options.onProgress) {
        options.onProgress(allReturns.length);
      }

      // If no new returns, we've likely hit a duplicate page
      if (newReturnsCount === 0) {
        break;
      }

      // Get the oldest return's created_at for next page
      const oldestReturn = result.returns[result.returns.length - 1];
      const oldestDate = new Date(oldestReturn.created_at);

      // If we've gone past the minimum date, stop
      if (minDate && oldestDate.getTime() < minDate) {
        break;
      }

      // Subtract 1 millisecond to avoid fetching the same record
      const nextMaxDate = new Date(oldestDate.getTime() - 1);
      currentMaxDate = nextMaxDate.toISOString();

      // If we got less than limit, we've reached the end
      if (result.returns.length < limit) {
        break;
      }

      // Rate limit buffer
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`[AFTERSHIP] Retrieved ${allReturns.length} total returns`);
    return allReturns;
  }

  /**
   * Get a single return by ID
   */
  async getReturn(returnId: string): Promise<AftershipReturn> {
    const response = await this.request<AftershipApiResponse<AftershipReturn>>(
      `/returns/${returnId}`
    );
    return response.data;
  }

  /**
   * Get a return by RMA number
   */
  async getReturnByRma(rmaNumber: string): Promise<AftershipReturn | null> {
    try {
      const response = await this.request<AftershipApiResponse<AftershipReturn>>(
        `/returns/rma/${rmaNumber}`
      );
      return response.data;
    } catch (error) {
      // Return null if not found
      if (error instanceof Error && error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Parse raw Aftership return into database-ready format
   */
  parseReturn(raw: AftershipReturn): ParsedAftershipReturn {
    // Get primary shipment (usually only one)
    const primaryShipment = raw.shipments?.[0];

    // Get primary return item
    const primaryItem = raw.return_items?.[0];

    // Check if received in Aftership
    const hasReceivings = raw.receivings && raw.receivings.length > 0;
    const receivedAt = hasReceivings ? raw.receivings[0].received_at : null;

    return {
      aftership_return_id: raw.id,
      rma_number: raw.rma_number,
      shopify_order_number: raw.order.order_number,
      shopify_order_id: raw.order.external_id,
      customer_email: raw.order.customer?.emails?.[0] || null,
      approval_status: raw.approval_status,
      approved_at: raw.approved_at,
      resolved_at: raw.resolved_at,
      created_at: raw.created_at,

      // Return shipment tracking
      return_tracking_number: primaryShipment?.tracking_number || null,
      return_carrier: primaryShipment?.slug || null,
      return_tracking_status: primaryShipment?.tracking_status || null,
      label_sent_at: raw.approved_at, // Label is sent when return is approved

      // Return item info
      sku: primaryItem?.sku || null,
      product_title: primaryItem?.product_title || null,
      return_reason: primaryItem?.return_reason || null,

      // Receiving status
      is_received_in_aftership: hasReceivings,
      received_at: receivedAt,
    };
  }

  /**
   * Map Aftership tracking status to our restoration status
   */
  static mapTrackingStatus(
    aftershipStatus: string | null,
    isReceivedInAftership: boolean
  ): string {
    if (isReceivedInAftership) {
      return "delivered_warehouse"; // Aftership marked as received
    }

    switch (aftershipStatus) {
      case null:
        return "label_sent"; // Label created but no tracking yet
      case "InfoReceived":
        return "label_sent"; // Carrier has info, not yet picked up
      case "InTransit":
        return "in_transit_inbound";
      case "OutForDelivery":
        return "in_transit_inbound";
      case "Delivered":
        return "delivered_warehouse";
      case "AvailableForPickup":
        return "delivered_warehouse";
      case "Exception":
        return "in_transit_inbound"; // Keep in transit, flag for attention
      case "AttemptFail":
        return "in_transit_inbound";
      case "Expired":
        return "label_sent"; // Label expired, might need attention
      default:
        return "label_sent";
    }
  }
}

// ============================================================
// Factory
// ============================================================

export function createAftershipClient(): AftershipClient {
  const apiKey = process.env.AFTERSHIP_API_KEY;

  if (!apiKey) {
    throw new Error("Missing Aftership configuration. Required env var: AFTERSHIP_API_KEY");
  }

  return new AftershipClient({ apiKey });
}

// ============================================================
// Webhook Verification
// ============================================================

/**
 * Verify Aftership webhook signature
 * Aftership uses HMAC-SHA256 with the webhook secret
 *
 * @param body - Raw request body string
 * @param signature - Signature from as-signature header
 * @param webhookSecret - Your webhook secret from Aftership
 */
export function verifyAftershipWebhook(
  body: string,
  signature: string | null,
  webhookSecret: string
): boolean {
  if (!signature || !webhookSecret) {
    return false;
  }

  const hmac = crypto
    .createHmac("sha256", webhookSecret)
    .update(body, "utf8")
    .digest("base64");

  // Use timing-safe comparison
  const hmacBuffer = Buffer.from(hmac);
  const signatureBuffer = Buffer.from(signature);

  if (hmacBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hmacBuffer, signatureBuffer);
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get date string for API queries (ISO format)
 */
export function formatDateForApi(date: Date): string {
  return date.toISOString();
}

/**
 * Get date range for syncing recent returns (last N days)
 */
export function getRecentSyncDateRange(days: number): {
  createdAtMin: string;
  createdAtMax: string;
} {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return {
    createdAtMin: formatDateForApi(startDate),
    createdAtMax: formatDateForApi(endDate),
  };
}

/**
 * Check if a return is for a restoration order based on SKU
 * Restoration SKUs contain "-rest-" or "-Rest-"
 */
export function isRestorationReturn(aftershipReturn: AftershipReturn): boolean {
  return aftershipReturn.return_items.some(
    (item) => item.sku && item.sku.toLowerCase().includes("-rest-")
  );
}
