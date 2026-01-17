/**
 * StaleTimestamp - Visual urgency indicator for data freshness (Admin-only)
 *
 * Shows sync timestamp with color-coded urgency:
 * - Fresh (< 4 hours): muted grey - no concern
 * - Getting stale (4-24 hours): amber warning - check on it
 * - Stale (> 24 hours): red alert with icon - data may be wrong
 *
 * Only visible to admin users - regular users don't need to see sync timestamps.
 *
 * Usage:
 *   <StaleTimestamp date={data.lastSynced} />
 *   <StaleTimestamp date={data.lastSynced} prefix="Updated" />
 */

"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";

interface StaleTimestampProps {
  date: string | Date | null | undefined;
  /** Prefix before the timestamp (default: "Synced") */
  prefix?: string;
  /** Hours until warning state (default: 4) */
  warningThreshold?: number;
  /** Hours until stale/error state (default: 24) */
  staleThreshold?: number;
  /** Additional CSS classes */
  className?: string;
}

export function StaleTimestamp({
  date,
  prefix = "Synced",
  warningThreshold = 4,
  staleThreshold = 24,
  className = "",
}: StaleTimestampProps) {
  const { isAdmin } = useAuth();

  // Compute staleness state - memoized to avoid calling Date.now() on every render
  const { syncDate, isStale, isWarning, colorClass } = useMemo(() => {
    if (!date) {
      return { syncDate: null, isStale: false, isWarning: false, colorClass: "text-text-muted" };
    }
    const sd = new Date(date);
    const hoursSinceSync = (Date.now() - sd.getTime()) / (1000 * 60 * 60);
    const stale = hoursSinceSync > staleThreshold;
    const warning = hoursSinceSync > warningThreshold && hoursSinceSync <= staleThreshold;
    const color = stale
      ? "text-status-bad"
      : warning
      ? "text-status-warning"
      : "text-text-muted";
    return { syncDate: sd, isStale: stale, isWarning: warning, colorClass: color };
  }, [date, staleThreshold, warningThreshold]);

  // Only visible to admins
  if (!isAdmin) return null;

  if (!syncDate) return null;

  return (
    <span className={`text-[10px] flex items-center gap-1 ${colorClass} ${className}`}>
      {isStale && <AlertTriangle className="w-3 h-3" />}
      {prefix} {formatDistanceToNow(syncDate, { addSuffix: true })}
    </span>
  );
}
