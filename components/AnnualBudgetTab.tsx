"use client";

import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import type { AnnualSkuTarget } from "@/app/api/production-planning/route";

const MONTH_ABBREVS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  annualSkuTargets: AnnualSkuTarget[];
  year: number;
  currentMonth: number; // 1-indexed
}

export default function AnnualBudgetTab({ annualSkuTargets, year, currentMonth }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Group by category
  const grouped = {
    cast_iron: annualSkuTargets.filter(s => s.category === 'cast_iron'),
    carbon_steel: annualSkuTargets.filter(s => s.category === 'carbon_steel'),
    accessory: annualSkuTargets.filter(s => s.category === 'accessory'),
  };

  const categoryLabels: Record<string, string> = {
    cast_iron: 'Cast Iron',
    carbon_steel: 'Carbon Steel',
    accessory: 'Accessories',
  };

  const totalBudget = annualSkuTargets.reduce((sum, s) => sum + s.annualTarget, 0);

  // Calculate monthly totals across all SKUs
  const monthlyTotals = Array(12).fill(0);
  for (const sku of annualSkuTargets) {
    if (sku.monthlyTargets) {
      sku.monthlyTargets.forEach((val, idx) => {
        monthlyTotals[idx] += val;
      });
    }
  }

  // Export to CSV
  const handleExport = () => {
    const headers = ['SKU', 'Category', ...MONTH_ABBREVS, 'Total'];
    const rows = annualSkuTargets.map(sku => [
      sku.displayName,
      sku.category,
      ...(sku.monthlyTargets || Array(12).fill(0)),
      sku.annualTarget,
    ]);

    // Add category subtotals
    Object.entries(grouped).forEach(([category, items]) => {
      if (items.length === 0) return;
      const catMonthlyTotals = Array(12).fill(0);
      items.forEach(sku => {
        (sku.monthlyTargets || []).forEach((val, idx) => {
          catMonthlyTotals[idx] += val;
        });
      });
      const catTotal = catMonthlyTotals.reduce((a, b) => a + b, 0);
      rows.push([
        `${categoryLabels[category]} Subtotal`,
        '',
        ...catMonthlyTotals,
        catTotal,
      ]);
    });

    // Add grand total
    rows.push(['GRAND TOTAL', '', ...monthlyTotals, totalBudget]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `production-budget-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import from CSV
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.trim().split('\n');

    // Skip header row
    const dataRows = lines.slice(1);

    // Parse CSV - expect: SKU, Category, Jan, Feb, ..., Dec, Total
    const updates: Array<{ sku: string; monthlyTargets: number[] }> = [];

    for (const line of dataRows) {
      const cols = line.split(',');
      if (cols.length < 14) continue; // Need at least SKU + Category + 12 months

      const displayName = cols[0].trim();
      // Skip subtotal/total rows
      if (displayName.includes('Subtotal') || displayName === 'GRAND TOTAL') continue;

      const monthlyTargets = cols.slice(2, 14).map(v => parseInt(v) || 0);

      // Find matching SKU by display name
      const match = annualSkuTargets.find(s => s.displayName === displayName);
      if (match) {
        updates.push({ sku: match.sku, monthlyTargets });
      }
    }

    if (updates.length === 0) {
      alert('No valid rows found in CSV. Make sure SKU names match exactly.');
      return;
    }

    // Call API to update targets
    try {
      const response = await fetch('/api/production-planning/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, updates }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update targets');
      }

      const result = await response.json();
      alert(`Updated ${result.updated} SKU targets. Refresh the page to see changes.`);

      // Refresh the page
      window.location.reload();
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-semibold text-lg">
            {year} Monthly Production Budget
          </h2>
          <p className="text-[var(--color-text-tertiary)] text-sm mt-0.5">
            {totalBudget.toLocaleString()} total units · {annualSkuTargets.length} SKUs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                       bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]
                       hover:text-white hover:bg-[var(--color-bg-secondary)] transition-colors
                       border border-[var(--color-border)]"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
                       bg-sky-600 text-white hover:bg-sky-500 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-220px)]">
          {Object.entries(grouped).map(([category, items]) => {
            if (items.length === 0) return null;

            // Category monthly totals
            const catMonthlyTotals = Array(12).fill(0);
            for (const sku of items) {
              (sku.monthlyTargets || []).forEach((val, idx) => {
                catMonthlyTotals[idx] += val;
              });
            }
            const catTotal = catMonthlyTotals.reduce((a, b) => a + b, 0);

            return (
              <div key={category} className="border-b border-[var(--color-border)] last:border-b-0">
                {/* Category Header Row */}
                <div className="bg-[var(--color-bg-tertiary)] px-4 py-2 flex items-center gap-2 sticky top-0 z-10">
                  <h3 className="text-[var(--color-text-secondary)] text-xs uppercase tracking-wider font-medium">
                    {categoryLabels[category]}
                  </h3>
                  <span className="text-[var(--color-text-tertiary)] text-xs">
                    ({catTotal.toLocaleString()} units)
                  </span>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)]">
                        <th className="text-left px-3 py-2 text-[var(--color-text-tertiary)] font-medium uppercase tracking-wide sticky left-0 bg-[var(--color-bg-secondary)] min-w-[160px]">
                          SKU
                        </th>
                        {MONTH_ABBREVS.map((m, idx) => (
                          <th
                            key={m}
                            className={`text-right px-2 py-2 font-medium uppercase tracking-wide min-w-[55px]
                              ${idx + 1 === currentMonth
                                ? 'text-sky-400 bg-sky-500/10'
                                : 'text-[var(--color-text-tertiary)]'
                              }`}
                          >
                            {m}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 text-white font-medium uppercase tracking-wide min-w-[70px] bg-[var(--color-bg-tertiary)]">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]/30">
                      {items.map((sku) => (
                        <tr key={sku.sku} className="hover:bg-[var(--color-bg-tertiary)]/30">
                          <td className="px-3 py-2.5 text-white sticky left-0 bg-[var(--color-bg-secondary)] font-medium">
                            {sku.displayName}
                          </td>
                          {(sku.monthlyTargets || Array(12).fill(0)).map((val, idx) => (
                            <td
                              key={idx}
                              className={`px-2 py-2.5 text-right tabular-nums
                                ${idx + 1 === currentMonth
                                  ? 'text-sky-400 bg-sky-500/10 font-medium'
                                  : val > 0
                                    ? 'text-[var(--color-text-secondary)]'
                                    : 'text-[var(--color-text-tertiary)]/50'
                                }`}
                            >
                              {val > 0 ? val.toLocaleString() : '—'}
                            </td>
                          ))}
                          <td className="px-3 py-2.5 text-right text-white tabular-nums font-medium bg-[var(--color-bg-tertiary)]">
                            {sku.annualTarget.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {/* Category Total Row */}
                      <tr className="bg-[var(--color-bg-tertiary)]/50 font-medium">
                        <td className="px-3 py-2 text-[var(--color-text-secondary)] sticky left-0 bg-[var(--color-bg-tertiary)]/50">
                          Subtotal
                        </td>
                        {catMonthlyTotals.map((val, idx) => (
                          <td
                            key={idx}
                            className={`px-2 py-2 text-right tabular-nums
                              ${idx + 1 === currentMonth
                                ? 'text-sky-400'
                                : 'text-[var(--color-text-secondary)]'
                              }`}
                          >
                            {val > 0 ? val.toLocaleString() : '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right text-white tabular-nums bg-[var(--color-bg-tertiary)]">
                          {catTotal.toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Grand Total Row */}
          <div className="bg-[var(--color-bg-tertiary)] border-t border-[var(--color-border)] sticky bottom-0">
            <table className="w-full text-xs">
              <tbody>
                <tr className="font-semibold">
                  <td className="px-3 py-3 text-white sticky left-0 bg-[var(--color-bg-tertiary)] min-w-[160px]">
                    GRAND TOTAL
                  </td>
                  {monthlyTotals.map((val, idx) => (
                    <td
                      key={idx}
                      className={`px-2 py-3 text-right tabular-nums min-w-[55px]
                        ${idx + 1 === currentMonth
                          ? 'text-sky-400'
                          : 'text-white'
                        }`}
                    >
                      {val.toLocaleString()}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right text-white tabular-nums min-w-[70px]">
                    {totalBudget.toLocaleString()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
