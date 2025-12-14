/**
 * Leads API Endpoint
 *
 * Fetches leads from typeform_leads table with funnel metrics and volume trends.
 * Supports filtering by form_type, status, match_status, and date range.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  LeadsResponse,
  LeadFunnelMetrics,
  LeadVolumeByPeriod,
  TypeformLead,
  LeadStatus,
  LeadFormType,
  LeadMatchStatus,
  FormTypeFunnelMetrics,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: number;
  typeform_response_id: string;
  typeform_form_id: string;
  form_type: LeadFormType;
  company_name: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  store_type: string | null;
  location_count: string | null;
  industry: string | null;
  years_in_business: string | null;
  ein: string | null;
  instagram_url: string | null;
  has_instagram: boolean | null;
  has_website: boolean | null;
  referral_source: string | null;
  fit_reason: string | null;
  notes: string | null;
  submitted_at: string;
  raw_payload: Record<string, unknown>;
  status: LeadStatus;
  assigned_to: string | null;
  match_status: LeadMatchStatus;
  matched_customer_id: number | null;
  match_confidence: number | null;
  match_candidates: unknown;
  matched_at: string | null;
  matched_by: string | null;
  converted_at: string | null;
  first_order_id: number | null;
  first_order_date: string | null;
  first_order_amount: number | null;
  days_to_conversion: number | null;
  ai_summary: string | null;
  ai_fit_score: number | null;
  ai_analyzed_at: string | null;
  synced_at: string;
  updated_at: string;
};

export async function GET(request: Request) {
  try {
    const supabase = createServiceClient();
    const url = new URL(request.url);

    // Parse query params
    const formType = url.searchParams.get("form_type") as LeadFormType | null;
    const status = url.searchParams.get("status") as LeadStatus | null;
    const matchStatus = url.searchParams.get("match_status") as LeadMatchStatus | null;
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    // Build query for leads
    let query = supabase
      .from("typeform_leads")
      .select("*", { count: "exact" })
      .order("submitted_at", { ascending: false });

    if (formType) {
      query = query.eq("form_type", formType);
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (matchStatus) {
      query = query.eq("match_status", matchStatus);
    }
    if (startDate) {
      query = query.gte("submitted_at", startDate);
    }
    if (endDate) {
      query = query.lte("submitted_at", endDate);
    }

    // Paginate
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: leadsData, count, error: leadsError } = await query;

    if (leadsError) {
      console.error("[LEADS] Query error:", leadsError);
      throw leadsError;
    }

    const leads: TypeformLead[] = ((leadsData || []) as LeadRow[]).map((row) => ({
      ...row,
      match_candidates: row.match_candidates as TypeformLead["match_candidates"],
    }));

    // Calculate T365 date filter (trailing 365 days from today)
    const t365Date = new Date();
    t365Date.setDate(t365Date.getDate() - 365);
    const t365Str = t365Date.toISOString();

    // Get funnel metrics - scoped to T365 for relevance
    const { data: funnelData, error: funnelError } = await supabase
      .from("typeform_leads")
      .select("status, form_type, match_status, converted_at, days_to_conversion, first_order_amount, submitted_at")
      .gte("submitted_at", t365Str);

    if (funnelError) {
      console.error("[LEADS] Funnel query error:", funnelError);
    }

    const funnel = calculateFunnelMetrics(funnelData || []);

    // Volume trend is calculated from the full T365 data
    const volumeTrend = calculateVolumeTrend((funnelData || []).map(row => ({
      ...row,
      submitted_at: row.submitted_at,
    })));

    // Get leads pending review (for matching)
    const { data: pendingData } = await supabase
      .from("typeform_leads")
      .select("*")
      .eq("match_status", "pending")
      .order("match_confidence", { ascending: false, nullsFirst: false })
      .limit(20);

    const pendingReview: TypeformLead[] = ((pendingData || []) as LeadRow[]).map((row) => ({
      ...row,
      match_candidates: row.match_candidates as TypeformLead["match_candidates"],
    }));

    // Get last sync time
    const { data: syncData } = await supabase
      .from("sync_logs")
      .select("completed_at")
      .eq("sync_type", "typeform_lead")
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    const response: LeadsResponse = {
      leads,
      total_count: count || 0,
      funnel,
      volume_trend: volumeTrend,
      pending_review: pendingReview,
      lastSynced: syncData?.completed_at || null,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[LEADS] API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500 }
    );
  }
}

interface FunnelRow {
  status: LeadStatus;
  form_type: LeadFormType;
  match_status: LeadMatchStatus;
  converted_at: string | null;
  days_to_conversion: number | null;
  first_order_amount: number | null;
  submitted_at: string;
}

function calculateFunnelMetrics(data: FunnelRow[]): LeadFunnelMetrics {
  const total = data.length;

  // Count by status
  const statusCounts = {
    new: 0,
    contacted: 0,
    qualified: 0,
    converted: 0,
    lost: 0,
    archived: 0,
  };

  // Count by form type with conversion tracking
  // Track separately: all leads vs matched leads (where conversion can be tracked)
  const byFormType = {
    wholesale: {
      total: 0,
      matched: 0, // Leads we can track for conversion
      converted: 0,
      totalDays: 0,
      convertedCount: 0,
    },
    corporate: {
      total: 0,
      matched: 0,
      converted: 0,
      totalDays: 0,
      convertedCount: 0,
    },
  };

  // Count by match status
  let autoMatched = 0;
  let manualMatched = 0;
  let pendingMatch = 0;

  // Overall conversion metrics (only for matched leads)
  let totalConversionDays = 0;
  let conversionCount = 0;
  let totalConversionRevenue = 0;
  let totalMatched = 0;

  for (const row of data) {
    // Status
    if (row.status && statusCounts[row.status] !== undefined) {
      statusCounts[row.status]++;
    }

    const isMatched = row.match_status === "auto_matched" || row.match_status === "manual_matched";

    // Form type with conversion tracking
    if (row.form_type === "wholesale") {
      byFormType.wholesale.total++;
      if (isMatched) {
        byFormType.wholesale.matched++;
        if (row.converted_at) {
          byFormType.wholesale.converted++;
          if (row.days_to_conversion !== null) {
            byFormType.wholesale.totalDays += row.days_to_conversion;
            byFormType.wholesale.convertedCount++;
          }
        }
      }
    }
    if (row.form_type === "corporate") {
      byFormType.corporate.total++;
      if (isMatched) {
        byFormType.corporate.matched++;
        if (row.converted_at) {
          byFormType.corporate.converted++;
          if (row.days_to_conversion !== null) {
            byFormType.corporate.totalDays += row.days_to_conversion;
            byFormType.corporate.convertedCount++;
          }
        }
      }
    }

    // Match status
    if (row.match_status === "auto_matched") autoMatched++;
    if (row.match_status === "manual_matched") manualMatched++;
    if (row.match_status === "pending") pendingMatch++;

    // Overall conversion (only count matched leads)
    if (isMatched) {
      totalMatched++;
      if (row.converted_at) {
        conversionCount++;
        if (row.days_to_conversion !== null) {
          totalConversionDays += row.days_to_conversion;
        }
        if (row.first_order_amount !== null) {
          totalConversionRevenue += row.first_order_amount;
        }
      }
    }
  }

  // Calculate form-type-specific funnel metrics
  // Conversion rate is based on ALL leads (not just matched)
  const calculateFormTypeMetrics = (
    stats: typeof byFormType.wholesale
  ): FormTypeFunnelMetrics => ({
    total: stats.total,
    converted: stats.converted,
    // Conversion rate based on all leads of this type
    conversion_rate:
      stats.total > 0
        ? Math.round((stats.converted / stats.total) * 1000) / 10
        : 0,
    avg_days_to_conversion:
      stats.convertedCount > 0
        ? Math.round((stats.totalDays / stats.convertedCount) * 10) / 10
        : null,
  });

  // Calculate overall conversion rate (against all leads)
  const overallConversionRate =
    total > 0 ? Math.round((conversionCount / total) * 1000) / 10 : 0;

  const avgDaysToConversion =
    conversionCount > 0 ? totalConversionDays / conversionCount : null;

  return {
    // Primary metrics
    total_leads: total,
    converted_leads: conversionCount,
    conversion_rate: overallConversionRate,
    avg_days_to_conversion: avgDaysToConversion
      ? Math.round(avgDaysToConversion * 10) / 10
      : null,
    // Form type breakdown - the main funnel view
    wholesale: calculateFormTypeMetrics(byFormType.wholesale),
    corporate: calculateFormTypeMetrics(byFormType.corporate),
    // Legacy fields for backwards compatibility
    new_leads: statusCounts.new,
    contacted_leads: statusCounts.contacted,
    qualified_leads: statusCounts.qualified,
    lost_leads: statusCounts.lost,
    wholesale_leads: byFormType.wholesale.total,
    corporate_leads: byFormType.corporate.total,
    auto_matched: autoMatched,
    manual_matched: manualMatched,
    pending_match: pendingMatch,
    total_conversion_revenue: totalConversionRevenue,
    // Deltas would need historical data - placeholder for now
    leads_delta: 0,
    leads_delta_pct: 0,
    conversion_rate_delta: 0,
  };
}

function calculateVolumeTrend(data: FunnelRow[]): LeadVolumeByPeriod[] {
  // Group by month
  const byMonth: Record<
    string,
    { wholesale: number; corporate: number; converted: number; matched: number }
  > = {};

  for (const row of data) {
    if (!row.submitted_at) continue;

    const month = row.submitted_at.substring(0, 7); // YYYY-MM
    if (!byMonth[month]) {
      byMonth[month] = { wholesale: 0, corporate: 0, converted: 0, matched: 0 };
    }

    if (row.form_type === "wholesale") byMonth[month].wholesale++;
    if (row.form_type === "corporate") byMonth[month].corporate++;

    const isMatched = row.match_status === "auto_matched" || row.match_status === "manual_matched";
    if (isMatched) {
      byMonth[month].matched++;
      if (row.converted_at) byMonth[month].converted++;
    }
  }

  // Convert to array and sort
  return Object.entries(byMonth)
    .map(([period, counts]) => {
      const total = counts.wholesale + counts.corporate;
      // Conversion rate based on matched leads (where we can track)
      const convRate = counts.matched > 0 ? (counts.converted / counts.matched) * 100 : 0;
      return {
        period,
        wholesale: counts.wholesale,
        corporate: counts.corporate,
        total,
        converted: counts.converted,
        conversion_rate: Math.round(convRate * 10) / 10,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}
