/**
 * Klaviyo API Client
 * Fetches email campaign performance data for marketing analytics
 * API Documentation: https://developers.klaviyo.com/en/reference/api-overview
 *
 * Key requirements:
 * - Channel filter is REQUIRED for /campaigns endpoint
 * - Filter syntax: filter=equals(field,"value") with double quotes
 * - Pagination uses page[cursor] not page[size]
 * - Reports API requires timeframe and conversion_metric_id
 */

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15"; // Stable revision
const PLACED_ORDER_METRIC_ID = "TQuQA4"; // Smithey's Placed Order metric

// Key segments for subscriber tracking
export const KLAVIYO_SEGMENTS = {
  ACTIVE_120_DAY: "RPnZc9", // M6_120DayActive+ New
  ENGAGED_365: "SBuWZx", // 365ENG
} as const;

// ============================================================
// Types
// ============================================================

export interface KlaviyoCampaign {
  type: "campaign";
  id: string;
  attributes: {
    name: string;
    status: string; // "Draft", "Scheduled", "Sending", "Sent", "Cancelled"
    archived: boolean;
    audiences: {
      included: string[];
      excluded: string[];
    };
    send_strategy: {
      method: string;
      options_static?: {
        datetime: string;
        is_local: boolean;
        send_past_recipients_immediately: boolean;
      };
    };
    created_at: string;
    updated_at: string;
    scheduled_at: string | null;
    send_time: string | null;
  };
}

export interface KlaviyoFlow {
  type: "flow";
  id: string;
  attributes: {
    name: string;
    status: string;
    archived: boolean;
    trigger_type: string;
    created: string;
    updated: string;
  };
}

export interface CampaignMetrics {
  recipients: number;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  conversions: number;
  conversionValue: number;
  bounces: number;
  unsubscribes: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
}

export interface CampaignReportData {
  campaignId: string;
  statistics: {
    opens: number;
    open_rate: number;
    clicks: number;
    click_rate: number;
    bounced: number;
    delivered: number;
    recipients: number;
    conversions: number;
    conversion_value: number;
    unsubscribes: number;
  };
}

export interface FlowReportData {
  flowId: string;
  statistics: {
    recipients: number;
    delivered: number;
    opens: number;
    clicks: number;
    conversions: number;
    conversion_value: number;
  };
}

export interface SubscriberCounts {
  active120Day: number;
  engaged365: number;
  /** True if any segment fetch failed */
  fetchFailed?: boolean;
  /** Error messages for failed fetches */
  errors?: string[];
}

interface KlaviyoClientConfig {
  privateKey: string;
}

interface PaginatedResponse<T> {
  data: T[];
  links: {
    self: string;
    first?: string;
    last?: string;
    prev?: string;
    next?: string;
  };
}

// ============================================================
// Client
// ============================================================

export class KlaviyoClient {
  private privateKey: string;

  constructor(config: KlaviyoClientConfig) {
    this.privateKey = config.privateKey;
  }

