/**
 * StaleTimestamp - Visual urgency indicator for data freshness
 *
 * Shows sync timestamp with color-coded urgency:
 * - Fresh (< 4 hours): muted grey - no concern
 * - Getting stale (4-24 hours): amber warning - check on it
 * - Stale (> 24 hours): red alert with icon - data may be wrong
 *
 * Usage:
 *   <StaleTimestamp date={data.lastSynced} />
 *   <StaleTimestamp date={data.lastSynced} prefix="Updated" />
 */

"use client";

import { AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
  if (!date) return null;

  const syncDate = new Date(date);
  const hoursSinceSync = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60);
  const isStale = hoursSinceSync > staleThreshold;
  const isWarning = hoursSinceSync > warningThreshold && hoursSinceSync <= staleThreshold;

  const colorClass = isStale
    ? "text-status-bad"
    : isWarning
    ? "text-status-warning"
    : "text-text-muted";

  return (
    <span className={`text-[10px] flex items-center gap-1 ${colorClass} ${className}`}>
      {isStale && <AlertTriangle className="w-3 h-3" />}
      {prefix} {formatDistanceToNow(syncDate, { addSuffix: true })}
    </span>
  );
}
