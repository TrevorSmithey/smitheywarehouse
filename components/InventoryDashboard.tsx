"use client";

import { Download, Info } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { InventoryResponse, ProductInventory } from "@/lib/types";
import { SAFETY_STOCK } from "@/lib/shiphero";
import { formatNumber } from "@/lib/dashboard-utils";
import { MetricLabel } from "@/components/MetricLabel";

type InventoryCategoryTab = "cast_iron" | "carbon_steel" | "accessory" | "factory_second";

interface InventoryDashboardProps {
  inventory: InventoryResponse | null;
  loading: boolean;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
  onRefresh: () => void;
}

export function InventoryDashboard({
  inventory,
  loading,
  expandedCategories,
  onToggleCategory,
  onRefresh,
}: InventoryDashboardProps) {

  // Download inventory as CSV
  const downloadCSV = () => {
    if (!inventory) return;

    // Get all products from all categories
    const allProducts = [
      ...inventory.byCategory.cast_iron,
      ...inventory.byCategory.carbon_steel,
      ...inventory.byCategory.accessory,
      ...inventory.byCategory.glass_lid,
      ...inventory.byCategory.factory_second,
    ];

    // Sort by SKU for consistent output
    allProducts.sort((a, b) => a.sku.localeCompare(b.sku));

    // CSV headers
    const headers = ["SKU", "Display Name", "Category", "Hobson", "Selery", "Pipefitter", "Total", "DOI", "Month Sold", "Month Budget", "Month %"];

    // CSV rows
    const rows = allProducts.map(p => [
      p.sku,
      `"${p.displayName.replace(/"/g, '""')}"`, // Escape quotes in display name
      p.category,
      p.hobson,
      p.selery,
      p.pipefitter,
      p.total,
      p.doi !== undefined ? p.doi : "",
      p.monthSold !== undefined ? p.monthSold : "",
      p.monthBudget !== undefined ? p.monthBudget : "",
      p.monthPct !== undefined ? `${p.monthPct}%` : "",
    ]);

    // Build CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Create download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const today = new Date().toISOString().split("T")[0];
    link.download = `smithey-inventory-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Download velocity as CSV
  const downloadVelocityCSV = () => {
    if (!inventory?.salesVelocity) return;

    // Combine cast iron and carbon steel velocity data
    const allVelocity = [
      ...inventory.salesVelocity.cast_iron,
      ...inventory.salesVelocity.carbon_steel,
    ];

    // Sort by daily average descending
    allVelocity.sort((a, b) => b.sales3DayAvg - a.sales3DayAvg);

    // CSV headers
    const headers = ["SKU", "Display Name", "Category", "3-Day Total", "Daily Avg", "Prior Daily Avg", "Change %"];

    // CSV rows
    const rows = allVelocity.map(v => [
      v.sku,
      `"${v.displayName.replace(/"/g, '""')}"`,
      v.category,
      v.sales3DayTotal,
      v.sales3DayAvg,
      v.prior3DayAvg,
      `${v.delta > 0 ? "+" : ""}${v.delta}%`,
    ]);

    // Build CSV content
    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.join(","))
    ].join("\n");

    // Create download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const today = new Date().toISOString().split("T")[0];
    link.download = `smithey-velocity-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Category config - factory seconds last, collapsed by default
  const categoryConfig: {
    key: InventoryCategoryTab;
    label: string;
    showDoi: boolean;
    showVelocity: boolean;
  }[] = [
    { key: "cast_iron", label: "CAST IRON", showDoi: true, showVelocity: true },
    { key: "carbon_steel", label: "CARBON STEEL", showDoi: true, showVelocity: true },
    { key: "accessory", label: "ACCESSORIES", showDoi: true, showVelocity: true },
    { key: "factory_second", label: "FACTORY SECONDS", showDoi: false, showVelocity: false },
  ];

  // Build velocity lookup for quick SKU access (store full data for tooltips)
  const velocityBySku = new Map<string, { avg: number; total: number; prior: number; delta: number }>();
  if (inventory?.salesVelocity) {
    const allVelocity = [
      ...(inventory.salesVelocity.cast_iron || []),
      ...(inventory.salesVelocity.carbon_steel || []),
      ...(inventory.salesVelocity.accessory || []),
      ...(inventory.salesVelocity.glass_lid || []),
    ];
    for (const item of allVelocity) {
      velocityBySku.set(item.sku.toLowerCase(), {
        avg: item.sales3DayAvg,
        total: item.sales3DayTotal,
        prior: item.prior3DayAvg,
        delta: item.delta
      });
    }
  }

  // Get products for a category, sorted by DOI ascending (lowest first = most urgent)
  const getProductsForCategory = (cat: InventoryCategoryTab): ProductInventory[] => {
    let products: ProductInventory[] = [];
    if (cat === "accessory") {
      products = [
        ...(inventory?.byCategory.accessory || []),
        ...(inventory?.byCategory.glass_lid || []),
      ].filter(p => p.sku !== "Smith-AC-Glid11"); // Hide 11Lid from accessories
    } else {
      products = inventory?.byCategory[cat] || [];
    }
    // Sort by DOI ascending: backordered first (-1), then lowest DOI, then no DOI at end
    return [...products].sort((a, b) => {
      const aVal = a.isBackordered ? -1 : (a.doi ?? 9999);
      const bVal = b.isBackordered ? -1 : (b.doi ?? 9999);
      return aVal - bVal;
    });
  };

  // Calculate totals for a category
  const getCategoryTotals = (products: ProductInventory[]) => {
    return products.reduce(
      (acc, p) => ({
        pipefitter: acc.pipefitter + p.pipefitter,
        hobson: acc.hobson + p.hobson,
        selery: acc.selery + p.selery,
        total: acc.total + p.total,
      }),
      { pipefitter: 0, hobson: 0, selery: 0, total: 0 }
    );
  };

  // Calculate cookware totals (cast iron + carbon steel only)
  const cookwareProducts = [
    ...(inventory?.byCategory.cast_iron || []),
    ...(inventory?.byCategory.carbon_steel || []),
  ];

  // DOI Health Analysis (cookware only - factory seconds excluded)
  const doiHealth = cookwareProducts.reduce(
    (acc, p) => {
      if (p.isBackordered) {
        acc.backorder++;
        acc.backorderItems.push(p.displayName);
      } else if (p.doi === undefined) {
        acc.noForecast++;
      } else if (p.doi < 7) {
        acc.urgent++;
        acc.urgentItems.push(p.displayName);
      } else if (p.doi < 30) {
        acc.critical++;
        acc.criticalItems.push(p.displayName);
      } else if (p.doi < 60) {
        acc.watch++;
      } else {
        acc.healthy++;
      }
      return acc;
    },
    { backorder: 0, urgent: 0, critical: 0, watch: 0, healthy: 0, noForecast: 0, backorderItems: [] as string[], urgentItems: [] as string[], criticalItems: [] as string[] }
  );

  // Get DOI status color
  const getDoiColor = (product: ProductInventory): string => {
    if (product.isBackordered) return "#F87171"; // red-400
    if (product.doi === undefined) return "#6B7280"; // gray-500
    if (product.doi < 7) return "#F87171"; // red-400
    if (product.doi < 30) return "#F59E0B"; // amber-500
    if (product.doi < 60) return "#FBBF24"; // yellow-400
    return "#34D399"; // emerald-400
  };

  // Loading state with branded spinner
  if (loading && !inventory) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-bg-tertiary" />
            <div
              className="absolute inset-0 w-16 h-16 rounded-full border-4 border-transparent animate-spin"
              style={{ borderTopColor: "#0EA5E9", borderRightColor: "#0284C7" }}
            />
          </div>
          <span className="text-sm text-text-tertiary tracking-widest uppercase">Opening the vault...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header with Health Status + Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Health Summary + Last Synced */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-bg-secondary rounded-xl px-3 py-2 border border-border/30">
            {doiHealth.backorder > 0 || doiHealth.urgent > 0 || doiHealth.critical > 0 ? (
              <>
                {doiHealth.backorder > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <span className="text-sm font-bold text-red-400 tabular-nums">{doiHealth.backorder}</span>
                    <span className="text-[10px] text-red-400/80 font-semibold tracking-wide">BACKORDER</span>
                  </div>
                )}
                {doiHealth.urgent > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <span className="text-sm font-bold text-red-400 tabular-nums">{doiHealth.urgent}</span>
                    <span className="text-[10px] text-red-400/80 font-semibold tracking-wide">URGENT</span>
                  </div>
                )}
                {doiHealth.critical > 0 && (
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    <span className="text-sm font-bold text-amber-400 tabular-nums">{doiHealth.critical}</span>
                    <span className="text-[10px] text-amber-400/80 font-semibold tracking-wide">WATCH</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 px-2 py-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-emerald-400 font-semibold">All Healthy</span>
              </div>
            )}
          </div>
          {/* Last Synced Timestamp */}
          {inventory?.lastSynced && (
            <span className="text-[10px] text-text-muted">
              Synced {formatDistanceToNow(new Date(inventory.lastSynced), { addSuffix: true })}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={downloadCSV}
            aria-label="Download inventory CSV"
            className="p-2 rounded-lg transition-all hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
            disabled={!inventory}
          >
            <Download className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>
      </div>

      {/* Category Cards - Full width for readable headings */}
      <div className="space-y-4">
        {categoryConfig.map((cat) => {
          const products = getProductsForCategory(cat.key);
          const totals = getCategoryTotals(products);
          const isExpanded = expandedCategories.has(cat.key);

          return (
            <div key={cat.key} className="bg-bg-secondary rounded-xl border border-border/30 overflow-hidden">
              {/* Collapsible Header - Category is hero */}
              <button
                onClick={() => onToggleCategory(cat.key)}
                className="w-full text-left hover:bg-bg-tertiary/30 transition-colors"
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  {/* Left: Category name as hero */}
                  <div className="flex items-center gap-3">
                    <span className={`text-sm transition-transform text-text-muted ${isExpanded ? "rotate-90" : ""}`}>
                      ▶
                    </span>
                    <span className="text-base font-bold uppercase tracking-wide text-text-primary">
                      {cat.label}
                    </span>
                    <span className="text-sm text-text-tertiary">({products.length})</span>
                  </div>

                  {/* Right: Warehouse totals - hidden on mobile */}
                  <div className="hidden sm:flex text-sm tabular-nums items-center gap-1">
                    <span className="text-amber-400">{formatNumber(totals.hobson)}</span>
                    <span className="text-text-muted/50">/</span>
                    <span className="text-cyan-400">{formatNumber(totals.selery)}</span>
                    <span className="text-text-muted/50 mx-1">=</span>
                    <span className="text-text-primary font-bold">{formatNumber(totals.total)}</span>
                  </div>
                </div>
              </button>

              {/* Expanded Table */}
              {isExpanded && (
                <div className="border-t border-border">
                  <table className="w-full text-sm table-fixed">
                    <colgroup>
                      <col className="w-[32%] sm:w-[26%]" />
                      <col className="w-[20%] sm:w-[16%]" />
                      <col className="w-[20%] sm:w-[16%]" />
                      <col className="w-[28%] sm:w-[16%]" />
                      {cat.showDoi && <col className="sm:w-[13%]" />}
                      {cat.showVelocity && <col className="hidden sm:table-column w-[13%]" />}
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-bg-tertiary/30">
                        <th className="text-left py-2.5 px-2 sm:px-3 font-medium">Product</th>
                        <th className="text-right py-2.5 px-2 sm:px-4 font-medium text-amber-400">
                          <MetricLabel label="Hobson" tooltip="Charleston warehouse" />
                        </th>
                        <th className="text-right py-2.5 px-2 sm:px-4 font-medium text-cyan-400">
                          <MetricLabel label="Selery" tooltip="3PL fulfillment partner" />
                        </th>
                        <th className="text-right py-2.5 px-2 sm:px-4 font-medium">Total</th>
                        {cat.showDoi && (
                          <th className="text-right py-2.5 px-2 sm:px-4 font-medium text-purple-400">
                            <MetricLabel label="DOI" tooltip="Days of inventory on hand" />
                          </th>
                        )}
                        {cat.showVelocity && (
                          <th className="hidden sm:table-cell text-right py-2.5 px-4 font-medium text-cyan-400">
                            <MetricLabel label="Vel" tooltip="3-day moving average of units sold" />
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product, idx) => {
                        const doiColor = getDoiColor(product);
                        const velocity = velocityBySku.get(product.sku.toLowerCase());
                        const isNegative = product.total < 0;
                        const hasWarehouseNegative = product.hobson < 0 || product.selery < 0;
                        const safetyStock = SAFETY_STOCK[product.sku];
                        const isBelowSafetyStock = safetyStock && product.total < safetyStock;
                        // Build tooltip: safety stock + 3-day moving avg
                        const tooltipParts: string[] = [];
                        if (safetyStock) {
                          tooltipParts.push(`Safety stock: ${safetyStock}`);
                        }
                        if (velocity) {
                          tooltipParts.push(`3-day avg: ${velocity.avg}/day`);
                        }
                        const tooltip = tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined;

                        // Row background priority: negative (solid red) > SS violation (pulsing amber) > zebra
                        const rowBg = isNegative || hasWarehouseNegative
                          ? "bg-red-500/15"
                          : isBelowSafetyStock
                          ? "ss-violation"
                          : idx % 2 === 1
                          ? "bg-bg-tertiary/10"
                          : "";

                        const hasHighlight = rowBg && rowBg !== "bg-bg-tertiary/10";
                        const isPulsing = rowBg === "ss-violation";

                        return (
                          <tr
                            key={product.sku}
                            className={`border-b border-border/20 ${isPulsing ? "" : "transition-colors"} ${rowBg} ${!hasHighlight ? "hover:bg-bg-tertiary/40" : ""}`}
                          >
                            <td className="py-3 px-2 sm:px-3">
                              <div className="flex items-center gap-2">
                                {cat.showDoi && (
                                  <div
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: doiColor }}
                                  />
                                )}
                                <span className={`text-sm font-medium truncate ${isNegative ? "text-red-400" : "text-text-primary"}`}>
                                  {product.displayName}
                                </span>
                                {SAFETY_STOCK[product.sku] && (
                                  <span className="text-[10px] text-text-muted tabular-nums">
                                    ss:{SAFETY_STOCK[product.sku]}
                                  </span>
                                )}
                                {/* Info icon with tooltip for MTD/Velocity/Stockout */}
                                {tooltip && (
                                  <span className="relative group cursor-help flex-shrink-0 ml-1">
                                    <Info className="w-3 h-3 text-text-muted/40 group-hover:text-accent-blue transition-colors" />
                                    <span className="
                                      absolute top-full left-0 mt-1.5
                                      px-3 py-2 rounded
                                      bg-[#1a1a1a] text-[11px] text-white/90 font-normal leading-relaxed
                                      opacity-0 group-hover:opacity-100
                                      translate-y-1 group-hover:translate-y-0
                                      transition-all duration-200 ease-out
                                      pointer-events-none whitespace-nowrap z-[100]
                                      shadow-[0_4px_20px_rgba(0,0,0,0.5)]
                                      border border-white/5
                                    ">
                                      {tooltip}
                                      {/* Arrow pointing up */}
                                      <span className="absolute bottom-full left-3 border-[5px] border-transparent border-b-[#1a1a1a]" />
                                    </span>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-semibold ${
                              product.hobson < 0 ? "text-red-400 bg-red-500/10" :
                              product.hobson < 10 ? "text-amber-400 bg-status-warning/20" : "text-amber-400"
                            }`}>
                              {formatNumber(product.hobson)}
                            </td>
                            <td className={`py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-semibold ${
                              product.selery < 0 ? "text-red-400 bg-red-500/10" :
                              product.selery < 10 ? "text-cyan-400 bg-status-warning/20" : "text-cyan-400"
                            }`}>
                              {formatNumber(product.selery)}
                            </td>
                            <td className={`py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold ${
                              isNegative ? "text-red-400" : "text-text-primary"
                            }`}>
                              {formatNumber(product.total)}
                            </td>
                            {cat.showDoi && (
                              <td className="py-3 px-2 sm:px-4 text-right">
                                {product.isBackordered ? (
                                  <span className="text-sm font-bold text-red-400 uppercase">
                                    BACKORDER
                                  </span>
                                ) : product.doi !== undefined ? (
                                  <span
                                    className="inline-block text-sm font-bold tabular-nums px-2 py-0.5 rounded"
                                    style={{ backgroundColor: `${doiColor}20`, color: doiColor }}
                                  >
                                    {product.doi}d
                                  </span>
                                ) : (
                                  <span className="text-text-muted/50">—</span>
                                )}
                              </td>
                            )}
                            {cat.showVelocity && (
                              <td className="hidden sm:table-cell py-3 px-4 text-right">
                                {velocity ? (
                                  <span className={`text-sm font-bold tabular-nums ${
                                    velocity.avg >= 10 ? "text-emerald-400" :
                                    velocity.avg >= 5 ? "text-cyan-400" :
                                    velocity.avg > 0 ? "text-text-secondary" :
                                    "text-text-muted"
                                  }`}>
                                    {velocity.avg}/d
                                  </span>
                                ) : (
                                  <span className="text-text-muted/50">—</span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-bg-tertiary/40">
                        <td className="py-3 px-2 sm:px-3 text-sm font-bold text-text-primary">TOTAL</td>
                        <td className="py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold text-amber-400">
                          {formatNumber(totals.hobson)}
                        </td>
                        <td className="py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold text-cyan-400">
                          {formatNumber(totals.selery)}
                        </td>
                        <td className="py-3 px-2 sm:px-4 text-right tabular-nums text-[15px] font-bold text-text-primary">
                          {formatNumber(totals.total)}
                        </td>
                        {cat.showDoi && <td className="py-3 px-2 sm:px-4" />}
                        {cat.showVelocity && <td className="hidden sm:table-cell py-3 px-4" />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-text-muted">
        <div className="flex items-center gap-4">
          <span className="font-medium text-text-secondary">DOI:</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span>&lt;7d Urgent</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>&lt;30d Watch</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span>&lt;60d OK</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>60d+ Healthy</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-text-secondary">Vel:</span>
          <span>3-day avg sales/day</span>
        </div>
      </div>
    </div>
  );
}
