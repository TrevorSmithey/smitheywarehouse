"use client";

import { LeadsDashboard } from "@/components/LeadsDashboard";
import { useSales } from "../layout";

export default function LeadsPage() {
  const {
    leadsData,
    leadsLoading,
    refreshLeads,
  } = useSales();

  return (
    <LeadsDashboard
      data={leadsData}
      loading={leadsLoading}
      onRefresh={refreshLeads}
    />
  );
}
