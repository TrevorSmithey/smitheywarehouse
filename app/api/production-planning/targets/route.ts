/**
 * Production Targets Update API
 *
 * POST: Updates monthly production targets for a given year
 * Used by the Annual Budget tab's CSV import feature
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase credentials");
  return createClient(url, key);
}

interface TargetUpdate {
  sku: string;
  monthlyTargets: number[]; // 12 elements, index 0 = January
}

interface RequestBody {
  year: number;
  updates: TargetUpdate[];
}

export async function POST(request: Request) {
  try {
    const body: RequestBody = await request.json();
    const { year, updates } = body;

    if (!year || !updates || !Array.isArray(updates)) {
      return NextResponse.json(
        { error: "Missing required fields: year and updates" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Build upsert records
    const records: Array<{
      year: number;
      month: number;
      sku: string;
      target: number;
    }> = [];

    for (const update of updates) {
      if (!update.sku || !update.monthlyTargets || update.monthlyTargets.length !== 12) {
        continue; // Skip invalid entries
      }

      for (let month = 1; month <= 12; month++) {
        const target = update.monthlyTargets[month - 1];
        if (typeof target !== "number" || isNaN(target)) continue;

        records.push({
          year,
          month,
          sku: update.sku,
          target,
        });
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: "No valid target updates found" },
        { status: 400 }
      );
    }

    // Upsert in batches
    const BATCH_SIZE = 100;
    let totalUpserted = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const { error } = await supabase
        .from("production_targets")
        .upsert(batch, { onConflict: "year,month,sku" });

      if (error) {
        console.error("Upsert error:", error);
        return NextResponse.json(
          { error: `Database error: ${error.message}` },
          { status: 500 }
        );
      }

      totalUpserted += batch.length;
    }

    const uniqueSkus = new Set(updates.map(u => u.sku)).size;

    return NextResponse.json({
      success: true,
      updated: uniqueSkus,
      records: totalUpserted,
      year,
    });
  } catch (error) {
    console.error("Targets update error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
