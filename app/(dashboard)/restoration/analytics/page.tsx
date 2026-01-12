"use client";

import { useRestoration } from "../layout";
import { RestorationAnalytics } from "@/components/restorations/RestorationAnalytics";

export default function RestorationAnalyticsPage() {
  const {
    data,
    loading,
    error,
    refresh,
    dateRange,
    setDateRange,
    openRestoration,
  } = useRestoration();

  return (
    <>
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
      <RestorationAnalytics
        data={data}
        loading={loading}
        onRefresh={refresh}
        onItemClick={openRestoration}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />
    </>
  );
}
