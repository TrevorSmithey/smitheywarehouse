"use client";

import { KlaviyoDashboard } from "@/components/KlaviyoDashboard";
import { useMarketing } from "./layout";

export default function MarketingPage() {
  const { data, loading, period, setPeriod, refresh } = useMarketing();

  return (
    <KlaviyoDashboard
      data={data}
      loading={loading}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={refresh}
    />
  );
}
