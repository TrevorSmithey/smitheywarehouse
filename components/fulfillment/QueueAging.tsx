"use client";

import { Clock, AlertTriangle } from "lucide-react";
import type { OrderAging } from "@/lib/types";
import { formatNumber } from "@/lib/dashboard-utils";

// ============================================================================
// SIMPLE TABLE-BASED QUEUE AGING
// ============================================================================

interface QueueAgingProps {
  aging: OrderAging[];
  loading: boolean;
}

export function QueueAging({ aging, loading }: QueueAgingProps) {
  // Calculate totals
  const totalSmithey = aging.reduce((sum, d) => sum + d.smithey, 0);
  const totalSelery = aging.reduce((sum, d) => sum + d.selery, 0);
  const totalOrders = totalSmithey + totalSelery;

  // Get 5+d count for warning
  const oldBucket = aging.find((a) => a.bucket === "5+d");
  const oldOrders = oldBucket ? oldBucket.smithey + oldBucket.selery : 0;
  const oldPct = totalOrders > 0 ? (oldOrders / totalOrders) * 100 : 0;
  const hasWarning = oldPct > 5;

  if (loading) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
        <div className="h-[120px] flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      </div>
    );
  }

  if (aging.length === 0 || totalOrders === 0) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-3.5 h-3.5 text-text-muted" />
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            QUEUE AGING
          </h3>
        </div>
        <div className="text-center py-4">
          <div className="text-status-good text-sm">Queue is empty</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border/30 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-text-muted" />
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
            QUEUE AGING
          </h3>
          <span className="text-xs text-text-tertiary">
            {formatNumber(totalOrders)} orders
          </span>
        </div>
        {hasWarning && (
          <div className="flex items-center gap-1.5 text-status-warning text-xs">
            <AlertTriangle className="w-3 h-3" />
            <span>{oldPct.toFixed(0)}% over 5 days</span>
          </div>
        )}
      </div>

      {/* Simple Table */}
      <div className="overflow-hidden rounded-lg border border-border/30">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-tertiary/50">
              <th className="text-left text-[10px] font-medium uppercase tracking-wider text-text-muted px-3 py-2">
                Age
              </th>
              <th className="text-right text-[10px] font-medium uppercase tracking-wider text-accent-blue px-3 py-2">
                Smithey
              </th>
              <th className="text-right text-[10px] font-medium uppercase tracking-wider text-[#8B5CF6] px-3 py-2">
                Selery
              </th>
              <th className="text-right text-[10px] font-medium uppercase tracking-wider text-text-muted px-3 py-2">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {aging.map((bucket) => {
              const total = bucket.smithey + bucket.selery;
              const isDanger = bucket.bucket === "5+d" && total > 0;
              const isWarning = bucket.bucket === "3-5d" && total > 0;

              return (
                <tr
                  key={bucket.bucket}
                  className={
                    isDanger
                      ? "bg-status-bad/5"
                      : isWarning
                      ? "bg-status-warning/5"
                      : ""
                  }
                >
                  <td
                    className={`px-3 py-2 font-medium ${
                      isDanger
                        ? "text-status-bad"
                        : isWarning
                        ? "text-status-warning"
                        : bucket.bucket === "<1d"
                        ? "text-status-good"
                        : "text-text-primary"
                    }`}
                  >
                    {bucket.bucket}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {bucket.smithey > 0 ? formatNumber(bucket.smithey) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {bucket.selery > 0 ? formatNumber(bucket.selery) : "—"}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-medium ${
                      isDanger
                        ? "text-status-bad"
                        : isWarning
                        ? "text-status-warning"
                        : "text-text-primary"
                    }`}
                  >
                    {formatNumber(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-bg-tertiary/30 border-t border-border/30">
              <td className="px-3 py-2 font-medium text-text-muted">Total</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-accent-blue">
                {formatNumber(totalSmithey)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#8B5CF6]">
                {formatNumber(totalSelery)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-text-primary">
                {formatNumber(totalOrders)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
