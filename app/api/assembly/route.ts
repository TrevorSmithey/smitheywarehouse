import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export interface DailyAssembly {
  date: string;
  daily_total: number;
  day_of_week: string | null;
  week_num: number | null;
  month: number | null;
  year: number | null;
  synced_at?: string;
}

export interface AssemblyTarget {
  sku: string;
  current_inventory: number;
  demand: number;
  current_shortage: number;
  original_plan: number;
  revised_plan: number;
  assembled_since_cutoff: number;
  deficit: number;
  category: string;
  t7?: number; // Trailing 7 days production
}

export interface AssemblyConfig {
  manufacturing_cutoff: string;
  cutoff_start_date: string;
  revised_manufacturing_need: number;
  assembled_since_cutoff: number;
}

export interface AssemblySummary {
  // Daily metrics
  yesterdayProduction: number;
  yesterdayDelta: number; // vs prior day
  dailyAverage7d: number;
  dailyAverageDelta: number; // vs prior 7 days
  currentWeekTotal: number;
  currentWeekDays: number;
  currentWeekDelta: number; // vs prior week (same # days)

  // Targets
  dailyTarget: number;
  weeklyTarget: number;
  daysRemaining: number;

  // Overall progress
  totalDeficit: number; // remaining to produce
  totalAssembled: number;
  totalRevisedPlan: number;
  progressPct: number;

  // Latest data
  latestDate: string | null;
}

export interface WeeklyData {
  week_num: number;
  year: number;
  total: number;
  days_worked: number;
  daily_avg: number;
}

export interface DayOfWeekAvg {
  day: string;
  avg: number;
  count: number;
}

export interface AssemblyResponse {
  daily: DailyAssembly[];
  targets: AssemblyTarget[];
  summary: AssemblySummary;
  weeklyData: WeeklyData[];
  dayOfWeekAvg: DayOfWeekAvg[];
  config: AssemblyConfig;
  lastSynced: string | null;
}

