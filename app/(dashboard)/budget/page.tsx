"use client";

import { BudgetDashboard } from "@/components/BudgetDashboard";
import { useBudget } from "./layout";

export default function BudgetPage() {
  const {
    data,
    loading,
    dateRange,
    setDateRange,
    channel,
    setChannel,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    expandedCategories,
    toggleCategory,
    refresh,
  } = useBudget();

  return (
    <BudgetDashboard
      data={data}
      loading={loading}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      channel={channel}
      onChannelChange={setChannel}
      customStart={customStart}
      customEnd={customEnd}
      onCustomStartChange={setCustomStart}
      onCustomEndChange={setCustomEnd}
      onRefresh={refresh}
      expandedCategories={expandedCategories}
      onToggleCategory={toggleCategory}
    />
  );
}
