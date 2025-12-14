"use client";

import { HolidayDashboard } from "@/components/HolidayDashboard";
import { useHoliday } from "./layout";

export default function HolidayPage() {
  const { data, loading, error, refresh } = useHoliday();

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
      <HolidayDashboard
        data={data}
        loading={loading}
        onRefresh={refresh}
      />
    </>
  );
}
