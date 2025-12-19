"use client";

import { LeadsDashboard } from "@/components/LeadsDashboard";
import { useSales } from "../layout";

export default function LeadsPage() {
  const {
    leadsData,
    leadsLoading,
    leadsError,
    refreshLeads,
  } = useSales();

  return (
    <LeadsDashboard
      data={leadsData}
      loading={leadsLoading}
      error={leadsError}
      onRefresh={refreshLeads}
    />
  );
}
