"use client";

import { WholesaleDashboard } from "@/components/WholesaleDashboard";
import { useSales } from "./layout";

export default function SalesPage() {
  const {
    wholesaleData,
    wholesaleLoading,
    wholesaleError,
    period,
    setPeriod,
    refreshWholesale,
  } = useSales();

  return (
    <WholesaleDashboard
      data={wholesaleData}
      loading={wholesaleLoading}
      error={wholesaleError}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={refreshWholesale}
    />
  );
}
