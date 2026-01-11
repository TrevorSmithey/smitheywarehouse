"use client";

import { RefreshCw } from "lucide-react";
import { useAdmin } from "@/app/admin/layout";

// ============================================================================
// HELPER FUNCTIONS & CONSTANTS
// ============================================================================

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatCronSchedule(cron: string | null): string {
  if (!cron) return "—";
  if (cron === "webhook") return "Webhook";

  // Common patterns
  if (cron === "*/15 * * * *") return "Every 15 min";
  if (cron === "*/30 * * * *") return "Every 30 min";
  if (cron === "0 * * * *") return "Hourly";
  if (cron.match(/^0 \*\/(\d+) \* \* \*$/)) {
    const hours = cron.match(/^0 \*\/(\d+) \* \* \*$/)?.[1];
    return `Every ${hours}h`;
  }
  if (cron.match(/^\d+ \d+ \* \* \*$/)) return "Daily";
  if (cron.match(/^\d+ \d+ \* \* 0$/)) return "Weekly";
  if (cron.match(/^\d+ \d+(,\d+)+ \* \* \*$/)) {
    const times = cron.split(" ")[1].split(",").length;
    return `${times}x daily`;
  }

  return cron; // Fallback to raw cron if unrecognized
}

const SYNC_TYPE_LABELS: Record<string, string> = {
  d2c: "D2C Orders",
  b2b: "B2B Orders",
  inventory: "Inventory",
  holiday: "Holiday Data",
  assembly: "Assembly",
  netsuite_customers: "NetSuite Customers",
  netsuite_transactions: "NetSuite Transactions",
  netsuite_lineitems: "NetSuite Line Items",
  klaviyo: "Klaviyo",
  reamaze: "Re:amaze",
  shopify_stats: "Shopify Stats",
};

// ============================================================================
// SYNC HEALTH VIEW COMPONENT
// ============================================================================

