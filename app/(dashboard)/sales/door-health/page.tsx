"use client";

import { DoorHealthDashboard } from "@/components/DoorHealthDashboard";
import { useSales } from "../layout";

export default function DoorHealthPage() {
  const { doorHealthData, doorHealthLoading, doorHealthError, refreshDoorHealth } = useSales();

  return (
    <DoorHealthDashboard
      data={doorHealthData}
      loading={doorHealthLoading}
      error={doorHealthError}
      onRefresh={refreshDoorHealth}
    />
  );
}
