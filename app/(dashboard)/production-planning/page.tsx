"use client";

import { useState } from "react";
import ProductionPlanningDashboard from "@/components/ProductionPlanningDashboard";
import ProductionPlanningDashboardV2 from "@/components/ProductionPlanningDashboardV2";
import { useProductionPlanning } from "./layout";

export default function ProductionPlanningPage() {
  const { data, loading, error, refresh, fetchPeriod } = useProductionPlanning();
  const [useV2, setUseV2] = useState(true); // Default to V2

  // Loading state
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent-blue)] border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      {/* Version Toggle (for review - remove after decision) */}
      <div className="fixed bottom-4 right-4 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)]
                      rounded-lg p-2 shadow-lg flex items-center gap-2">
        <span className="text-xs text-[var(--color-text-tertiary)]">Version:</span>
        <button
          onClick={() => setUseV2(false)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            !useV2
              ? 'bg-[var(--color-accent-blue)] text-white'
              : 'text-[var(--color-text-tertiary)] hover:text-white'
          }`}
        >
          V1
        </button>
        <button
          onClick={() => setUseV2(true)}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
            useV2
              ? 'bg-[var(--color-accent-blue)] text-white'
              : 'text-[var(--color-text-tertiary)] hover:text-white'
          }`}
        >
          V2
        </button>
      </div>

      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button
            onClick={refresh}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {useV2 && data ? (
        <ProductionPlanningDashboardV2
          data={data}
          onMonthChange={fetchPeriod}
        />
      ) : (
        <ProductionPlanningDashboard
          data={data}
          loading={loading}
          onRefresh={refresh}
          onPeriodChange={fetchPeriod}
        />
      )}
    </>
  );
}
