"use client";

import { WholesaleDashboard } from "@/components/WholesaleDashboard";
import { useSales } from "./layout";

export default function SalesPage() {
  const {
    wholesaleData,
    wholesaleLoading,
    period,
    setPeriod,
    refreshWholesale,
  } = useSales();

  return (
    <WholesaleDashboard
      data={wholesaleData}
      loading={wholesaleLoading}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={refreshWholesale}
    />
  );
}
