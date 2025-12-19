"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "../layout";
import { EcommerceAnalyticsDashboard } from "@/components/EcommerceAnalyticsDashboard";

export type AnalyticsPeriod = "mtd" | "last_month" | "qtd" | "ytd" | "30d" | "90d" | "12m";

export interface AnalyticsData {
  summary: {
    totalRevenue: number;
    revenueDelta: number;
    revenueDeltaPct: number;
    totalOrders: number;
    ordersDelta: number;
    avgOrderValue: number;
    aovDelta: number;
    aovDeltaPct: number;
    totalCustomers: number;
    repeatPurchaseRate: number;
    avgCustomerLTV: number;
  };
  acquisition: {
    newVsReturning: {
      newCustomers: number;
      newRevenue: number;
      newOrders: number;
      returningCustomers: number;
      returningRevenue: number;
      returningOrders: number;
      newRevenuePct: number;
    };
    monthlyTrends: Array<{
      month: string;
      newCustomerOrders: number;
      returningCustomerOrders: number;
      newCustomerRevenue: number;
      returningCustomerRevenue: number;
      newCustomers: number;
      returningCustomers: number;
    }>;
  };
  segments: {
    new: { count: number; revenue: number; avgLTV: number; avgOrders?: number; definition?: string };
    active: { count: number; revenue: number; avgLTV: number; avgOrders?: number; definition?: string };
    at_risk: { count: number; revenue: number; avgLTV: number; avgOrders?: number; definition?: string };
    churned: { count: number; revenue: number; avgLTV: number; avgOrders?: number; definition?: string };
    vip: { count: number; revenue: number; avgLTV: number; avgOrders?: number; definition?: string };
    total?: number;
  };
  cohorts?: Array<{
    cohort: string;
    cohortSize: number;
    returned: number;
    returnRate: number;
    m1: number;
    m2: number;
    m3: number;
    m6: number;
    m12: number;
  }>;
  discounts: {
    ordersWithDiscount: number;
    totalDiscountAmount: number;
    discountRate: number;
    avgDiscountPerOrder: number;
    discountedAOV: number;
    nonDiscountedAOV: number;
    topCodes: Array<{
      code: string;
      usageCount: number;
      totalRevenue: number;
      totalDiscount: number;
      avgOrderValue: number;
    }>;
  };
  geographic: {
    topStates: Array<{
      provinceCode: string;
      provinceName: string;
      countryCode: string;
      orderCount: number;
      totalRevenue: number;
      uniqueCustomers: number;
      avgOrderValue: number;
    }>;
    stateHeatMap: Record<string, number>;
  };
  abandonedCheckouts: {
    total: number;
    totalValue: number;
    recovered: number;
    recoveryRate: number;
    avgCartValue: number;
  };
  sessionMetrics: {
    currentMonth: {
      webSessions: number;
      webOrders: number;
      conversionRate: number;
      newCustomers: number;
      newCustomerRevenue: number;
      newCustomerAOV: number;
      returningCustomers: number;
      returningCustomerRevenue: number;
      returningCustomerAOV: number;
    } | null;
    priorMonth: {
      webSessions: number;
      webOrders: number;
      conversionRate: number;
    } | null;
    ytd: {
      totalSessions: number;
      totalOrders: number;
      avgConversionRate: number;
      priorYearSessions: number;
      priorYearOrders: number;
    };
    monthlyTrends: Array<{
      month: string;
      webSessions: number;
      webOrders: number;
      conversionRate: number;
      priorYearSessions: number;
      priorYearOrders: number;
      priorYearConversion: number;
    }>;
  };
  reengagement?: {
    day90: { count: number; label: string };
    day180: { count: number; label: string };
    day365: { count: number; label: string };
    lapsedVips: { count: number; label: string };
  };
  productInsights?: {
    repeatRates: Array<{
      product_title: string;
      category: string;
      first_buyers: number;
      repeat_buyers: number;
      repeat_rate: number;
      avg_days_to_second: number;
    }>;
    crossSells: Array<{
      second_product: string;
      sequence_count: number;
      avg_days_between: number;
    }>;
    basketPairs: Array<{
      product_a: string;
      product_b: string;
      co_occurrence: number;
      confidence: number;
    }>;
    computed_at: string | null;
  };
  period: string;
  dateRange: {
    start: string;
    end: string;
  };
}

export default function EcommercePage() {
  const { setLastRefresh, setIsRefreshing, setTriggerRefresh } = useDashboard();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>("ytd");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setIsRefreshing(true);
      setError(null);

      const res = await fetch(`/api/analytics?period=${period}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch analytics (${res.status})`);
      }

      const result: AnalyticsData = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Analytics fetch error:", message);
      setError(message);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [period, setLastRefresh, setIsRefreshing]);

  // Register refresh handler with parent layout
  useEffect(() => {
    setTriggerRefresh(() => fetchData);
    return () => setTriggerRefresh(null);
  }, [fetchData, setTriggerRefresh]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <EcommerceAnalyticsDashboard
      data={data}
      loading={loading}
      error={error}
      period={period}
      onPeriodChange={setPeriod}
      onRefresh={fetchData}
    />
  );
}
