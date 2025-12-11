/**
 * Klaviyo API Client
 * Fetches email/SMS campaign performance data for marketing analytics
 * API Documentation: https://developers.klaviyo.com/en/reference/api-overview
 */

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2025-10-15"; // Latest GA revision

// ============================================================
// Types
// ============================================================

export interface KlaviyoCampaign {
  type: "campaign";
  id: string;
  attributes: {
    name: string;
    status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
    archived: boolean;
    channel: "email" | "sms";
    message: string; // Message ID
    audiences: {
      included: string[]; // List/segment IDs
      excluded: string[];
    };
    send_options: {
      use_smart_sending: boolean;
      is_transactional: boolean;
    };
    tracking_options: {
      is_tracking_opens: boolean;
      is_tracking_clicks: boolean;
    };
    send_strategy: {
      method: "immediate" | "throttled" | "static";
      options_static?: {
        datetime: string; // ISO8601
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
    status: "draft" | "manual" | "live";
    archived: boolean;
    trigger_type: string;
    created: string;
    updated: string;
  };
}

export interface KlaviyoList {
  type: "list";
  id: string;
  attributes: {
    name: string;
    created: string;
    updated: string;
  };
}

export interface KlaviyoMetricAggregate {
  type: "metric-aggregate";
  attributes: {
    data: Array<{
      dimensions: string[];
      measurements: Record<string, number>;
    }>;
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
    bounced: number;
    bounced_or_failed: number;
    bounce_rate: number;
    clicked: number;
    click_rate: number;
    click_to_open_rate: number;
    delivered: number;
    delivery_rate: number;
    failed: number;
    failed_rate: number;
    opened: number;
    open_rate: number;
    recipients: number;
    revenue_per_recipient: number;
    spam_complaints: number;
    spam_complaint_rate: number;
    total_revenue: number;
    unique_clicks: number;
    unique_click_rate: number;
    unique_conversions: number;
    unique_conversion_rate: number;
    unique_opens: number;
    unique_open_rate: number;
    unsubscribed: number;
    unsubscribe_rate: number;
  };
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
   * Make authenticated request to Klaviyo API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${KLAVIYO_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Klaviyo-API-Key ${this.privateKey}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        revision: KLAVIYO_REVISION,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Klaviyo API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get all campaigns with pagination
   * Optionally filter by status
   */
  async getCampaigns(
    status?: "draft" | "scheduled" | "sent" | "cancelled"
  ): Promise<KlaviyoCampaign[]> {
    const campaigns: KlaviyoCampaign[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({
        "page[size]": "50",
      });

      if (status) {
        params.set("filter", `equals(messages.channel,'email'),equals(status,'${status}')`);
      }

      if (cursor) {
        params.set("page[cursor]", cursor);
      }

      const response = await this.request<PaginatedResponse<KlaviyoCampaign>>(
        `/campaigns?${params}`
      );

      campaigns.push(...response.data);

      // Extract next cursor from links.next URL
      cursor = null;
      if (response.links.next) {
        try {
          const nextUrl = new URL(response.links.next);
          cursor = nextUrl.searchParams.get("page[cursor]");
        } catch {
          cursor = null;
        }
      }

      // Rate limiting - be nice to the API
      if (cursor) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (cursor);

    return campaigns;
  }

  /**
   * Get campaigns sent within a date range
   */
  async getCampaignsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<KlaviyoCampaign[]> {
    const campaigns: KlaviyoCampaign[] = [];
    let cursor: string | null = null;

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    do {
      const params = new URLSearchParams({
        "page[size]": "50",
        filter: `and(equals(status,"Sent"),greater-or-equal(send_time,${startIso}),less-than(send_time,${endIso}))`,
      });

      if (cursor) {
        params.set("page[cursor]", cursor);
      }

      const response = await this.request<PaginatedResponse<KlaviyoCampaign>>(
        `/campaigns?${params}`
      );

      campaigns.push(...response.data);

      cursor = null;
      if (response.links.next) {
        try {
          const nextUrl = new URL(response.links.next);
          cursor = nextUrl.searchParams.get("page[cursor]");
        } catch {
          cursor = null;
        }
      }

      if (cursor) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (cursor);

    return campaigns;
  }

  /**
   * Get scheduled campaigns (for inventory planning)
   */
  async getScheduledCampaigns(): Promise<KlaviyoCampaign[]> {
    const campaigns: KlaviyoCampaign[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({
        "page[size]": "50",
        filter: 'equals(status,"Scheduled")',
      });

      if (cursor) {
        params.set("page[cursor]", cursor);
      }

      const response = await this.request<PaginatedResponse<KlaviyoCampaign>>(
        `/campaigns?${params}`
      );

      campaigns.push(...response.data);

      cursor = null;
      if (response.links.next) {
        try {
          const nextUrl = new URL(response.links.next);
          cursor = nextUrl.searchParams.get("page[cursor]");
        } catch {
          cursor = null;
        }
      }

      if (cursor) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (cursor);

    return campaigns;
  }

  /**
   * Get campaign performance report using the Reporting API
   * This gives us the aggregated metrics we need for each campaign
   */
  async getCampaignReport(campaignId: string): Promise<CampaignReportData | null> {
    try {
      const body = {
        data: {
          type: "campaign-values-report",
          attributes: {
            campaign_ids: [campaignId],
            statistics: [
              "bounced",
              "bounced_or_failed",
              "bounce_rate",
              "clicked",
              "click_rate",
              "click_to_open_rate",
              "delivered",
              "delivery_rate",
              "failed",
              "failed_rate",
              "opened",
              "open_rate",
              "recipients",
              "revenue_per_recipient",
              "spam_complaints",
              "spam_complaint_rate",
              "total_revenue",
              "unique_clicks",
              "unique_click_rate",
              "unique_conversions",
              "unique_conversion_rate",
              "unique_opens",
              "unique_open_rate",
              "unsubscribed",
              "unsubscribe_rate",
            ],
          },
        },
      };

      const response = await this.request<{
        data: {
          type: "campaign-values-report";
          attributes: {
            results: Array<{
              groupings: Record<string, string>;
              statistics: CampaignReportData["statistics"];
            }>;
          };
        };
      }>("/campaign-values-reports/", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const result = response.data.attributes.results[0];
      if (!result) return null;

      return {
        campaignId,
        statistics: result.statistics,
      };
    } catch (error) {
      console.error(`Failed to get report for campaign ${campaignId}:`, error);
      return null;
    }
  }

  /**
   * Get all flows
   */
  async getFlows(): Promise<KlaviyoFlow[]> {
    const flows: KlaviyoFlow[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({
        "page[size]": "50",
      });

      if (cursor) {
        params.set("page[cursor]", cursor);
      }

      const response = await this.request<PaginatedResponse<KlaviyoFlow>>(
        `/flows?${params}`
      );

      flows.push(...response.data);

      cursor = null;
      if (response.links.next) {
        try {
          const nextUrl = new URL(response.links.next);
          cursor = nextUrl.searchParams.get("page[cursor]");
        } catch {
          cursor = null;
        }
      }

      if (cursor) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (cursor);

    return flows;
  }

  /**
   * Get list/segment size for audience estimation
   */
  async getListSize(listId: string): Promise<number> {
    try {
      const response = await this.request<{
        data: {
          attributes: {
            profile_count: number;
          };
        };
      }>(`/lists/${listId}`);

      return response.data.attributes.profile_count || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get segment size for audience estimation
   */
  async getSegmentSize(segmentId: string): Promise<number> {
    try {
      const response = await this.request<{
        data: {
          attributes: {
            profile_count: number;
          };
        };
      }>(`/segments/${segmentId}`);

      return response.data.attributes.profile_count || 0;
    } catch {
      return 0;
    }
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Create a Klaviyo client from environment variables
 */
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
export function reportToMetrics(
  report: CampaignReportData
): CampaignMetrics {
  const stats = report.statistics;

  return {
    recipients: stats.recipients || 0,
    delivered: stats.delivered || 0,
    opens: stats.opened || 0,
    uniqueOpens: stats.unique_opens || 0,
    clicks: stats.clicked || 0,
    uniqueClicks: stats.unique_clicks || 0,
    conversions: stats.unique_conversions || 0,
    conversionValue: stats.total_revenue || 0,
    bounces: stats.bounced || 0,
    unsubscribes: stats.unsubscribed || 0,
    openRate: stats.unique_open_rate || 0,
    clickRate: stats.unique_click_rate || 0,
    conversionRate: stats.unique_conversion_rate || 0,
  };
}

/**
 * Calculate predicted revenue for a scheduled campaign
 * Based on historical average conversion rate and AOV
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
