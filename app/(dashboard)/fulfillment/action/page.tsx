"use client";

import { FulfillmentDashboard } from "@/components/FulfillmentDashboard";
import { StuckShipments } from "@/components/fulfillment";
import { useFulfillment } from "../layout";

/**
 * Fulfillment Action Page
 *
 * "What needs my attention right now?"
 *
 * Contains:
 *   - Hero Section (5 cards)
 *   - Warehouse Cards (Smithey/Selery)
 *   - Fulfillment Trend Chart
 *   - Queue Aging (collapsible)
 *   - Stuck Shipments (redesigned)
 */
export default function FulfillmentActionPage() {
  const {
    metrics,
    loading,
    dateRangeOption,
    setDateRangeOption,
    chartData,
    filteredStuckShipments,
    stuckThreshold,
    setStuckThreshold,
    trackingShippedWithin,
    setTrackingShippedWithin,
  } = useFulfillment();

  return (
    <>
      <FulfillmentDashboard
        metrics={metrics}
        loading={loading}
        dateRangeOption={dateRangeOption}
        onDateRangeChange={setDateRangeOption}
        chartData={chartData}
      />

      {/* Stuck Shipments - Actionable insight about shipments needing attention */}
      <div className="mt-6">
        <StuckShipments
          shipments={filteredStuckShipments}
          threshold={stuckThreshold}
          trackingShippedWithin={trackingShippedWithin}
          setTrackingShippedWithin={setTrackingShippedWithin}
          stuckThreshold={stuckThreshold}
          setStuckThreshold={setStuckThreshold}
        />
      </div>
    </>
  );
}
