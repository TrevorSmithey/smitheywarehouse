"use client";

import { FulfillmentTracking } from "@/components/FulfillmentTracking";
import { useFulfillment } from "../layout";

/**
 * Fulfillment Analysis Page
 *
 * "How are we performing over time?"
 *
 * Contains:
 *   - Summary cards (Total Shipped, Delivered, Avg Transit)
 *   - Fulfillment Volume trend chart
 *   - Lead Time trend chart
 *   - Backlog trend chart
 *   - US Transit Map
 */
export default function FulfillmentAnalysisPage() {
  const {
    metrics,
    loading,
    chartData,
  } = useFulfillment();

  return (
    <FulfillmentTracking
      metrics={metrics}
      loading={loading}
      chartData={chartData}
    />
  );
}
