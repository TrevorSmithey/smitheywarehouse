"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface SyncStatus {
  type: string;
  status: string;
  lastRun: string;
  recordsExpected: number | null;
  recordsSynced: number | null;
  successRate: number;
  durationMs: number | null;
  hoursSinceSuccess: number | null;
  error: string | null;
  isStale: boolean;
}

interface SyncHealthResponse {
  status: "healthy" | "warning" | "critical";
  syncs: SyncStatus[];
  checkedAt: string;
}

const SYNC_DISPLAY_NAMES: Record<string, string> = {
  inventory: "Inventory",
  b2b: "B2B Orders",
  assembly: "Assembly",
  holiday: "Holiday",
};

export function SyncHealthBanner() {
  const [health, setHealth] = useState<SyncHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/sync-health");
      if (!res.ok) throw new Error("Failed to fetch sync health");
      const data = await res.json();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check sync health");
    }
  }, []);

  // Fetch on mount and every 5 minutes
  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // No data yet - show nothing
  if (!health && !error) return null;

  // Error fetching health - show subtle warning
  if (error) {
    return (
      <div className="mb-4 px-4 py-2 bg-status-warning/10 border border-status-warning/30 rounded-lg flex items-center gap-2 text-sm">
        <AlertTriangle className="w-4 h-4 text-status-warning flex-shrink-0" />
        <span className="text-status-warning">Unable to check data sync health</span>
      </div>
    );
  }

  if (!health) return null;

  // Everything healthy and we have syncs - show subtle green indicator
  if (health.status === "healthy" && health.syncs.length > 0) {
    return (
      <div className="mb-4 flex items-center gap-2 text-xs text-text-muted">
        <CheckCircle className="w-3.5 h-3.5 text-status-good" />
        <span>All data syncs healthy</span>
        <span className="text-text-muted/60">
          (last: {health.syncs.length > 0 && health.syncs[0].lastRun
            ? formatDistanceToNow(new Date(health.syncs[0].lastRun), { addSuffix: true })
            : "unknown"})
        </span>
      </div>
    );
  }

  // No syncs recorded yet
  if (health.syncs.length === 0) {
    return (
      <div className="mb-4 px-4 py-2 bg-status-warning/10 border border-status-warning/30 rounded-lg flex items-center gap-2 text-sm">
        <Clock className="w-4 h-4 text-status-warning flex-shrink-0" />
        <span className="text-status-warning">No sync history yet - data freshness unknown</span>
      </div>
    );
  }

  // Problems detected - show prominent banner
  const failedSyncs = health.syncs.filter((s) => s.status === "failed");
  const staleSyncs = health.syncs.filter((s) => s.isStale);
  const partialSyncs = health.syncs.filter((s) => s.status === "partial");

  const isCritical = health.status === "critical";
  const bgColor = isCritical ? "bg-status-bad/10" : "bg-status-warning/10";
  const borderColor = isCritical ? "border-status-bad/30" : "border-status-warning/30";
  const textColor = isCritical ? "text-status-bad" : "text-status-warning";
  const Icon = isCritical ? XCircle : AlertTriangle;

  // Build summary message
  const issues: string[] = [];
  if (failedSyncs.length > 0) {
    issues.push(`${failedSyncs.length} sync${failedSyncs.length > 1 ? "s" : ""} failed`);
  }
  if (staleSyncs.length > 0) {
    issues.push(`${staleSyncs.length} sync${staleSyncs.length > 1 ? "s" : ""} stale (>24h)`);
  }
  if (partialSyncs.length > 0) {
    issues.push(`${partialSyncs.length} partial sync${partialSyncs.length > 1 ? "s" : ""}`);
  }

  return (
    <div className={`mb-4 ${bgColor} border ${borderColor} rounded-lg overflow-hidden`}>
      {/* Main banner - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${textColor} flex-shrink-0`} />
          <div className="text-left">
            <span className={`font-medium ${textColor}`}>
              Data Sync Issues: {issues.join(", ")}
            </span>
            <span className="text-text-muted text-sm ml-2">
              Dashboard data may be stale or incorrect
            </span>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/30">
          <div className="mt-3 space-y-2">
            {health.syncs.map((sync) => {
              const statusIcon =
                sync.status === "success" ? (
                  <CheckCircle className="w-4 h-4 text-status-good" />
                ) : sync.status === "failed" ? (
                  <XCircle className="w-4 h-4 text-status-bad" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-status-warning" />
                );

              return (
                <div
                  key={sync.type}
                  className="flex items-center justify-between py-2 px-3 bg-bg-secondary/50 rounded"
                >
                  <div className="flex items-center gap-3">
                    {statusIcon}
                    <span className="font-medium text-text-primary">
                      {SYNC_DISPLAY_NAMES[sync.type] || sync.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {sync.recordsSynced !== null && sync.recordsExpected !== null && (
                      <span className="text-text-muted">
                        {sync.recordsSynced.toLocaleString()} / {sync.recordsExpected.toLocaleString()} records
                      </span>
                    )}
                    {sync.lastRun && (
                      <span className={sync.isStale ? "text-status-warning" : "text-text-muted"}>
                        {formatDistanceToNow(new Date(sync.lastRun), { addSuffix: true })}
                      </span>
                    )}
                    {sync.error && (
                      <span className="text-status-bad text-xs max-w-[200px] truncate" title={sync.error}>
                        {sync.error}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
