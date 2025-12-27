"use client";

import { RevenueTrackerDashboard } from "@/components/RevenueTrackerDashboard";
import { useRevenueTracker } from "./layout";

export default function RevenueTrackerPage() {
  const {
    data,
    loading,
    error,
    refresh,
    setSelectedYear,
    availableYears,
    setPeriodMode,
    channel,
    setChannel
  } = useRevenueTracker();

  return (
    <>
      {error && (
        <div className="bg-status-bad/10 border border-status-bad/30 rounded-lg p-4 text-status-bad text-sm mb-4">
          <strong>Error:</strong> {error}
          <button onClick={refresh} className="ml-4 underline hover:no-underline">
            Retry
          </button>
        </div>
      )}
      <RevenueTrackerDashboard
        data={data}
        loading={loading}
        onRefresh={refresh}
        onYearChange={setSelectedYear}
        onPeriodChange={setPeriodMode}
        availableYears={availableYears}
        channel={channel}
        onChannelChange={setChannel}
      />
    </>
  );
}
