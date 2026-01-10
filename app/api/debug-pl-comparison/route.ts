/**
 * P&L Comparison API - 2024 vs 2025
 *
 * Compares YTD data between years for Fathom validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

interface MonthlyRecord {
  year_month: string;
  channel: string;
  category: string;
  revenue: number;
}

interface CategoryTotal {
  category: string;
  total: number;
  web: number;
  wholesale: number;
}

interface YearSummary {
  year: number;
  grossRevenue: number;
  discounts: number;
  netRevenue: number;
  byCategory: CategoryTotal[];
  byMonth: { month: string; total: number }[];
  webRevenue: number;
  wholesaleRevenue: number;
}

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  const supabase = createServiceClient();

  // Get current month for YTD comparison (same period both years)
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Fetch all data from both years
  const { data: allData, error } = await supabase
    .from("ns_pl_monthly")
    .select("*")
    .in("year_month", generateYearMonths(2024, 2025))
    .order("year_month");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const records = allData as MonthlyRecord[];

  // Split by year
  const data2024 = records.filter(r => r.year_month.startsWith("2024"));
  const data2025 = records.filter(r => r.year_month.startsWith("2025"));

  // Calculate summaries (YTD through current month for apples-to-apples)
  const ytdMonth2024 = data2024.filter(r => {
    const month = parseInt(r.year_month.split("-")[1]);
    return month <= currentMonth;
  });

  const ytdMonth2025 = data2025.filter(r => {
    const month = parseInt(r.year_month.split("-")[1]);
    return month <= currentMonth;
  });

  const summary2024 = calculateSummary(ytdMonth2024, 2024);
  const summary2025 = calculateSummary(ytdMonth2025, 2025);

  // Full year 2024 for reference
  const fullYear2024 = calculateSummary(data2024, 2024);

  // Calculate YoY changes
  const yoyChanges = {
    grossRevenue: calculateYoY(summary2024.grossRevenue, summary2025.grossRevenue),
    netRevenue: calculateYoY(summary2024.netRevenue, summary2025.netRevenue),
    discounts: calculateYoY(summary2024.discounts, summary2025.discounts),
    webRevenue: calculateYoY(summary2024.webRevenue, summary2025.webRevenue),
    wholesaleRevenue: calculateYoY(summary2024.wholesaleRevenue, summary2025.wholesaleRevenue),
  };

  return NextResponse.json({
    comparisonPeriod: `Jan-${getMonthName(currentMonth)} (YTD)`,
    currentMonth: currentMonth,

    ytd2024: summary2024,
    ytd2025: summary2025,
    fullYear2024: fullYear2024,

    yoyChanges,

    // Detailed breakdown for validation
    monthlyComparison: buildMonthlyComparison(ytdMonth2024, ytdMonth2025),

    // Category breakdown for Fathom comparison
    categoryComparison: buildCategoryComparison(summary2024, summary2025),
  });
}

function generateYearMonths(startYear: number, endYear: number): string[] {
  const months: string[] = [];
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      months.push(`${year}-${month.toString().padStart(2, "0")}`);
    }
  }
  return months;
}

function calculateSummary(records: MonthlyRecord[], year: number): YearSummary {
  const byCategory: Record<string, CategoryTotal> = {};
  const byMonth: Record<string, number> = {};

  let webTotal = 0;
  let wholesaleTotal = 0;

  for (const record of records) {
    const amount = record.revenue || 0;
    const month = record.year_month.split("-")[1];

    // Category totals
    if (!byCategory[record.category]) {
      byCategory[record.category] = {
        category: record.category,
        total: 0,
        web: 0,
        wholesale: 0,
      };
    }
    byCategory[record.category].total += amount;

    if (record.channel === "Web") {
      byCategory[record.category].web += amount;
      webTotal += amount;
    } else if (record.channel === "Wholesale") {
      byCategory[record.category].wholesale += amount;
      wholesaleTotal += amount;
    }

    // Monthly totals
    if (!byMonth[month]) byMonth[month] = 0;
    byMonth[month] += amount;
  }

  // Calculate gross revenue (exclude Discounts)
  let grossRevenue = 0;
  let discounts = 0;

  for (const cat of Object.values(byCategory)) {
    if (cat.category === "Discounts") {
      discounts = cat.total;
    } else {
      grossRevenue += cat.total;
    }
  }

  const netRevenue = grossRevenue + discounts; // discounts is negative

  // Adjust web/wholesale totals to exclude discounts for gross
  const webDiscounts = byCategory["Discounts"]?.web || 0;
  const wholesaleDiscounts = byCategory["Discounts"]?.wholesale || 0;

  return {
    year,
    grossRevenue,
    discounts,
    netRevenue,
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    byMonth: Object.entries(byMonth)
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    webRevenue: webTotal - webDiscounts, // Gross web revenue
    wholesaleRevenue: wholesaleTotal - wholesaleDiscounts, // Gross wholesale revenue
  };
}

function calculateYoY(prev: number, current: number): { amount: number; percent: number } {
  const amount = current - prev;
  const percent = prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : 0;
  return { amount, percent };
}

function getMonthName(month: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[month - 1];
}

function buildMonthlyComparison(data2024: MonthlyRecord[], data2025: MonthlyRecord[]) {
  const months: Record<string, { month: string; total2024: number; total2025: number; yoyPercent: number }> = {};

  for (const r of data2024) {
    const month = r.year_month.split("-")[1];
    if (!months[month]) months[month] = { month, total2024: 0, total2025: 0, yoyPercent: 0 };
    if (r.category !== "Discounts") {
      months[month].total2024 += r.revenue || 0;
    }
  }

  for (const r of data2025) {
    const month = r.year_month.split("-")[1];
    if (!months[month]) months[month] = { month, total2024: 0, total2025: 0, yoyPercent: 0 };
    if (r.category !== "Discounts") {
      months[month].total2025 += r.revenue || 0;
    }
  }

  // Calculate YoY
  for (const m of Object.values(months)) {
    m.yoyPercent = m.total2024 !== 0 ? ((m.total2025 - m.total2024) / m.total2024) * 100 : 0;
  }

  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
}

function buildCategoryComparison(summary2024: YearSummary, summary2025: YearSummary) {
  const categories = new Set<string>();
  summary2024.byCategory.forEach(c => categories.add(c.category));
  summary2025.byCategory.forEach(c => categories.add(c.category));

  const result: { category: string; total2024: number; total2025: number; yoyPercent: number }[] = [];

  for (const cat of categories) {
    const cat2024 = summary2024.byCategory.find(c => c.category === cat);
    const cat2025 = summary2025.byCategory.find(c => c.category === cat);

    const total2024 = cat2024?.total || 0;
    const total2025 = cat2025?.total || 0;
    const yoyPercent = total2024 !== 0 ? ((total2025 - total2024) / Math.abs(total2024)) * 100 : 0;

    result.push({ category: cat, total2024, total2025, yoyPercent });
  }

  return result.sort((a, b) => b.total2025 - a.total2025);
}
