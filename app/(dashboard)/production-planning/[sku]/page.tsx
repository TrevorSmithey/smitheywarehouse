"use client";

import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { useProductionPlanning } from "../layout";
import { useMemo, useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import SKUHeroCard from "@/components/SKUHeroCard";

// ============================================================================
// SKU DETAIL PAGE
// ============================================================================
// Focused view for a single SKU
// Priority: Inventory → Production Target → Constraints → BOM
// ============================================================================

interface InventoryData {
  onHand: number;
  doi: number | null;
}

export default function SKUDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data, loading } = useProductionPlanning();
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState(false);

  const sku = decodeURIComponent(params.sku as string);

  // Fetch inventory data for this SKU
  useEffect(() => {
    const abortController = new AbortController();

    async function fetchInventory() {
      setInventoryError(false);
      try {
        const res = await fetch('/api/inventory', { signal: abortController.signal });
        if (res.ok) {
          const invData = await res.json();
          // API returns { inventory: [...], totals: {...} }
          const skuInv = invData.inventory?.find(
            (p: { sku: string }) => p.sku.toLowerCase() === sku.toLowerCase()
          );
          if (skuInv) {
            setInventory({
              onHand: skuInv.total || 0,
              doi: skuInv.doi || null, // doi is directly on the object
            });
          }
        } else {
          setInventoryError(true);
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return; // Ignore aborts
        console.error('Failed to fetch inventory:', e);
        setInventoryError(true);
      } finally {
        setInventoryLoading(false);
      }
    }
    fetchInventory();

    return () => abortController.abort(); // Cleanup on unmount or SKU change
  }, [sku]);

  // Find the SKU data
  const skuData = useMemo(() => {
    if (!data) return null;
    return data.skuData.find((s) => s.sku.toLowerCase() === sku.toLowerCase());
  }, [data, sku]);

  // Find ALL constraining components for this SKU
  const constraints = useMemo(() => {
    if (!skuData?.bomComponents) return [];
    return skuData.bomComponents
      .filter(comp => comp.canMake >= 0 && comp.canMake < skuData.monthlyTarget)
      .sort((a, b) => a.canMake - b.canMake);
  }, [skuData]);

  // Generate daily production data (simulated) - MUST be before any returns
  // Uses deterministic pseudo-random so values don't change on re-render
  const dailyData = useMemo(() => {
    if (!data || !skuData) return [];

    const days = [];
    const daysElapsed = data.period.daysElapsedInMonth;
    const avgDaily = daysElapsed > 0 ? Math.floor(skuData.producedMTD / daysElapsed) : 0;

    // Deterministic pseudo-random generator based on day number and SKU
    // This ensures the same values are shown on every render
    const seededRandom = (seed: number): number => {
      const x = Math.sin(seed * 9301 + 49297) * 10000;
      return x - Math.floor(x); // Returns 0 to 1
    };

    for (let i = 1; i <= data.period.daysInMonth; i++) {
      const isPast = i <= daysElapsed;
      const isFuture = i > daysElapsed;
      const isToday = i === daysElapsed;

      let produced = 0;
      if (isPast) {
        // Use day number as seed for deterministic variation
        const rnd = seededRandom(i + skuData.sku.length);
        produced = avgDaily + Math.floor((rnd - 0.5) * avgDaily * 0.4);
        produced = Math.max(0, produced);
      }

      days.push({ day: i, produced, isPast, isFuture, isToday });
    }

    return days;
  }, [data, skuData]);

  // Loading state
  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent-blue)] border-t-transparent" />
      </div>
    );
  }

  // SKU not found
  if (!skuData) {
    return (
      <div className="p-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-white mb-6 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          Back
        </button>
        <div className="text-center py-12">
          <p className="text-[var(--color-text-tertiary)]">SKU not found: {sku}</p>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, skuData.monthlyTarget - skuData.producedMTD);
  const daysLeft = data.period.daysInMonth - data.period.daysElapsedInMonth;
  const dailyRateNeeded = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0;
  // Guard against division by zero for all percentage/daily calculations
  const percentThruMonth = data.period.daysInMonth > 0
    ? Math.round((data.period.daysElapsedInMonth / data.period.daysInMonth) * 100)
    : 0;
  const percentProduced = skuData.monthlyTarget > 0
    ? Math.round((skuData.producedMTD / skuData.monthlyTarget) * 100)
    : 0;
  const dailyTarget = data.period.daysInMonth > 0
    ? Math.ceil(skuData.monthlyTarget / data.period.daysInMonth)
    : 0;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-[var(--color-text-secondary)] hover:text-white transition-colors text-sm"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Overview
      </button>

      {/* Header Row: SKU Name + Constraint Badge */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">
            {skuData.displayName}
          </h1>
          <p className="text-[var(--color-text-tertiary)] text-sm">
            {data.period.monthName} {data.period.year} · {percentThruMonth}% thru month
          </p>
        </div>
        {constraints.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-lg text-sm">
            <AlertTriangle className="w-4 h-4" />
            {constraints.length} Constraint{constraints.length > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* SKU Hero Card - Unified inventory + year context + runway */}
      <SKUHeroCard
        onHand={inventory?.onHand ?? 0}
        doi={inventory?.doi ?? null}
        yearForecast={skuData.yearSalesForecast}
        ytdProduced={skuData.producedYTD}
        yearRemaining={skuData.remainingForYear}
        loading={inventoryLoading}
        error={inventoryError}
      />

      {/* Production Target Section */}
      <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] p-4">
        <h2 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
          Monthly Production
        </h2>

        <div className="grid grid-cols-3 gap-6 mb-4">
          <div>
            <p className="text-[var(--color-text-tertiary)] text-xs mb-1">Target</p>
            <p className="text-2xl font-semibold text-white">
              {skuData.monthlyTarget.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-[var(--color-text-tertiary)] text-xs mb-1">Produced</p>
            <p className="text-2xl font-semibold text-white">
              {skuData.producedMTD.toLocaleString()}
              <span className="text-sm text-[var(--color-text-tertiary)] ml-1">
                ({percentProduced}%)
              </span>
            </p>
          </div>
          <div>
            <p className="text-[var(--color-text-tertiary)] text-xs mb-1">Remaining</p>
            <p className="text-2xl font-semibold text-white">
              {remaining.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Daily Rate Needed */}
        {remaining > 0 && daysLeft > 0 && (
          <div className="pt-3 border-t border-[var(--color-border-subtle)]">
            <p className="text-[var(--color-text-secondary)] text-sm">
              Need <span className="text-white font-semibold">{dailyRateNeeded.toLocaleString()}/day</span> to hit target
              <span className="text-[var(--color-text-tertiary)]"> · {daysLeft} days left</span>
            </p>
          </div>
        )}
      </div>

      {/* Constraints Section - Show ALL */}
      {constraints.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h2 className="text-xs font-medium text-amber-400 uppercase tracking-wider">
              Component Constraints
            </h2>
          </div>

          <div className="space-y-2">
            {constraints.map((comp, idx) => (
              <div
                key={comp.component}
                className={`flex items-center justify-between py-2 ${
                  idx > 0 ? 'border-t border-amber-500/20' : ''
                }`}
              >
                <span className="text-white text-sm">{comp.component}</span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[var(--color-text-tertiary)]">
                    {comp.available.toLocaleString()} avail
                  </span>
                  <span className="text-[var(--color-text-tertiary)]">
                    can make {comp.canMake.toLocaleString()}
                  </span>
                  <span className="text-amber-400 font-medium">
                    -{(skuData.monthlyTarget - comp.canMake).toLocaleString()} short
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Production Chart */}
      <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] p-4">
        <h2 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
          Daily Production
        </h2>

        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={dailyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                interval={4}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--color-text-tertiary)', fontSize: 10 }}
                width={40}
              />
              <ReferenceLine
                y={dailyTarget}
                stroke="var(--color-text-tertiary)"
                strokeDasharray="4 4"
              />
              <Bar dataKey="produced" radius={[2, 2, 0, 0]}>
                {dailyData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isFuture ? 'var(--color-bg-tertiary)' : 'var(--color-accent-blue)'}
                    opacity={entry.isFuture ? 0.3 : entry.isToday ? 1 : 0.7}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-center gap-6 mt-3 text-xs text-[var(--color-text-tertiary)]">
          <div className="flex items-center gap-2">
            <span className="w-3 h-2 rounded-sm bg-[var(--color-accent-blue)]" />
            <span>Produced</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 border-t border-dashed border-[var(--color-text-tertiary)]" />
            <span>Daily target</span>
          </div>
        </div>
      </div>

      {/* BOM Components */}
      {skuData.bomComponents && skuData.bomComponents.length > 0 && (
        <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] p-4">
          <h2 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-3">
            Bill of Materials
          </h2>

          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-bg-tertiary)]">
                  <th className="text-left px-3 py-2 text-[var(--color-text-tertiary)] font-medium text-xs">
                    Component
                  </th>
                  <th className="text-right px-3 py-2 text-[var(--color-text-tertiary)] font-medium text-xs">
                    Qty/Unit
                  </th>
                  <th className="text-right px-3 py-2 text-[var(--color-text-tertiary)] font-medium text-xs">
                    Available
                  </th>
                  <th className="text-right px-3 py-2 text-[var(--color-text-tertiary)] font-medium text-xs">
                    Can Make
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {skuData.bomComponents.map((comp) => {
                  const isConstraint = comp.canMake >= 0 && comp.canMake < skuData.monthlyTarget;
                  return (
                    <tr key={comp.component} className={isConstraint ? 'bg-amber-500/5' : ''}>
                      <td className="px-3 py-2 text-white flex items-center gap-2">
                        {comp.component}
                        {isConstraint && (
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                        )}
                      </td>
                      <td className="text-right px-3 py-2 text-[var(--color-text-secondary)]">
                        {comp.qtyRequired}
                      </td>
                      <td className="text-right px-3 py-2 text-[var(--color-text-secondary)]">
                        {comp.available.toLocaleString()}
                      </td>
                      <td className={`text-right px-3 py-2 font-medium ${
                        isConstraint ? 'text-amber-400' : 'text-white'
                      }`}>
                        {comp.canMake >= 0 ? comp.canMake.toLocaleString() : '∞'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
