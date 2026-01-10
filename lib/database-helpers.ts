/**
 * Shared database helper utilities
 *
 * Consolidates common query patterns used across webhooks and sync jobs.
 */

import { createServiceClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServiceClient>;

export interface OrderLookupResult {
  id: number;
  isPOS: boolean;
}

/**
 * Look up a single order by order number (e.g., "S371909")
 *
 * Used by AfterShip webhooks to link returns to orders.
 * AfterShip sends order_number in same format as Shopify's order_name.
 */
export async function lookupOrderByNumber(
  supabase: SupabaseClient,
  orderNumber: string
): Promise<OrderLookupResult | null> {
  const { data } = await supabase
    .from("orders")
    .select("id, source_name")
    .eq("order_name", orderNumber)
    .maybeSingle();

  if (!data?.id) return null;

  return {
    id: data.id,
    isPOS: data.source_name === "pos",
  };
}

/**
 * Batch lookup orders by order numbers
 * Returns Map of order_number -> { id, isPOS }
 *
 * Used by AfterShip sync cron for efficient bulk matching.
 * Batches queries to avoid hitting Supabase query size limits.
 */
export async function lookupOrdersByNumber(
  supabase: SupabaseClient,
  orderNumbers: string[]
): Promise<Map<string, number>> {
  const orderMap = new Map<string, number>();
  const BATCH_SIZE = 500;

  for (let i = 0; i < orderNumbers.length; i += BATCH_SIZE) {
    const batch = orderNumbers.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from("orders")
      .select("id, order_name")
      .in("order_name", batch);

    if (error) {
      console.error("[DB HELPERS] Error looking up orders:", error);
      continue;
    }

    for (const order of data || []) {
      orderMap.set(order.order_name, order.id);
    }
  }

  return orderMap;
}

/**
 * Batch lookup order source by order IDs
 * Returns Map of order_id -> isPOS
 *
 * Used to determine if orders are POS (in-store drop-off) or web (shipped).
 */
export async function lookupOrderSourceByIds(
  supabase: SupabaseClient,
  orderIds: number[]
): Promise<Map<number, boolean>> {
  const sourceMap = new Map<number, boolean>();
  const BATCH_SIZE = 500;

  for (let i = 0; i < orderIds.length; i += BATCH_SIZE) {
    const batch = orderIds.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from("orders")
      .select("id, source_name")
      .in("id", batch);

    if (error) {
      console.error("[DB HELPERS] Error looking up order sources:", error);
      continue;
    }

    for (const order of data || []) {
      sourceMap.set(order.id, order.source_name === "pos");
    }
  }

  return sourceMap;
}

/**
 * Extract error message from unknown error types
 *
 * Handles:
 * - Error instances
 * - PostgrestError (has message property but not instanceof Error)
 * - String errors
 * - Other objects
 */
export function extractErrorMessage(error: unknown): string {
  // Handle Error instances
  if (error instanceof Error) {
    return error.message;
  }

  // Handle objects with message property (PostgrestError, etc.)
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  // Handle string errors
  if (typeof error === "string") {
    return error;
  }

  // Fallback: try to stringify
  try {
    const stringified = JSON.stringify(error);
    return stringified || "Unknown error";
  } catch {
    return "Unknown error";
  }
}
