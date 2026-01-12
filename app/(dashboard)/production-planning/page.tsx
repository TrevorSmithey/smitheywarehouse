"use client";

import { useState } from "react";
import ProductionPlanningDashboardV2 from "@/components/ProductionPlanningDashboardV2";
import AnnualBudgetTab from "@/components/AnnualBudgetTab";
import { useProductionPlanning } from "./layout";

type Tab = "execute" | "budget";

export default function ProductionPlanningPage() {
  const { data, loading, error, refresh, fetchPeriod } = useProductionPlanning();
  const [activeTab, setActiveTab] = useState<Tab>("execute");

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
      {/* Tab Bar */}
      <div className="px-4 pt-4">
        <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
          <button
            onClick={() => setActiveTab("execute")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === "execute"
                ? "border-sky-500 text-sky-400"
                : "border-transparent text-[var(--color-text-tertiary)] hover:text-white"
            }`}
          >
            Execute
          </button>
          <button
            onClick={() => setActiveTab("budget")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === "budget"
                ? "border-sky-500 text-sky-400"
                : "border-transparent text-[var(--color-text-tertiary)] hover:text-white"
            }`}
          >
            Annual Budget
          </button>
        </div>
      </div>

      
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mx-4 mt-4">
          <strong>Error:</strong> {error}
          <button
            onClick={refresh}
            className="ml-4 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "execute" && data && (
        <ProductionPlanningDashboardV2
          data={data}
          onMonthChange={fetchPeriod}
        />
      )}

      {activeTab === "budget" && data && (
        <AnnualBudgetTab
          annualSkuTargets={data.annualSkuTargets || []}
          year={data.period.year}
          currentMonth={data.period.year === new Date().getFullYear() ? new Date().getMonth() + 1 : 0}
        />
      )}
    </>
  );
}
