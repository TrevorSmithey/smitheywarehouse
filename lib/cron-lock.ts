/**
 * Cron Job Locking Utility
 *
 * Prevents duplicate concurrent runs of cron jobs using PostgreSQL advisory locks.
 * Locks are automatically released when the database connection closes, providing
 * safety even if the job crashes without calling release.
 *
 * Usage:
 *   const lock = await acquireCronLock(supabase, 'sync-netsuite-customers');
 *   if (!lock.acquired) {
 *     return NextResponse.json({ error: 'Another sync in progress' }, { status: 409 });
 *   }
 *   try {
 *     // ... do sync work ...
 *   } finally {
 *     await releaseCronLock(supabase, 'sync-netsuite-customers');
 *   }
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface LockResult {
  acquired: boolean;
  error?: string;
}

/**
 * Attempt to acquire an advisory lock for a cron job.
 * Non-blocking - returns immediately if lock is held by another process.
 *
 * @param supabase - Supabase client with service role
 * @param lockName - Unique identifier for the cron job (e.g., 'sync-netsuite-customers')
 * @returns LockResult with acquired=true if lock obtained
 */
export async function acquireCronLock(
  supabase: SupabaseClient,
  lockName: string
): Promise<LockResult> {
  try {
    const { data, error } = await supabase.rpc("acquire_sync_lock", {
      lock_name: lockName,
    });

    if (error) {
      console.error(`[CRON LOCK] Failed to acquire lock '${lockName}':`, error.message);
      // If RPC doesn't exist yet, allow the job to run (graceful degradation)
      if (error.message.includes("function") && error.message.includes("does not exist")) {
        console.warn(`[CRON LOCK] Lock function not deployed yet - allowing job to proceed`);
        return { acquired: true };
      }
      return { acquired: false, error: error.message };
    }

    if (data === true) {
      console.log(`[CRON LOCK] Acquired lock '${lockName}'`);
      return { acquired: true };
    } else {
      console.warn(`[CRON LOCK] Lock '${lockName}' already held by another process`);
      return { acquired: false, error: "Lock held by another process" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CRON LOCK] Exception acquiring lock '${lockName}':`, message);
    // On unexpected errors, allow job to proceed (fail open for availability)
    return { acquired: true };
  }
}

/**
 * Release an advisory lock for a cron job.
 * Should always be called in a finally block.
 *
 * @param supabase - Supabase client with service role
 * @param lockName - Same identifier used when acquiring
 */
export async function releaseCronLock(
  supabase: SupabaseClient,
  lockName: string
): Promise<void> {
  try {
    const { error } = await supabase.rpc("release_sync_lock", {
      lock_name: lockName,
    });

    if (error) {
      // Log but don't throw - lock will auto-release on connection close
      console.error(`[CRON LOCK] Failed to release lock '${lockName}':`, error.message);
    } else {
      console.log(`[CRON LOCK] Released lock '${lockName}'`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CRON LOCK] Exception releasing lock '${lockName}':`, message);
  }
}

/**
 * Higher-order function that wraps a cron job handler with lock acquisition/release.
 * Provides cleaner syntax for protecting cron jobs.
 *
 * Usage:
 *   export const GET = withCronLock('sync-netsuite-customers', async (request, supabase) => {
 *     // ... sync logic ...
 *     return NextResponse.json({ success: true });
 *   });
 */
export function withCronLock(
  lockName: string,
  handler: (request: Request, supabase: SupabaseClient) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    // Import here to avoid circular dependencies
    const { createServiceClient } = await import("@/lib/supabase/server");
    const { verifyCronSecret, unauthorizedResponse } = await import("@/lib/cron-auth");
    const { NextResponse } = await import("next/server");

    // Verify cron auth first
    if (!verifyCronSecret(request)) {
      return unauthorizedResponse();
    }

    const supabase = createServiceClient();

    // Try to acquire lock
    const lock = await acquireCronLock(supabase, lockName);
    if (!lock.acquired) {
      return NextResponse.json(
        {
          success: false,
          error: "Another sync is already in progress",
          lockName,
        },
        { status: 409 }
      );
    }

    try {
      // Run the actual handler
      return await handler(request, supabase);
    } finally {
      // Always release the lock
      await releaseCronLock(supabase, lockName);
    }
  };
}
