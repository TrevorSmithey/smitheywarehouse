"use client";

import { FulfillmentDashboard } from "@/components/FulfillmentDashboard";
import { useFulfillment } from "./layout";

export default function FulfillmentPage() {
  const {
    metrics,
    loading,
    dateRangeOption,
    setDateRangeOption,
    chartData,
  } = useFulfillment();

  return (
    <FulfillmentDashboard
      metrics={metrics}
      loading={loading}
      dateRangeOption={dateRangeOption}
      onDateRangeChange={setDateRangeOption}
      chartData={chartData}
    />
  );
}
