/**
 * Production Targets Update API
 *
 * POST: Updates monthly production targets for a given year
 * Used by the Annual Budget tab's CSV import feature
 *
 * All changes are logged to budget_changelog for historical tracking.
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
  reason?: string; // Optional reason for the change
}

export async function POST(request: Request) {
  try {
    const body: RequestBody = await request.json();
    const { year, updates, reason } = body;

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

    // Fetch existing targets to capture old values for changelog
    const skusToUpdate = [...new Set(records.map((r) => r.sku))];
    const { data: existingTargets } = await supabase
      .from("production_targets")
      .select("year, month, sku, target")
      .eq("year", year)
      .in("sku", skusToUpdate);

    // Create a map of existing values: "sku-month" -> target
    const existingMap = new Map<string, number>();
    for (const t of existingTargets || []) {
      existingMap.set(`${t.sku}-${t.month}`, t.target);
    }

    // Track changes for changelog
    const changes: Array<{
      sku: string;
      month: number;
      old_target: number | null;
      new_target: number;
    }> = [];

    for (const record of records) {
      const key = `${record.sku}-${record.month}`;
      const oldValue = existingMap.get(key) ?? null;

      // Only log if value actually changed
      if (oldValue !== record.target) {
        changes.push({
          sku: record.sku,
          month: record.month,
          old_target: oldValue,
          new_target: record.target,
        });
      }
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

    // Log changes to budget_changelog
    if (changes.length > 0) {
      // Group changes by SKU for more readable changelog entries
      const changesBySku = new Map<string, typeof changes>();
      for (const change of changes) {
        const existing = changesBySku.get(change.sku) || [];
        existing.push(change);
        changesBySku.set(change.sku, existing);
      }

      const changelogRecords: Array<{
        field_changed: string;
        category: string | null;
        sku: string;
        old_value: object;
        new_value: object;
        reason: string | null;
        changed_by: string;
      }> = [];

      for (const [sku, skuChanges] of changesBySku) {
        // Build old and new values as month -> target maps
        const oldMonthlyTargets: Record<number, number | null> = {};
        const newMonthlyTargets: Record<number, number> = {};

        for (const change of skuChanges) {
          oldMonthlyTargets[change.month] = change.old_target;
          newMonthlyTargets[change.month] = change.new_target;
        }

        changelogRecords.push({
          field_changed: "production_target",
          category: sku.startsWith("Smith-CI-") ? "cast_iron" : sku.startsWith("Smith-CS-") ? "carbon_steel" : "other",
          sku,
          old_value: { year, monthlyTargets: oldMonthlyTargets },
          new_value: { year, monthlyTargets: newMonthlyTargets },
          reason: reason || null,
          changed_by: "ui", // Could be enhanced to track actual user
        });
      }

      // Insert changelog entries
      const { error: changelogError } = await supabase
        .from("budget_changelog")
        .insert(changelogRecords);

      if (changelogError) {
        // Don't fail the main operation for changelog errors, just log
        console.error("Failed to write changelog:", changelogError);
      } else {
        console.log(`[BUDGET CHANGELOG] Logged ${changelogRecords.length} target changes for year ${year}`);
      }
    }

    const uniqueSkus = new Set(updates.map((u) => u.sku)).size;

    return NextResponse.json({
      success: true,
      updated: uniqueSkus,
      records: totalUpserted,
      changes: changes.length,
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
