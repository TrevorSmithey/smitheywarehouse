/**
 * Verification script for assembly calculations
 * Run with: npx tsx scripts/verify-calculations.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

async function verify() {
  console.log("=== ASSEMBLY CALCULATION VERIFICATION ===\n");

  // Get last 14 days of data for T7 and averages
  const { data: daily } = await supabase
    .from("assembly_daily")
    .select("*")
    .order("date", { ascending: false })
    .limit(14);

  if (!daily || daily.length === 0) {
    console.log("No daily data found");
    return;
  }

  console.log("=== LAST 14 DAYS OF DATA ===");
  for (const d of daily) {
    console.log(`${d.date} | ${d.day_of_week?.padEnd(9) || "N/A"} | ${String(d.daily_total).padStart(5)} | week ${d.week_num}`);
  }

  // Calculate T7 (last 7 days with data)
  const t7Days = daily.slice(0, 7);
  const t7Total = t7Days.reduce((sum, d) => sum + d.daily_total, 0);

  console.log("\n=== T7 (TRAILING 7 DAYS) CALCULATION ===");
  console.log("Days used:", t7Days.map(d => d.date).join(", "));
  console.log("Values:", t7Days.map(d => d.daily_total).join(" + "), "=", t7Total);
  console.log("Number of days:", t7Days.length);

  // 7-day average (API calculation)
  const dailyAverage7d = Math.round(t7Total / t7Days.length);
  console.log("\n=== 7-DAY AVERAGE ===");
  console.log("Formula: sum / count =", t7Total, "/", t7Days.length, "=", dailyAverage7d);

  // Prior T7 (days 8-14)
  const priorT7 = daily.slice(7, 14);
  const priorT7Total = priorT7.reduce((sum, d) => sum + d.daily_total, 0);
  const priorAvg = priorT7.length > 0 ? priorT7Total / priorT7.length : 0;

  console.log("\n=== PRIOR 7 DAYS ===");
  console.log("Days used:", priorT7.map(d => d.date).join(", "));
  console.log("Values:", priorT7.map(d => d.daily_total).join(" + "), "=", priorT7Total);
  console.log("Prior average:", Math.round(priorAvg));

  // Delta calculation
  const t7Delta = priorT7Total > 0 ? ((t7Total - priorT7Total) / priorT7Total * 100) : 0;
  const avgDelta = priorAvg > 0 ? ((dailyAverage7d - priorAvg) / priorAvg * 100) : 0;
  console.log("\n=== DELTA CALCULATIONS ===");
  console.log("T7 Delta:", t7Delta.toFixed(1) + "% (total vs prior total)");
  console.log("Avg Delta:", avgDelta.toFixed(1) + "% (avg vs prior avg)");

  // Current week calculation
  const currentWeekNum = daily[0]?.week_num;
  const currentWeekYear = daily[0]?.year;

  // Get ALL daily data to properly count current week
  const { data: allDaily } = await supabase
    .from("assembly_daily")
    .select("*")
    .order("date", { ascending: false });

  const currentWeekDays = (allDaily || []).filter(
    (d) => d.week_num === currentWeekNum && d.year === currentWeekYear
  );
  const currentWeekTotal = currentWeekDays.reduce((sum, d) => sum + d.daily_total, 0);

  console.log("\n=== CURRENT WEEK ===");
  console.log("Week number:", currentWeekNum, "Year:", currentWeekYear);
  console.log("Days in week:", currentWeekDays.length);
  console.log("Days:", currentWeekDays.map(d => `${d.date}(${d.daily_total})`).join(", "));
  console.log("Week total:", currentWeekTotal);

  // Prior week comparison
  const priorWeekNum = currentWeekNum ? currentWeekNum - 1 : null;
  const priorWeekDays = (allDaily || []).filter(
    (d) => d.week_num === priorWeekNum && d.year === currentWeekYear
  ).sort((a, b) => a.date.localeCompare(b.date)).slice(0, currentWeekDays.length);
  const priorWeekTotal = priorWeekDays.reduce((sum, d) => sum + d.daily_total, 0);

  console.log("\n=== PRIOR WEEK (same # of days) ===");
  console.log("Week number:", priorWeekNum);
  console.log("Days compared:", priorWeekDays.length);
  console.log("Days:", priorWeekDays.map(d => `${d.date}(${d.daily_total})`).join(", "));
  console.log("Prior week total:", priorWeekTotal);

  const weekDelta = priorWeekTotal > 0 ? ((currentWeekTotal - priorWeekTotal) / priorWeekTotal * 100) : 0;
  console.log("Week-over-week delta:", weekDelta.toFixed(1) + "%");

  // Monthly calculations
  console.log("\n=== MONTHLY DATA ===");
  const monthlyData = new Map<string, { total: number; days: number }>();
  for (const d of allDaily || []) {
    if (d.month && d.year) {
      const key = `${d.year}-${String(d.month).padStart(2, "0")}`;
      const existing = monthlyData.get(key) || { total: 0, days: 0 };
      monthlyData.set(key, { total: existing.total + d.daily_total, days: existing.days + 1 });
    }
  }

  const sortedMonths = Array.from(monthlyData.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6);

  for (let i = 0; i < sortedMonths.length; i++) {
    const [key, val] = sortedMonths[i];
    const avg = Math.round(val.total / val.days);
    let momStr = "N/A";
    if (i < sortedMonths.length - 1) {
      const prevAvg = sortedMonths[i + 1][1].total / sortedMonths[i + 1][1].days;
      const mom = ((avg - prevAvg) / prevAvg * 100);
      momStr = (mom >= 0 ? "+" : "") + mom.toFixed(1) + "%";
    }
    console.log(`${key}: Total=${val.total}, Days=${val.days}, Avg=${avg}, MoM=${momStr}`);
  }

  // Day of week averages
  console.log("\n=== DAY OF WEEK AVERAGES ===");
  const dowMap = new Map<string, { total: number; count: number }>();
  for (const d of allDaily || []) {
    if (d.day_of_week) {
      const existing = dowMap.get(d.day_of_week) || { total: 0, count: 0 };
      dowMap.set(d.day_of_week, { total: existing.total + d.daily_total, count: existing.count + 1 });
    }
  }

  const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  for (const day of dayOrder) {
    const data = dowMap.get(day);
    if (data && data.count > 0) {
      console.log(`${day.padEnd(10)}: ${Math.round(data.total / data.count)} avg (${data.count} days)`);
    }
  }
}

verify().catch(console.error);
