/**
 * Leads API Endpoint
 *
 * Fetches leads from typeform_leads table with funnel metrics and volume trends.
 * Supports filtering by form_type, status, match_status, and date range.
 *
 * OPTIMIZATION: Uses materialized views (lead_funnel_stats, lead_volume_by_month)
 * for pre-computed metrics instead of calculating in JS on every request.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/server";
import type {
  LeadsResponse,
  LeadFunnelMetrics,
  LeadVolumeByPeriod,
  TypeformLead,
  LeadStatus,
  LeadFormType,
  LeadMatchStatus,
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

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

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

    // Get funnel metrics from materialized view (pre-computed, much faster)
    const { data: funnelRow, error: funnelError } = await supabase
      .from("lead_funnel_stats")
      .select("*")
      .single();

    if (funnelError) {
      console.error("[LEADS] Funnel view query error:", funnelError);
    }

    const funnel = transformFunnelViewToMetrics(funnelRow);

    // Get volume trend from materialized view
    const { data: volumeData, error: volumeError } = await supabase
      .from("lead_volume_by_month")
      .select("*")
      .order("month", { ascending: true });

    if (volumeError) {
      console.error("[LEADS] Volume view query error:", volumeError);
    }

    const volumeTrend = transformVolumeViewToTrend(volumeData || []);

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

// Type for the materialized view row
interface FunnelViewRow {
  total_leads: number;
  converted_leads: number;
  conversion_rate: string;
  avg_days_to_conversion: string | null;
  wholesale_leads: number;
  corporate_leads: number;
  wholesale_converted: number;
  corporate_converted: number;
  auto_matched: number;
  manual_matched: number;
  pending_match: number;
  ai_score_poor: number;
  ai_score_weak: number;
  ai_score_maybe: number;
  ai_score_good: number;
  ai_score_great: number;
  ai_score_pending: number;
  total_conversion_revenue: string;
  refreshed_at: string;
}

interface VolumeViewRow {
  month: string;
  wholesale: number;
  corporate: number;
  total: number;
  converted: number;
  conversion_rate: string;
}

/**
 * Transform materialized view row to LeadFunnelMetrics
 * Much simpler than calculating in JS - just map fields
 */
function transformFunnelViewToMetrics(row: FunnelViewRow | null): LeadFunnelMetrics {
  if (!row) {
    // Return empty metrics if view is empty
    return {
      total_leads: 0,
      converted_leads: 0,
      conversion_rate: 0,
      avg_days_to_conversion: null,
      wholesale: { total: 0, converted: 0, conversion_rate: 0, avg_days_to_conversion: null },
      corporate: { total: 0, converted: 0, conversion_rate: 0, avg_days_to_conversion: null },
      new_leads: 0,
      contacted_leads: 0,
      qualified_leads: 0,
      lost_leads: 0,
      wholesale_leads: 0,
      corporate_leads: 0,
      auto_matched: 0,
      manual_matched: 0,
      pending_match: 0,
      total_conversion_revenue: 0,
      ai_score_distribution: { poor: 0, weak: 0, maybe: 0, good: 0, great: 0, pending: 0 },
      leads_delta: 0,
      leads_delta_pct: 0,
      conversion_rate_delta: 0,
    };
  }

  // Calculate form-type conversion rates
  const wholesaleConvRate = row.wholesale_leads > 0
    ? Math.round((row.wholesale_converted / row.wholesale_leads) * 1000) / 10
    : 0;
  const corporateConvRate = row.corporate_leads > 0
    ? Math.round((row.corporate_converted / row.corporate_leads) * 1000) / 10
    : 0;

  return {
    total_leads: row.total_leads,
    converted_leads: row.converted_leads,
    conversion_rate: parseFloat(row.conversion_rate) || 0,
    avg_days_to_conversion: row.avg_days_to_conversion ? parseFloat(row.avg_days_to_conversion) : null,
    wholesale: {
      total: row.wholesale_leads,
      converted: row.wholesale_converted,
      conversion_rate: wholesaleConvRate,
      avg_days_to_conversion: null, // Would need separate tracking per form type
    },
    corporate: {
      total: row.corporate_leads,
      converted: row.corporate_converted,
      conversion_rate: corporateConvRate,
      avg_days_to_conversion: null,
    },
    // Legacy fields - status counts not in view, default to 0
    new_leads: 0,
    contacted_leads: 0,
    qualified_leads: 0,
    lost_leads: 0,
    wholesale_leads: row.wholesale_leads,
    corporate_leads: row.corporate_leads,
    auto_matched: row.auto_matched,
    manual_matched: row.manual_matched,
    pending_match: row.pending_match,
    total_conversion_revenue: parseFloat(row.total_conversion_revenue) || 0,
    ai_score_distribution: {
      poor: row.ai_score_poor,
      weak: row.ai_score_weak,
      maybe: row.ai_score_maybe,
      good: row.ai_score_good,
      great: row.ai_score_great,
      pending: row.ai_score_pending,
    },
    // Deltas would need historical snapshots - placeholder for now
    leads_delta: 0,
    leads_delta_pct: 0,
    conversion_rate_delta: 0,
  };
}

/**
 * Transform volume view rows to LeadVolumeByPeriod array
 */
function transformVolumeViewToTrend(rows: VolumeViewRow[]): LeadVolumeByPeriod[] {
  return rows.map((row) => ({
    period: row.month.substring(0, 7), // YYYY-MM from YYYY-MM-DD
    wholesale: row.wholesale,
    corporate: row.corporate,
    total: row.total,
    converted: row.converted,
    conversion_rate: parseFloat(row.conversion_rate) || 0,
  }));
}
