"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, AlertTriangle, Printer, Download, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ProductionPlanningResponse } from "@/app/api/production-planning/route";

// ============================================================================
// PRODUCTION PLANNING V2 - Compact, Grouped, Side-by-Side
// ============================================================================
// Design Philosophy:
// 1. Compact header - NOT a dominating hero
// 2. Product families side-by-side to reduce scrolling
// 3. Always grouped - no flat view option
// 4. Click row → detail page
// ============================================================================

interface Props {
  data: ProductionPlanningResponse;
  onMonthChange: (year: number, month: number) => void;
}

// ============================================================================
// COMPACT HEADER BAR
// ============================================================================
function HeaderBar({
  data,
  onMonthChange,
}: {
  data: ProductionPlanningResponse;
  onMonthChange: (year: number, month: number) => void;
}) {
  const { period, summary, constraintAlerts } = data;

  const remaining = summary.totalMonthlyTarget - summary.totalProducedMTD;
  const daysLeft = period.daysInMonth - period.daysElapsedInMonth;

  // Month navigation
  const goToPrevMonth = () => {
    let newMonth = period.month - 1;
    let newYear = period.year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    onMonthChange(newYear, newMonth);
  };

  const goToNextMonth = () => {
    let newMonth = period.month + 1;
    let newYear = period.year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    onMonthChange(newYear, newMonth);
  };

  // Export to CSV - with proper escaping and error handling
  const exportToCSV = () => {
    // Guard: No data to export
    if (!data.skuData || data.skuData.length === 0) {
      alert('No data to export');
      return;
    }

    // CSV escaping: quote values containing commas, quotes, or newlines
    const escapeCsvValue = (val: string | number): string => {
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [
      ['SKU', 'Category', 'Target', 'Built', 'Remaining', 'Percent'],
      ...data.skuData.map(sku => [
        sku.displayName,
        sku.category,
        sku.monthlyTarget,
        sku.producedMTD,
        Math.max(0, sku.monthlyTarget - sku.producedMTD),
        // Guard against division by zero
        sku.monthlyTarget > 0
          ? Math.round((sku.producedMTD / sku.monthlyTarget) * 100) + '%'
          : '0%'
      ])
    ];

    const csv = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // Use try/finally to ensure URL is revoked even if click throws
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `production-plan-${period.monthName.toLowerCase()}-${period.year}.csv`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // Print
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] px-4 py-3 print:bg-white print:border-gray-300">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Month Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="p-1.5 rounded-md hover:bg-[var(--color-bg-tertiary)]
                       text-[var(--color-text-secondary)] hover:text-white transition-colors print:hidden"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h1 className="text-sm font-semibold text-white tracking-wide min-w-[100px] text-center print:text-black print:text-lg">
            {period.monthName.toUpperCase()} {period.year}
          </h1>
          <button
            onClick={goToNextMonth}
            className="p-1.5 rounded-md hover:bg-[var(--color-bg-tertiary)]
                       text-[var(--color-text-secondary)] hover:text-white transition-colors print:hidden"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Compact Metrics */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)] print:text-gray-600">Target</span>
            <span className="text-white font-medium print:text-black">{summary.totalMonthlyTarget.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)] print:text-gray-600">Produced</span>
            <span className="text-white font-medium print:text-black">{summary.totalProducedMTD.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)] print:text-gray-600">Remaining</span>
            <span className="text-white font-semibold print:text-black">{remaining.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-text-tertiary)] print:text-gray-600">Days Left</span>
            <span className="text-white font-medium print:text-black">{daysLeft}</span>
          </div>

          {/* Constraint Badge */}
          {constraintAlerts.length > 0 && (
            <div className="flex items-center gap-1.5 text-amber-400 print:text-amber-600">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs">{constraintAlerts.length} constrained</span>
            </div>
          )}

          {/* Export/Print Buttons */}
          <div className="flex items-center gap-1 print:hidden">
            <button
              onClick={exportToCSV}
              className="p-1.5 rounded-md hover:bg-[var(--color-bg-tertiary)]
                         text-[var(--color-text-secondary)] hover:text-white transition-colors"
              title="Export CSV"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handlePrint}
              className="p-1.5 rounded-md hover:bg-[var(--color-bg-tertiary)]
                         text-[var(--color-text-secondary)] hover:text-white transition-colors"
              title="Print"
            >
              <Printer className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PRODUCT FAMILY COLUMN
