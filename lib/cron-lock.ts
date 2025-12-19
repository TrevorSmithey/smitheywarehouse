/**
 * Cron Job Locking Utility
 *
 * Prevents duplicate cron job runs using PostgreSQL advisory locks.
 * If a job is already running, subsequent invocations will be rejected.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// Lock names for each cron job
export const CRON_LOCKS = {
  SYNC_NETSUITE_CUSTOMERS: "cron_sync_netsuite_customers",
  SYNC_NETSUITE_TRANSACTIONS: "cron_sync_netsuite_transactions",
  SYNC_NETSUITE_LINEITEMS: "cron_sync_netsuite_lineitems",
  SYNC_B2B: "cron_sync_b2b",
  SYNC_B2B_DRAFTS: "cron_sync_b2b_drafts",
  SYNC_INVENTORY: "cron_sync_inventory",
  SYNC_KLAVIYO: "cron_sync_klaviyo",
  SYNC_REAMAZE: "cron_sync_reamaze",
  SYNC_SHOPIFY_STATS: "cron_sync_shopify_stats",
  SYNC_SHOPIFY_CUSTOMERS: "cron_sync_shopify_customers",
  SYNC_ABANDONED_CHECKOUTS: "cron_sync_abandoned_checkouts",
} as const;

export type CronLockName = (typeof CRON_LOCKS)[keyof typeof CRON_LOCKS];

export interface CronLockResult {
  acquired: boolean;
  error?: string;
}

/**
 * Attempt to acquire an advisory lock for a cron job.
 * Returns an object with `acquired: true` if lock acquired.
 *
 * @param supabase - Supabase client
 * @param lockName - Unique name for this cron job
 * @returns { acquired: boolean, error?: string }
 */
export async function acquireCronLock(
  supabase: SupabaseClient,
  lockName: CronLockName | string
): Promise<CronLockResult> {
  try {
    const { data, error } = await supabase.rpc("acquire_cron_lock", {
      lock_name: lockName,
    });

    if (error) {
      console.error(`[CRON LOCK] Failed to acquire lock ${lockName}:`, error);
      // On error, assume we can't get the lock (fail safe)
      return { acquired: false, error: error.message };
    }

    const acquired = data === true;
    if (acquired) {
      console.log(`[CRON LOCK] Acquired lock: ${lockName}`);
    } else {
      console.warn(`[CRON LOCK] Lock busy: ${lockName}`);
    }

    return { acquired };
  } catch (err) {
    console.error(`[CRON LOCK] Exception acquiring lock ${lockName}:`, err);
    return { acquired: false, error: String(err) };
  }
}

/**
 * Release an advisory lock for a cron job.
 * Should be called in a finally block to ensure cleanup.
 *
 * @param supabase - Supabase client
 * @param lockName - Unique name for this cron job
 */
export async function releaseCronLock(
  supabase: SupabaseClient,
  lockName: CronLockName | string
): Promise<void> {
  try {
    const { error } = await supabase.rpc("release_cron_lock", {
      lock_name: lockName,
    });

    if (error) {
      console.error(`[CRON LOCK] Failed to release lock ${lockName}:`, error);
    } else {
      console.log(`[CRON LOCK] Released lock: ${lockName}`);
    }
  } catch (err) {
    console.error(`[CRON LOCK] Exception releasing lock ${lockName}:`, err);
  }
}

/**
 * Higher-order function that wraps a cron job handler with locking.
 * Automatically acquires lock before running and releases after.
 *
 * @param lockName - Unique name for this cron job
 * @param handler - The actual cron job logic
 * @returns Wrapped handler with locking
 */
export function withCronLock<T>(
  lockName: CronLockName | string,
  handler: (supabase: SupabaseClient) => Promise<T>
): (supabase: SupabaseClient) => Promise<{ success: boolean; data?: T; error?: string }> {
  return async (supabase: SupabaseClient) => {
    const lockResult = await acquireCronLock(supabase, lockName);

    if (!lockResult.acquired) {
      console.warn(`[CRON LOCK] ${lockName} is already running - skipping this invocation`);
      return {
        success: false,
        error: lockResult.error || "Another instance is already running",
      };
    }

    try {
      const result = await handler(supabase);
      return { success: true, data: result };
    } finally {
      await releaseCronLock(supabase, lockName);
    }
  };
}