export async function GET() {
  try {
    // Fetch daily data
    const { data: dailyData, error: dailyError } = await supabase
      .from("assembly_daily")
      .select("*")
      .order("date", { ascending: true });

    if (dailyError) throw new Error(`Daily data error: ${dailyError.message}`);

    // Fetch target data
    const { data: targetData, error: targetError } = await supabase
      .from("assembly_targets")
      .select("*")
      .order("sku", { ascending: true });

    if (targetError) throw new Error(`Target data error: ${targetError.message}`);

    // Fetch T7 (trailing 7 days) per SKU
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const t7StartDate = sevenDaysAgo.toISOString().split("T")[0];

    const { data: skuDailyData } = await supabase
      .from("assembly_sku_daily")
      .select("sku, quantity")
      .gte("date", t7StartDate);

    // Aggregate T7 by SKU
    const t7BySku: Record<string, number> = {};
    for (const row of skuDailyData || []) {
      t7BySku[row.sku] = (t7BySku[row.sku] || 0) + row.quantity;
    }

    // Fetch config
    const { data: configData } = await supabase
      .from("assembly_config")
      .select("key, value");

    const configMap: Record<string, string> = {};
    for (const c of configData || []) {
      configMap[c.key] = c.value;
    }

    const config: AssemblyConfig = {
      manufacturing_cutoff: configMap.manufacturing_cutoff || "2025-12-10",
      cutoff_start_date: configMap.cutoff_start_date || "2025-10-21",
      revised_manufacturing_need: Number(configMap.revised_manufacturing_need) || 0,
      assembled_since_cutoff: Number(configMap.assembled_since_cutoff) || 0,
    };

    const daily = (dailyData || []) as DailyAssembly[];
    const targets = (targetData || []).map((t) => ({
      ...t,
      t7: t7BySku[t.sku] || 0,
    })) as AssemblyTarget[];

    // Calculate summary metrics
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // Manufacturing cutoff
    const cutoffDate = new Date(config.manufacturing_cutoff);
    const daysRemaining = Math.max(0, Math.ceil((cutoffDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    // Total deficit (sum of positive deficits)
    const totalDeficit = targets.reduce((sum, t) => sum + Math.max(0, t.deficit), 0);
    const totalAssembled = targets.reduce((sum, t) => sum + t.assembled_since_cutoff, 0);
    const totalRevisedPlan = targets.reduce((sum, t) => sum + t.revised_plan, 0);

    // Daily/weekly targets based on remaining work
    const dailyTarget = daysRemaining > 0 ? Math.ceil(totalDeficit / daysRemaining) : 0;
    const weeklyTarget = dailyTarget * 7;

    // Yesterday's production (most recent day with data)
    const sortedDaily = [...daily].sort((a, b) => b.date.localeCompare(a.date));
    const yesterdayProduction = sortedDaily[0]?.daily_total || 0;
    const latestDate = sortedDaily[0]?.date || null;

    // Prior day production (day before yesterday) for % change
    const priorDayProduction = sortedDaily[1]?.daily_total || 0;
    const yesterdayDelta = priorDayProduction > 0
      ? ((yesterdayProduction - priorDayProduction) / priorDayProduction) * 100
      : 0;

    // 7-day average (last 7 days with data)
    const last7 = sortedDaily.slice(0, 7);
    const dailyAverage7d = last7.length > 0
      ? Math.round(last7.reduce((sum, d) => sum + d.daily_total, 0) / last7.length)
      : 0;

    // Prior 7 days average (days 8-14)
    const prior7 = sortedDaily.slice(7, 14);
    const priorAvg = prior7.length > 0
      ? prior7.reduce((sum, d) => sum + d.daily_total, 0) / prior7.length
      : 0;
    const dailyAverageDelta = priorAvg > 0 ? ((dailyAverage7d - priorAvg) / priorAvg) * 100 : 0;

    // Current week total
    const currentWeekNum = sortedDaily[0]?.week_num;
    const currentWeekYear = sortedDaily[0]?.year;
    const currentWeekDays = daily.filter(
      (d) => d.week_num === currentWeekNum && d.year === currentWeekYear
    );
    const currentWeekTotal = currentWeekDays.reduce((sum, d) => sum + d.daily_total, 0);

    // Prior week total (same number of days for fair comparison)
    const priorWeekNum = currentWeekNum ? currentWeekNum - 1 : null;
    const priorWeekDays = daily.filter(
      (d) => d.week_num === priorWeekNum && d.year === currentWeekYear
    ).sort((a, b) => a.date.localeCompare(b.date)).slice(0, currentWeekDays.length);
    const priorWeekTotal = priorWeekDays.reduce((sum, d) => sum + d.daily_total, 0);
    const currentWeekDelta = priorWeekTotal > 0
      ? ((currentWeekTotal - priorWeekTotal) / priorWeekTotal) * 100
      : 0;

    // Progress percentage
    const progressPct = totalRevisedPlan > 0 ? (totalAssembled / totalRevisedPlan) * 100 : 0;

    const summary: AssemblySummary = {
      yesterdayProduction,
      yesterdayDelta,
      dailyAverage7d,
      dailyAverageDelta,
      currentWeekTotal,
      currentWeekDays: currentWeekDays.length,
      currentWeekDelta,
      dailyTarget,
      weeklyTarget,
      daysRemaining,
      totalDeficit,
      totalAssembled,
      totalRevisedPlan,
      progressPct,
      latestDate,
    };

    // Weekly aggregates
    const weekMap = new Map<string, { total: number; days: number }>();
    for (const d of daily) {
      if (d.week_num && d.year) {
        const key = `${d.year}-W${d.week_num}`;
        const existing = weekMap.get(key) || { total: 0, days: 0 };
        weekMap.set(key, { total: existing.total + d.daily_total, days: existing.days + 1 });
      }
    }

    const weeklyData: WeeklyData[] = [];
    weekMap.forEach((val, key) => {
      const [yearStr, weekStr] = key.split("-W");
      weeklyData.push({
        week_num: parseInt(weekStr),
        year: parseInt(yearStr),
        total: val.total,
        days_worked: val.days,
        daily_avg: Math.round(val.total / val.days),
      });
    });
    weeklyData.sort((a, b) => a.week_num - b.week_num);

    // Day of week averages
    const dowMap = new Map<string, { total: number; count: number }>();
    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

    for (const d of daily) {
      if (d.day_of_week) {
        const existing = dowMap.get(d.day_of_week) || { total: 0, count: 0 };
        dowMap.set(d.day_of_week, { total: existing.total + d.daily_total, count: existing.count + 1 });
      }
    }

    const dayOfWeekAvg: DayOfWeekAvg[] = dayOrder.map((day) => {
      const data = dowMap.get(day) || { total: 0, count: 0 };
      return {
        day,
        avg: data.count > 0 ? Math.round(data.total / data.count) : 0,
        count: data.count,
      };
    });

    // Get sync time
    const lastSynced = sortedDaily[0]?.synced_at || null;

    const response: AssemblyResponse = {
      daily,
      targets,
      summary,
      weeklyData,
      dayOfWeekAvg,
      config,
      lastSynced,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching assembly data:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch assembly data" },
      { status: 500 }
    );
  }
}