// ============================================================================
function ProductFamilyColumn({
  title,
  items,
  onRowClick,
}: {
  title: string;
  items: ProductionPlanningResponse['skuData'];
  onRowClick: (sku: string) => void;
}) {
  if (items.length === 0) return null;

  const totalRemaining = items.reduce((sum, sku) => sum + Math.max(0, sku.monthlyTarget - sku.producedMTD), 0);

  // Sort by percentage (lowest first - most behind at top)
  const sortedItems = [...items].sort((a, b) => {
    const pctA = a.monthlyTarget > 0 ? (a.producedMTD / a.monthlyTarget) * 100 : 100;
    const pctB = b.monthlyTarget > 0 ? (b.producedMTD / b.monthlyTarget) * 100 : 100;
    return pctA - pctB;
  });

  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] overflow-hidden flex-1 min-w-0">
      {/* Column Header */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]">
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-text-secondary)] text-xs uppercase tracking-wider font-medium">
            {title}
          </span>
          <span className="text-white text-xs font-medium">
            {totalRemaining.toLocaleString()} left
          </span>
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-[1fr_52px_52px_52px_70px_42px] gap-1 px-3 py-1.5 border-b border-[var(--color-border-subtle)]
                      text-[var(--color-text-tertiary)] text-[10px] uppercase tracking-wide">
        <div>SKU</div>
        <div className="text-right">Target</div>
        <div className="text-right">Built</div>
        <div className="text-right">Left</div>
        <div></div>
        <div className="text-right"></div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[var(--color-border-subtle)]/30">
        {sortedItems.map((sku) => {
          const remaining = sku.monthlyTarget - sku.producedMTD;
          const percent = sku.monthlyTarget > 0 ? (sku.producedMTD / sku.monthlyTarget) * 100 : 100;
          const isComplete = remaining <= 0;
          const isAhead = percent >= 100;

          // Color based on percentage
          const barColor = isAhead ? 'bg-emerald-500' : percent >= 70 ? 'bg-amber-500' : 'bg-amber-600';
          const textColor = isAhead ? 'text-emerald-400' : percent >= 70 ? 'text-amber-400' : 'text-amber-500';

          return (
            <button
              key={sku.sku}
              onClick={() => onRowClick(sku.sku)}
              className="w-full grid grid-cols-[1fr_52px_52px_52px_70px_42px] gap-1 px-3 py-2
                         hover:bg-[var(--color-bg-tertiary)]/50 transition-colors text-left group"
            >
              {/* SKU Name */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-white text-xs truncate group-hover:text-sky-400 transition-colors">
                  {sku.displayName}
                </span>
                {sku.hasConstraint && (
                  <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                )}
              </div>

              {/* Target */}
              <div className="text-right text-[var(--color-text-tertiary)] text-xs tabular-nums">
                {sku.monthlyTarget.toLocaleString()}
              </div>

              {/* Built */}
              <div className="text-right text-[var(--color-text-secondary)] text-xs tabular-nums">
                {sku.producedMTD.toLocaleString()}
              </div>

              {/* Left */}
              <div className="text-right text-white text-xs font-medium tabular-nums">
                {isComplete ? '—' : remaining.toLocaleString()}
              </div>

              {/* Progress Bar */}
              <div className="flex items-center">
                <div className="w-full h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-full transition-all`}
                    style={{ width: `${Math.min(100, percent)}%` }}
                  />
                </div>
              </div>

              {/* Percentage */}
              <div className={`text-right text-xs tabular-nums font-medium ${textColor}`}>
                {Math.round(percent)}%
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// CONSTRAINED ITEMS SECTION - Grouped by Category, Collapsed by Default
// Shows ALL constraining components per SKU (not just the primary one)
// ============================================================================
interface ConstraintItem {
  sku: string;
  displayName: string;
  category: string;
  monthlyTarget: number;
  constraints: {
    component: string;
    available: number;
    canMake: number;
    shortfall: number;
  }[];
}

function ConstrainedItemsSection({
  skuData,
  onRowClick,
}: {
  skuData: ProductionPlanningResponse['skuData'];
  onRowClick: (sku: string) => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Build constraint items from skuData, including ALL constraining components
  const groupedConstraints = useMemo(() => {
    const groups: Record<string, ConstraintItem[]> = {
      cast_iron: [],
      carbon_steel: [],
      accessory: [],
    };

    skuData.forEach(sku => {
      if (!sku.hasConstraint || !sku.bomComponents) return;

      // Find ALL constraining components (where canMake < monthlyTarget)
      const constrainingComponents = sku.bomComponents.filter(
        comp => comp.canMake >= 0 && comp.canMake < sku.monthlyTarget
      );

      if (constrainingComponents.length === 0) return;

      const item: ConstraintItem = {
        sku: sku.sku,
        displayName: sku.displayName,
        category: sku.category,
        monthlyTarget: sku.monthlyTarget,
        constraints: constrainingComponents.map(comp => ({
          component: comp.component,
          available: comp.available,
          canMake: comp.canMake,
          shortfall: sku.monthlyTarget - comp.canMake,
        })).sort((a, b) => b.shortfall - a.shortfall), // Most limiting first
      };

      groups[sku.category]?.push(item);
    });

    // Sort by total shortfall
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => {
        const shortfallA = a.constraints[0]?.shortfall || 0;
        const shortfallB = b.constraints[0]?.shortfall || 0;
        return shortfallB - shortfallA;
      });
    });

    return groups;
  }, [skuData]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const dismissItem = (sku: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedIds(prev => new Set([...prev, sku]));
  };

  const groupLabels: Record<string, string> = {
    cast_iron: 'Cast Iron',
    carbon_steel: 'Carbon Steel',
    accessory: 'Accessories',
  };

  const totalConstraints = Object.values(groupedConstraints).flat().length;
  if (totalConstraints === 0) return null;

  return (
    <div className="flex gap-4">
      {Object.entries(groupedConstraints).map(([group, items]) => {
        const visibleItems = items.filter(item => !dismissedIds.has(item.sku));
        if (items.length === 0) return null;

        const isExpanded = expandedGroups.has(group);

        return (
          <div
            key={group}
            className="flex-1 min-w-0 bg-[var(--color-bg-secondary)] rounded-lg border border-amber-500/30 overflow-hidden"
          >
            {/* Header - Click to Toggle */}
            <button
              onClick={() => toggleGroup(group)}
              className="w-full px-3 py-2 border-b border-amber-500/20 bg-amber-500/5 flex items-center justify-between
                         hover:bg-amber-500/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-amber-400 text-xs uppercase tracking-wider font-medium">
                  {groupLabels[group]}
                </span>
                <span className="text-amber-500/60 text-xs">
                  ({visibleItems.length})
                </span>
              </div>
              <ChevronRight
                className={`w-4 h-4 text-amber-500/60 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </button>

            {/* Expanded Content */}
            {isExpanded && visibleItems.length > 0 && (
              <div className="divide-y divide-[var(--color-border-subtle)]/30">
                {visibleItems.map((item) => (
                  <div
                    key={item.sku}
                    onClick={() => onRowClick(item.sku)}
                    className="px-3 py-2 hover:bg-amber-500/5 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white text-xs truncate group-hover:text-amber-400 transition-colors">
                        {item.displayName}
                      </span>
                      <button
                        onClick={(e) => dismissItem(item.sku, e)}
                        className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]
                                   hover:text-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                        title="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Show ALL constraining components */}
                    <div className="mt-1 space-y-0.5">
                      {item.constraints.map((constraint, idx) => (
                        <div key={constraint.component} className="flex items-center gap-2 text-[10px]">
                          <span className={`truncate ${idx === 0 ? 'text-amber-400' : 'text-amber-400/60'}`}>
                            {constraint.component}
                          </span>
                          <span className="text-[var(--color-text-tertiary)]">
                            {constraint.available.toLocaleString()} avail
                          </span>
                          <span className={`font-medium ${idx === 0 ? 'text-amber-400' : 'text-amber-400/60'}`}>
                            -{constraint.shortfall.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Collapsed hint */}
            {!isExpanded && visibleItems.length > 0 && (
              <div className="px-3 py-1.5 text-[10px] text-amber-500/50">
                Click to expand
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// YEARLY OVERVIEW - Collapsible section showing all 12 months
// ============================================================================
function YearlyOverview({
  yearlyTargets,
  year,
  annualSkuTargets,
}: {
  yearlyTargets: ProductionPlanningResponse['yearlyTargets'];
  year: number;
  annualSkuTargets: ProductionPlanningResponse['annualSkuTargets'];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  if (!yearlyTargets || yearlyTargets.length === 0) return null;

  const yearTotal = yearlyTargets.reduce((sum, m) => sum + m.target, 0);
  const yearProduced = yearlyTargets.reduce((sum, m) => sum + m.produced, 0);

  // Format numbers compactly
  const formatCompact = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString();
  };

  // Get SKU targets for selected month
  const getMonthSkuData = (monthIndex: number) => {
    if (!annualSkuTargets) return [];
    return annualSkuTargets
      .filter(s => s.monthlyTargets && s.monthlyTargets[monthIndex] > 0)
      .map(s => ({
        displayName: s.displayName,
        category: s.category,
        target: s.monthlyTargets?.[monthIndex] || 0,
      }))
      .sort((a, b) => b.target - a.target);
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-[var(--color-bg-tertiary)]/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-[var(--color-text-tertiary)]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[var(--color-text-tertiary)]" />
          )}
          <span className="text-[var(--color-text-secondary)] text-sm font-medium">
            {year} Annual Budget
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-[var(--color-text-tertiary)]">
            Target: <span className="text-white font-medium">{formatCompact(yearTotal)}</span>
          </span>
          <span className="text-[var(--color-text-tertiary)]">
            Produced: <span className="text-white font-medium">{formatCompact(yearProduced)}</span>
          </span>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          <div className="grid grid-cols-12 gap-1">
            {yearlyTargets.map((m) => {
              const delta = m.produced - m.target;
              const isComplete = delta >= 0 && !m.isFuture;
              const isSelected = selectedMonth === m.month;

              return (
                <button
                  key={m.month}
                  onClick={() => setSelectedMonth(isSelected ? null : m.month)}
                  className={`p-2 rounded text-center transition-all
                    ${isSelected ? 'bg-sky-500/30 ring-2 ring-sky-500' :
                      m.isCurrent ? 'bg-sky-500/20 ring-1 ring-sky-500/50' : 'bg-[var(--color-bg-tertiary)] hover:ring-1 hover:ring-sky-500/50'}
                    ${m.isFuture && !isSelected ? 'opacity-50' : ''}`}
                >
                  <div className="text-[10px] text-[var(--color-text-tertiary)] uppercase">
                    {m.monthName.slice(0, 3)}
                  </div>
                  <div className="text-xs font-medium text-white mt-0.5">
                    {formatCompact(m.target)}
                  </div>
                  {!m.isFuture && m.target > 0 && (
                    <div className={`text-[10px] mt-0.5 ${isComplete ? 'text-emerald-400' : delta < 0 ? 'text-amber-400' : 'text-[var(--color-text-tertiary)]'}`}>
                      {delta >= 0 ? '+' : ''}{formatCompact(delta)}
                    </div>
                  )}
                  {m.isFuture && (
                    <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">—</div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Month Detail */}
          {selectedMonth !== null && (
            <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">
                  {monthNames[selectedMonth - 1]} {year} Budget
                </span>
                <button
                  onClick={() => setSelectedMonth(null)}
                  className="text-[var(--color-text-tertiary)] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4 max-h-64 overflow-y-auto scrollbar-thin">
                {['cast_iron', 'carbon_steel', 'accessory'].map(category => {
                  const categoryData = getMonthSkuData(selectedMonth - 1).filter(s => s.category === category);
                  const categoryTotal = categoryData.reduce((sum, s) => sum + s.target, 0);
                  const categoryLabel = category === 'cast_iron' ? 'Cast Iron' :
                                       category === 'carbon_steel' ? 'Carbon Steel' : 'Accessories';

                  if (categoryData.length === 0 && categoryTotal === 0) return null;

                  return (
                    <div key={category}>
                      <div className="text-xs text-[var(--color-text-tertiary)] uppercase mb-1 flex justify-between">
                        <span>{categoryLabel}</span>
                        <span className="text-white">{formatCompact(categoryTotal)}</span>
                      </div>
                      <div className="space-y-0.5">
                        {categoryData.map((sku, i) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-[var(--color-text-secondary)] truncate mr-2">{sku.displayName}</span>
                            <span className="text-white tabular-nums">{formatCompact(sku.target)}</span>
                          </div>
                        ))}
                        {categoryData.length === 0 && (
                          <div className="text-xs text-[var(--color-text-tertiary)]">No targets</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Year Summary Bar */}
          <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--color-text-tertiary)]">Year Progress</span>
              <span className="text-white font-medium">
                {formatCompact(yearProduced)} / {formatCompact(yearTotal)}
                <span className="text-[var(--color-text-tertiary)] ml-2">
                  ({yearTotal > 0 ? Math.round((yearProduced / yearTotal) * 100) : 0}%)
                </span>
              </span>
            </div>
            <div className="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, yearTotal > 0 ? (yearProduced / yearTotal) * 100 : 0)}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function ProductionPlanningDashboardV2({ data, onMonthChange }: Props) {
  const router = useRouter();

  // Group data by category
  const groupedData = useMemo(() => {
    const groups: Record<string, typeof data.skuData> = {
      cast_iron: [],
      carbon_steel: [],
      accessory: [],
    };

    data.skuData.forEach((sku) => {
      groups[sku.category]?.push(sku);
    });

    // Sort each group by remaining (most to do first)
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => {
        const remainingA = a.monthlyTarget - a.producedMTD;
        const remainingB = b.monthlyTarget - b.producedMTD;
        return remainingB - remainingA;
      });
    });

    return groups;
  }, [data.skuData]);

  const handleRowClick = (sku: string) => {
    router.push(`/production-planning/${encodeURIComponent(sku)}`);
  };

  return (
    <div className="space-y-4 p-4">
      {/* Compact Header */}
      <HeaderBar data={data} onMonthChange={onMonthChange} />

      {/* Yearly Overview - Collapsible */}
      <YearlyOverview
        yearlyTargets={data.yearlyTargets}
        year={data.period.year}
        annualSkuTargets={data.annualSkuTargets}
      />

      {/* Side-by-Side Product Family Columns */}
      <div className="flex gap-4">
        <ProductFamilyColumn
          title="Cast Iron"
          items={groupedData.cast_iron}
          onRowClick={handleRowClick}
        />
        <ProductFamilyColumn
          title="Carbon Steel"
          items={groupedData.carbon_steel}
          onRowClick={handleRowClick}
        />
        <ProductFamilyColumn
          title="Accessories"
          items={groupedData.accessory}
          onRowClick={handleRowClick}
        />
      </div>

      {/* Constrained Items */}
      <ConstrainedItemsSection
        skuData={data.skuData}
        onRowClick={handleRowClick}
      />

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-[var(--color-text-tertiary)]">
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-2 bg-emerald-500 rounded-full" />
          <span>Complete/Ahead</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-2 bg-amber-500 rounded-full" />
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          <span>Constrained</span>
        </div>
      </div>
    </div>
  );
}
