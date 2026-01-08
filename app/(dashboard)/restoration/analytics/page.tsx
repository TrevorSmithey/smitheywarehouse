"use client";

import { useState, useCallback } from "react";
import { useRestoration } from "../layout";
import { RestorationAnalytics } from "@/components/restorations/RestorationAnalytics";
import { RestorationDetailModal } from "@/components/restorations/RestorationDetailModal";
import type { RestorationRecord } from "@/app/api/restorations/route";

export default function RestorationAnalyticsPage() {
  const { data, loading, error, refresh, dateRange, setDateRange } = useRestoration();
  const [selectedRestoration, setSelectedRestoration] = useState<RestorationRecord | null>(null);

  const handleItemClick = useCallback((restoration: RestorationRecord) => {
    setSelectedRestoration(restoration);
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelectedRestoration(null);
  }, []);

  const handleSave = useCallback(() => {
    refresh();
    setSelectedRestoration(null);
  }, [refresh]);

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
        onItemClick={handleItemClick}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />
      <RestorationDetailModal
        isOpen={!!selectedRestoration}
        onClose={handleCloseModal}
        restoration={selectedRestoration}
        onSave={handleSave}
      />
    </>
  );
}