export default function SyncHealthView() {
  const {
    syncHealth,
    syncHealthLoading,
    refreshSyncHealth,
  } = useAdmin();

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-medium text-text-primary">Data Sync Health</h2>
          <p className="text-sm text-text-tertiary mt-1">Monitor data pipeline status and freshness</p>
        </div>

        <div className="flex items-center gap-3">
          {syncHealth && (
            <div className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
              ${syncHealth.status === "healthy"
                ? "bg-status-good/10 text-status-good"
                : syncHealth.status === "warning"
                ? "bg-status-warning/10 text-status-warning"
                : "bg-status-bad/10 text-status-bad"
              }
            `}>
              <span className={`w-2 h-2 rounded-full ${
                syncHealth.status === "healthy" ? "bg-status-good" :
                syncHealth.status === "warning" ? "bg-status-warning animate-pulse" :
                "bg-status-bad animate-pulse"
              }`} />
              {syncHealth.status === "healthy" ? "All Systems Healthy" :
               syncHealth.status === "warning" ? "Some Syncs Stale" :
               "Critical Issues"}
            </div>
          )}
          <button
            onClick={() => refreshSyncHealth()}
            className="p-2 rounded-lg text-text-tertiary hover:text-accent-blue hover:bg-accent-blue/10 transition-all"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${syncHealthLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      {syncHealthLoading && !syncHealth ? (
        <div className="flex justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-blue" />
        </div>
      ) : syncHealth ? (
        <div className="bg-bg-secondary rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-tertiary/30">
                  <th className="text-left py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Data Source</th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Status</th>
                  <th className="text-center py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Schedule</th>
                  <th className="text-right py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Records</th>
                  <th className="text-right py-3.5 px-4 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Duration</th>
                  <th className="text-right py-3.5 px-5 text-[11px] uppercase tracking-wider text-text-tertiary font-medium">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {syncHealth.syncs
                  .sort((a, b) => {
                    // Sort: critical first, then warning, then healthy
                    const statusOrder = { failed: 0, partial: 1, success: 2 };
                    const aOrder = a.isStale ? 0.5 : (statusOrder[a.status as keyof typeof statusOrder] ?? 2);
                    const bOrder = b.isStale ? 0.5 : (statusOrder[b.status as keyof typeof statusOrder] ?? 2);
                    return aOrder - bOrder;
                  })
                  .map((sync) => {
                    const isHealthy = sync.status === "success" && !sync.isStale;
                    const isWarning = sync.isStale || sync.status === "partial";
                    const isCritical = sync.status === "failed";

                    return (
                      <tr
                        key={sync.type}
                        className={`
                          transition-all duration-200 hover:bg-white/[0.02]
                          ${isCritical ? "bg-status-bad/5" : isWarning ? "bg-status-warning/5" : ""}
                        `}
                      >
                        {/* Data Source */}
                        <td className="py-4 px-5">
                          <div className="space-y-1">
                            <span className="text-text-primary font-medium">
                              {SYNC_TYPE_LABELS[sync.type] || sync.type}
                            </span>
                            {sync.error && (
                              <p className="text-xs text-status-bad truncate max-w-[300px]" title={sync.error}>
                                {sync.error}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-4 px-4 text-center">
                          <span className={`
                            inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                            ${isCritical
                              ? "bg-status-bad/10 text-status-bad"
                              : isWarning
                              ? "bg-status-warning/10 text-status-warning"
                              : "bg-status-good/10 text-status-good"
                            }
                          `}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              isCritical ? "bg-status-bad" :
                              isWarning ? "bg-status-warning" :
                              "bg-status-good"
                            }`} />
                            {isCritical ? "Failed" : isWarning ? (sync.isStale ? "Stale" : "Partial") : "Healthy"}
                          </span>
                        </td>

                        {/* Schedule */}
                        <td className="py-4 px-4 text-center">
                          <span className="text-xs text-text-secondary" title={sync.schedule || undefined}>
                            {formatCronSchedule(sync.schedule)}
                          </span>
                        </td>

                        {/* Records */}
                        <td className="py-4 px-4 text-right">
                          {sync.recordsSynced !== null ? (
                            <div className="space-y-0.5">
                              <span className="text-sm text-text-primary font-medium">
                                {sync.recordsSynced.toLocaleString()}
                              </span>
                              {sync.recordsExpected !== null && sync.recordsExpected !== sync.recordsSynced && (
                                <div className="text-[10px] text-text-muted">
                                  of {sync.recordsExpected.toLocaleString()}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>

                        {/* Duration */}
                        <td className="py-4 px-4 text-right">
                          {sync.durationMs !== null ? (
                            <span className="text-sm text-text-secondary">
                              {sync.durationMs < 1000
                                ? `${sync.durationMs}ms`
                                : sync.durationMs < 60000
                                ? `${(sync.durationMs / 1000).toFixed(1)}s`
                                : `${Math.floor(sync.durationMs / 60000)}m ${Math.round((sync.durationMs % 60000) / 1000)}s`
                              }
                            </span>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>

                        {/* Last Sync */}
                        <td className="py-4 px-5 text-right">
                          <div className="space-y-0.5">
                            <span className="text-xs text-text-tertiary">
                              {sync.lastRun ? formatRelativeTime(sync.lastRun) : "Never"}
                            </span>
                            {sync.hoursSinceSuccess !== null && sync.hoursSinceSuccess > 0 && (
                              <div className={`text-[10px] ${
                                sync.isStale ? "text-status-warning" : "text-text-muted"
                              }`}>
                                {sync.hoursSinceSuccess < 1
                                  ? "< 1 hour ago"
                                  : sync.hoursSinceSuccess < 24
                                  ? `${Math.round(sync.hoursSinceSuccess)}h ago`
                                  : `${Math.round(sync.hoursSinceSuccess / 24)}d ago`
                                }
                                {sync.isStale && ` (threshold: ${sync.staleThreshold}h)`}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-16 text-text-tertiary">
          <RefreshCw className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Unable to load sync health data.</p>
        </div>
      )}

      {syncHealth && (
        <p className="text-xs text-text-muted">
          Last checked: {new Date(syncHealth.checkedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
