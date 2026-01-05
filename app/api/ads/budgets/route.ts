/**
 * Budget Management API
 *
 * POST /api/ads/budgets - Create or update a monthly budget
 * GET /api/ads/budgets - Get all budgets for the current year
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Get all budgets for the current year
 */
export async function GET() {
  const supabase = createServiceClient();

  // Get budgets for current year
  const currentYear = new Date().getFullYear();
  const startOfYear = `${currentYear}-01-01`;
  const endOfYear = `${currentYear}-12-31`;

  const { data, error } = await supabase
    .from("ad_budgets")
    .select("*")
    .gte("month", startOfYear)
    .lte("month", endOfYear)
    .order("month", { ascending: false });

  if (error) {
    console.error("[BUDGETS] Error fetching budgets:", error);
    return NextResponse.json(
      { error: "Failed to fetch budgets" },
      { status: 500 }
    );
  }

  return NextResponse.json({ budgets: data || [] });
}

/**
 * Create or update a monthly budget
 */
export async function POST(request: Request) {
  const supabase = createServiceClient();

  try {
    const body = await request.json();
    const { month, channel, budget_amount, notes } = body;

    // Validate inputs
    if (!month || !channel || budget_amount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: month, channel, budget_amount" },
        { status: 400 }
      );
    }

    if (!["meta", "google"].includes(channel)) {
      return NextResponse.json(
        { error: "Channel must be 'meta' or 'google'" },
        { status: 400 }
      );
    }

    const amount = parseFloat(budget_amount);
    if (isNaN(amount) || amount < 0) {
      return NextResponse.json(
        { error: "Budget amount must be a non-negative number" },
        { status: 400 }
      );
    }

    // Format month to first of month
    const monthDate = new Date(month + "T12:00:00");
    const monthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}-01`;

    // Upsert the budget
    const { data, error } = await supabase
      .from("ad_budgets")
      .upsert({
        month: monthStr,
        channel,
        budget_amount: amount,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "month,channel",
      })
      .select()
      .single();

    if (error) {
      console.error("[BUDGETS] Error saving budget:", error);
      return NextResponse.json(
        { error: `Failed to save budget: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      budget: data,
    });

  } catch (error) {
    console.error("[BUDGETS] Error:", error);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}

/**
 * Delete a budget
 */
export async function DELETE(request: Request) {
  const supabase = createServiceClient();

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");
    const channel = searchParams.get("channel");

    if (!month || !channel) {
      return NextResponse.json(
        { error: "Missing required params: month, channel" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("ad_budgets")
      .delete()
      .eq("month", month)
      .eq("channel", channel);

    if (error) {
      console.error("[BUDGETS] Error deleting budget:", error);
      return NextResponse.json(
        { error: "Failed to delete budget" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error("[BUDGETS] Error:", error);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
