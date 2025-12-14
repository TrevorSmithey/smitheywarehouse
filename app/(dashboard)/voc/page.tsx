"use client";

import { VoiceOfCustomerDashboard } from "@/components/VoiceOfCustomerDashboard";
import { useVOC } from "./layout";

export default function VOCPage() {
  const {
    data,
    loading,
    error,
    dateRange,
    setDateRange,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    categoryFilter,
    setCategoryFilter,
    sentimentFilter,
    setSentimentFilter,
    search,
    setSearch,
    page,
    setPage,
    refresh,
  } = useVOC();

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
      <VoiceOfCustomerDashboard
        data={data}
        loading={loading}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        customStart={customStart}
        customEnd={customEnd}
        onCustomStartChange={setCustomStart}
        onCustomEndChange={setCustomEnd}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        sentimentFilter={sentimentFilter}
        onSentimentFilterChange={setSentimentFilter}
        search={search}
        onSearchChange={setSearch}
        page={page}
        onPageChange={setPage}
      />
    </>
  );
}