  /**
   * Make authenticated request to Klaviyo API with retry on rate limit
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 3
  ): Promise<T> {
    const url = `${KLAVIYO_API_BASE}${endpoint}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      console.log(`[KLAVIYO] Request: ${url}${attempt > 0 ? ` (retry ${attempt})` : ""}`);

      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Klaviyo-API-Key ${this.privateKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          revision: KLAVIYO_REVISION,
          ...options.headers,
        },
      });

      // Handle rate limiting with exponential backoff
      if (response.status === 429 && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`[KLAVIYO] Rate limited, waiting ${waitTime}ms...`);
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Klaviyo API error ${response.status}: ${errorText}`);
      }

      return response.json();
    }

    throw new Error(`Klaviyo API request failed after ${retries} retries`);
  }

  /**
   * Get all email campaigns with optional status filter
   * Channel filter (email) is required by Klaviyo API
   */
  async getEmailCampaigns(status?: string): Promise<KlaviyoCampaign[]> {
    const campaigns: KlaviyoCampaign[] = [];
    let nextUrl: string | null = null;
    let isFirstRequest = true;

    do {
      let endpoint: string;

      if (isFirstRequest) {
        // Build filter - channel is required
        let filter = 'equals(messages.channel,"email")';
        if (status) {
          filter = `and(${filter},equals(status,"${status}"))`;
        }
        endpoint = `/campaigns?filter=${encodeURIComponent(filter)}`;
        isFirstRequest = false;
      } else if (nextUrl) {
        // Use the full next URL from pagination
        endpoint = nextUrl.replace(KLAVIYO_API_BASE, "");
      } else {
        break;
      }

      const response = await this.request<PaginatedResponse<KlaviyoCampaign>>(endpoint);
      campaigns.push(...response.data);

      // Get next page URL
      nextUrl = response.links.next || null;

      // Rate limiting
      if (nextUrl) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (nextUrl);

    return campaigns;
  }

  /**
   * Get sent email campaigns, optionally filtered by date range
   * Filters client-side since send_time is not a filterable field
   */
  async getSentCampaigns(startDate?: Date, endDate?: Date): Promise<KlaviyoCampaign[]> {
    const allCampaigns = await this.getEmailCampaigns("Sent");

    if (!startDate && !endDate) {
      return allCampaigns;
    }

    // Filter client-side by send_time
    return allCampaigns.filter((campaign) => {
      const sendTime = campaign.attributes.send_time;
      if (!sendTime) return false;

      const sendDate = new Date(sendTime);

      if (startDate && sendDate < startDate) return false;
      if (endDate && sendDate > endDate) return false;

      return true;
    });
  }

  /**
   * Get scheduled email campaigns (for inventory planning)
   */
  async getScheduledCampaigns(): Promise<KlaviyoCampaign[]> {
    return this.getEmailCampaigns("Scheduled");
  }

  /**
   * Get bulk campaign performance reports using the Reporting API
   * Returns a map of campaignId -> statistics
   *
   * Note: The Klaviyo Reports API requires:
   * - timeframe (key like 'last_90_days' or custom start/end)
   * - conversion_metric_id (for revenue/conversion stats)
   *
   * @param timeframeKeyOrCustom - Either a predefined key or an object with start/end dates
   */
  async getAllCampaignReports(
    timeframeKeyOrCustom: string | { start: string; end: string } = "last_90_days"
  ): Promise<Map<string, CampaignReportData["statistics"]>> {
    const statsMap = new Map<string, CampaignReportData["statistics"]>();

    try {
      // Support both predefined keys and custom date ranges
      const timeframe = typeof timeframeKeyOrCustom === "string"
        ? { key: timeframeKeyOrCustom }
        : { start: timeframeKeyOrCustom.start, end: timeframeKeyOrCustom.end };

      const body = {
        data: {
          type: "campaign-values-report",
          attributes: {
            timeframe,
            conversion_metric_id: PLACED_ORDER_METRIC_ID,
            statistics: [
              "opens",
              "open_rate",
              "clicks",
              "click_rate",
              "bounced",
              "delivered",
              "recipients",
              "conversions",
              "conversion_value",
              "unsubscribes",
            ],
          },
        },
      };

      const response = await this.request<{
        data: {
          type: string;
          attributes: {
            results: Array<{
              groupings: {
                send_channel: string;
                campaign_id: string;
                campaign_message_id: string;
              };
              statistics: CampaignReportData["statistics"];
            }>;
          };
        };
      }>("/campaign-values-reports/", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const results = response.data?.attributes?.results || [];

      for (const result of results) {
        const campaignId = result.groupings.campaign_id;
        if (campaignId) {
          statsMap.set(campaignId, result.statistics);
        }
      }

      console.log(`[KLAVIYO] Got reports for ${statsMap.size} campaigns`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[KLAVIYO] Failed to get campaign reports:", errorMessage);
      // Re-throw so callers know the fetch failed rather than assuming empty data
      throw new Error(`Failed to fetch campaign reports: ${errorMessage}`);
    }

    return statsMap;
  }

  /**
   * Get campaign performance report for a single campaign (uses bulk API internally)
   * @deprecated Use getAllCampaignReports for efficiency
   */
  async getCampaignReport(campaignId: string): Promise<CampaignReportData | null> {
    const allReports = await this.getAllCampaignReports();
    const stats = allReports.get(campaignId);

    if (!stats) return null;

    return {
      campaignId,
      statistics: stats,
    };
  }

  /**
   * Get bulk flow performance reports
   * Returns total flow revenue and per-flow breakdown
   */
  async getFlowReports(timeframeKey = "last_30_days"): Promise<{
    totalRevenue: number;
    totalConversions: number;
    byFlow: Map<string, FlowReportData["statistics"]>;
  }> {
    const byFlow = new Map<string, FlowReportData["statistics"]>();
    let totalRevenue = 0;
    let totalConversions = 0;

    try {
      const body = {
        data: {
          type: "flow-values-report",
          attributes: {
            timeframe: { key: timeframeKey },
            conversion_metric_id: PLACED_ORDER_METRIC_ID,
            statistics: [
              "recipients",
              "delivered",
              "opens",
              "clicks",
              "conversions",
              "conversion_value",
            ],
          },
        },
      };

      const response = await this.request<{
        data: {
          type: string;
          attributes: {
            results: Array<{
              groupings: {
                flow_id: string;
                send_channel: string;
                flow_message_id: string;
              };
              statistics: FlowReportData["statistics"];
            }>;
          };
        };
      }>("/flow-values-reports/", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const results = response.data?.attributes?.results || [];

      // Aggregate by flow_id (multiple messages per flow)
      for (const result of results) {
        const flowId = result.groupings.flow_id;
        const stats = result.statistics;

        totalRevenue += stats.conversion_value || 0;
        totalConversions += stats.conversions || 0;

        // Aggregate per flow
        const existing = byFlow.get(flowId);
        if (existing) {
          existing.recipients += stats.recipients || 0;
          existing.delivered += stats.delivered || 0;
          existing.opens += stats.opens || 0;
          existing.clicks += stats.clicks || 0;
          existing.conversions += stats.conversions || 0;
          existing.conversion_value += stats.conversion_value || 0;
        } else {
          byFlow.set(flowId, { ...stats });
        }
      }

      console.log(`[KLAVIYO] Flow reports: $${totalRevenue.toFixed(2)} from ${byFlow.size} flows`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[KLAVIYO] Failed to get flow reports:", errorMessage);
      // Re-throw so callers know the fetch failed rather than assuming zero revenue
      throw new Error(`Failed to fetch flow reports: ${errorMessage}`);
    }

    return { totalRevenue, totalConversions, byFlow };
  }

  /**
   * Get historical monthly flow revenue using flow-series-reports
   * Returns monthly revenue for the specified timeframe
   * @param timeframeKeyOrCustom - Either a predefined key or an object with start/end dates
   */
  async getFlowRevenueHistory(
    timeframeKeyOrCustom: string | { start: string; end: string } = "last_365_days"
  ): Promise<{ date: string; revenue: number; conversions: number }[]> {
    try {
      // Support both predefined keys and custom date ranges
      const timeframe = typeof timeframeKeyOrCustom === "string"
        ? { key: timeframeKeyOrCustom }
        : { start: timeframeKeyOrCustom.start, end: timeframeKeyOrCustom.end };

      const body = {
        data: {
          type: "flow-series-report",
          attributes: {
            timeframe,
            interval: "monthly",
            conversion_metric_id: PLACED_ORDER_METRIC_ID,
            statistics: ["conversions", "conversion_value"],
          },
        },
      };

      const response = await this.request<{
        data: {
          attributes: {
            results: Array<{
              groupings: { flow_id: string };
              statistics: {
                conversions: number[];
                conversion_value: number[];
              };
            }>;
            date_times: string[];
          };
        };
      }>("/flow-series-reports/", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const dateTimes = response.data?.attributes?.date_times || [];
      const results = response.data?.attributes?.results || [];

      // Aggregate all flows by month
      const monthlyTotals = new Map<number, { revenue: number; conversions: number }>();

      for (let i = 0; i < dateTimes.length; i++) {
        monthlyTotals.set(i, { revenue: 0, conversions: 0 });
      }

      for (const result of results) {
        const revenues = result.statistics.conversion_value || [];
        const conversions = result.statistics.conversions || [];

        for (let i = 0; i < revenues.length; i++) {
          const existing = monthlyTotals.get(i) || { revenue: 0, conversions: 0 };
          existing.revenue += revenues[i] || 0;
          existing.conversions += conversions[i] || 0;
          monthlyTotals.set(i, existing);
        }
      }

      // Build result array
      const history: { date: string; revenue: number; conversions: number }[] = [];
      for (let i = 0; i < dateTimes.length; i++) {
        const totals = monthlyTotals.get(i) || { revenue: 0, conversions: 0 };
        history.push({
          date: dateTimes[i].split("T")[0],
          revenue: Math.round(totals.revenue * 100) / 100,
          conversions: Math.round(totals.conversions),
        });
      }

      console.log(`[KLAVIYO] Got ${history.length} months of flow revenue history`);
      return history;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[KLAVIYO] Failed to get flow revenue history:", errorMessage);
      // Re-throw so callers know the fetch failed rather than assuming no history
      throw new Error(`Failed to fetch flow revenue history: ${errorMessage}`);
    }
  }

  /**
   * Get subscriber counts from key segments
   * Returns counts with fetchFailed flag if any segment fetch failed
   */
  async getSubscriberCounts(): Promise<SubscriberCounts> {
    const counts: SubscriberCounts = {
      active120Day: 0,
      engaged365: 0,
      fetchFailed: false,
      errors: [],
    };

    // Get 120-day active segment
    try {
      const active = await this.request<{
        data: { attributes: { profile_count?: number } };
      }>(`/segments/${KLAVIYO_SEGMENTS.ACTIVE_120_DAY}?additional-fields%5Bsegment%5D=profile_count`);
      counts.active120Day = active.data?.attributes?.profile_count || 0;
      console.log(`[KLAVIYO] 120-day count: ${counts.active120Day}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[KLAVIYO] Failed to get 120-day subscriber count:", errorMessage);
      counts.fetchFailed = true;
      counts.errors!.push(`120-day segment: ${errorMessage}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Get 365-day engaged segment
    try {
      const engaged = await this.request<{
        data: { attributes: { profile_count?: number } };
      }>(`/segments/${KLAVIYO_SEGMENTS.ENGAGED_365}?additional-fields%5Bsegment%5D=profile_count`);
      counts.engaged365 = engaged.data?.attributes?.profile_count || 0;
      console.log(`[KLAVIYO] 365-day count: ${counts.engaged365}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[KLAVIYO] Failed to get 365-day subscriber count:", errorMessage);
      counts.fetchFailed = true;
      counts.errors!.push(`365-day segment: ${errorMessage}`);
    }

    console.log(`[KLAVIYO] Final subscriber counts: 120-day=${counts.active120Day}, 365-day=${counts.engaged365}${counts.fetchFailed ? " (with errors)" : ""}`);
    return counts;
  }

  /**
   * Get historical subscriber counts from segment series reports
   * Returns monthly member counts for the specified timeframe
   * @param timeframeKeyOrCustom - Either a predefined key or an object with start/end dates
   */
  async getSegmentHistory(
    segmentId: string,
    timeframeKeyOrCustom: string | { start: string; end: string } = "last_365_days"
  ): Promise<{ date: string; count: number }[]> {
    try {
      // Support both predefined keys and custom date ranges
      const timeframe = typeof timeframeKeyOrCustom === "string"
        ? { key: timeframeKeyOrCustom }
        : { start: timeframeKeyOrCustom.start, end: timeframeKeyOrCustom.end };

      const body = {
        data: {
          type: "segment-series-report",
          attributes: {
            statistics: ["total_members"],
            timeframe,
            interval: "monthly",
            filter: `equals(segment_id,"${segmentId}")`,
          },
        },
      };

      const response = await this.request<{
        data: {
          attributes: {
            results: Array<{
              groupings: { segment_id: string };
              statistics: { total_members: number[] };
            }>;
            date_times: string[];
          };
        };
      }>("/segment-series-reports/", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const dateTimes = response.data?.attributes?.date_times || [];
      const counts = response.data?.attributes?.results?.[0]?.statistics?.total_members || [];

      // Pair dates with counts
      const history: { date: string; count: number }[] = [];
      for (let i = 0; i < dateTimes.length && i < counts.length; i++) {
        history.push({
          date: dateTimes[i].split("T")[0], // YYYY-MM-DD
          count: Math.round(counts[i]),
        });
      }

      console.log(`[KLAVIYO] Got ${history.length} months of history for segment ${segmentId}`);
      return history;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[KLAVIYO] Failed to get segment history for ${segmentId}:`, errorMessage);
      // Re-throw so callers know the fetch failed rather than assuming no history
      throw new Error(`Failed to fetch segment history for ${segmentId}: ${errorMessage}`);
    }
  }

  /**
   * Get historical subscriber counts for both key segments
   * @param timeframeKeyOrCustom - Either a predefined key or an object with start/end dates
   */
  async getSubscriberHistory(
    timeframeKeyOrCustom: string | { start: string; end: string } = "last_365_days"
  ): Promise<{
    active120Day: { date: string; count: number }[];
    engaged365Day: { date: string; count: number }[];
  }> {
    const [active120Day, engaged365Day] = await Promise.all([
      this.getSegmentHistory(KLAVIYO_SEGMENTS.ACTIVE_120_DAY, timeframeKeyOrCustom),
      this.getSegmentHistory(KLAVIYO_SEGMENTS.ENGAGED_365, timeframeKeyOrCustom),
    ]);

    return { active120Day, engaged365Day };
  }

  /**
   * Get all flows
   */
  async getFlows(): Promise<KlaviyoFlow[]> {
    const flows: KlaviyoFlow[] = [];
    let nextUrl: string | null = null;
    let isFirstRequest = true;

    do {
      let endpoint: string;

      if (isFirstRequest) {
        endpoint = "/flows";
        isFirstRequest = false;
      } else if (nextUrl) {
        endpoint = nextUrl.replace(KLAVIYO_API_BASE, "");
      } else {
        break;
      }

      const response = await this.request<PaginatedResponse<KlaviyoFlow>>(endpoint);
      flows.push(...response.data);

      nextUrl = response.links.next || null;

      if (nextUrl) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (nextUrl);

    return flows;
  }

  /**
   * Get list profile count for audience estimation
   * Returns -1 if fetch fails to distinguish from genuinely empty lists
   */
  async getListSize(listId: string): Promise<number> {
    try {
      const response = await this.request<{
        data: {
          attributes: {
            profile_count?: number;
          };
        };
      }>(`/lists/${listId}`);

      return response.data?.attributes?.profile_count || 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[KLAVIYO] Failed to get list size for ${listId}:`, errorMessage);
      // Return -1 to indicate failure (distinguishable from empty list which is 0)
      return -1;
    }
  }

  /**
   * Get segment profile count for audience estimation
   * Returns -1 if fetch fails to distinguish from genuinely empty segments
   */
  async getSegmentSize(segmentId: string): Promise<number> {
    try {
      const response = await this.request<{
        data: {
          attributes: {
            profile_count?: number;
          };
        };
      }>(`/segments/${segmentId}`);

      return response.data?.attributes?.profile_count || 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[KLAVIYO] Failed to get segment size for ${segmentId}:`, errorMessage);
      // Return -1 to indicate failure (distinguishable from empty segment which is 0)
      return -1;
    }
  }
}

// ============================================================
// Factory
// ============================================================

export function createKlaviyoClient(): KlaviyoClient {
  const privateKey = process.env.KLAVIYO_PRIVATE_API_KEY;

  if (!privateKey) {
    throw new Error(
      "Missing Klaviyo configuration. Required env var: KLAVIYO_PRIVATE_API_KEY"
    );
  }

  return new KlaviyoClient({ privateKey });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Convert Klaviyo report statistics to our standard CampaignMetrics format
 */
export function reportToMetrics(report: CampaignReportData): CampaignMetrics {
  const stats = report.statistics;
  const recipients = stats.recipients || 0;
  const conversions = stats.conversions || 0;

  return {
    recipients,
    delivered: stats.delivered || 0,
    opens: stats.opens || 0,
    uniqueOpens: stats.opens || 0, // API returns opens, not unique_opens
    clicks: stats.clicks || 0,
    uniqueClicks: stats.clicks || 0, // API returns clicks, not unique_clicks
    conversions,
    conversionValue: stats.conversion_value || 0,
    bounces: stats.bounced || 0,
    unsubscribes: stats.unsubscribes || 0,
    openRate: stats.open_rate || 0,
    clickRate: stats.click_rate || 0,
    conversionRate: recipients > 0 ? conversions / recipients : 0,
  };
}

/**
 * Calculate predicted revenue for a scheduled campaign
 */
export function predictCampaignRevenue(
  audienceSize: number,
  historicalOpenRate: number,
  historicalClickRate: number,
  historicalConversionRate: number,
  averageOrderValue: number
): number {
  const predictedOpens = audienceSize * historicalOpenRate;
  const predictedClicks = predictedOpens * historicalClickRate;
  const predictedConversions = predictedClicks * historicalConversionRate;
  const predictedRevenue = predictedConversions * averageOrderValue;

  return Math.round(predictedRevenue * 100) / 100;
}
