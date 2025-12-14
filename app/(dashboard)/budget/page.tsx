"use client";

import { useState, useEffect, useCallback } from "react";
import { BudgetDashboard } from "@/components/BudgetDashboard";
import { useDashboard } from "../layout";
import type { BudgetResponse, BudgetDateRange, BudgetChannel } from "@/lib/types";

export default function BudgetPage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();

  const [data, setData] = useState<BudgetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<BudgetDateRange>("mtd");
  const [channel, setChannel] = useState<BudgetChannel>("combined");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(["cast_iron", "carbon_steel", "glass_lid", "accessories"])
  );

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const fetchBudget = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);

      const params = new URLSearchParams();
      params.set("range", dateRange);
      if (dateRange === "custom" && customStart && customEnd) {
        params.set("start", customStart);
        params.set("end", customEnd);
      }

      const res = await fetch(`/api/budget?${params}`);
      if (!res.ok) throw new Error("Failed to fetch budget data");
      const result: BudgetResponse = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Budget fetch error:", err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [dateRange, customStart, customEnd, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with layout
  useEffect(() => {
    setTriggerRefresh(() => fetchBudget);
    return () => setTriggerRefresh(null);
  }, [fetchBudget, setTriggerRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (!data && !loading) {
      fetchBudget();
    }
  }, [data, loading, fetchBudget]);

  // Refetch when filters change
  useEffect(() => {
    if (data) {
      fetchBudget();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customStart, customEnd]);

  return (
    <BudgetDashboard
      data={data}
      loading={loading}
      dateRange={dateRange}
      onDateRangeChange={setDateRange}
      channel={channel}
      onChannelChange={setChannel}
      customStart={customStart}
      customEnd={customEnd}
      onCustomStartChange={setCustomStart}
      onCustomEndChange={setCustomEnd}
      onRefresh={fetchBudget}
      expandedCategories={expandedCategories}
      onToggleCategory={toggleCategory}
    />
  );
}
