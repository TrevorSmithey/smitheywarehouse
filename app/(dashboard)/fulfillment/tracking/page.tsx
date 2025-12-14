"use client";

import { FulfillmentTracking } from "@/components/FulfillmentTracking";
import { useFulfillment } from "../layout";

export default function TrackingPage() {
  const {
    metrics,
    loading,
    filteredStuckShipments,
    stuckThreshold,
    setStuckThreshold,
    trackingShippedWithin,
    setTrackingShippedWithin,
  } = useFulfillment();

  return (
    <FulfillmentTracking
      metrics={metrics}
      loading={loading}
      filteredStuckShipments={filteredStuckShipments}
      stuckThreshold={stuckThreshold}
      setStuckThreshold={setStuckThreshold}
      trackingShippedWithin={trackingShippedWithin}
      setTrackingShippedWithin={setTrackingShippedWithin}
    />
  );
}
