/**
 * Klaviyo API Client
 * Fetches email campaign performance data for marketing analytics
 * API Documentation: https://developers.klaviyo.com/en/reference/api-overview
 *
 * Key requirements:
 * - Channel filter is REQUIRED for /campaigns endpoint
 * - Filter syntax: filter=equals(field,"value") with double quotes
 * - Pagination uses page[cursor] not page[size]
 */

const KLAVIYO_API_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15"; // Stable revision

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

    console.log(`[KLAVIYO] Request: ${url}`);

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Klaviyo API error ${response.status}: ${errorText}`);
    }

    return response.json();
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
   * Get campaign performance report using the Reporting API
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
              "bounce_rate",
              "clicked",
              "click_rate",
              "delivered",
              "delivery_rate",
              "opened",
              "open_rate",
              "recipients",
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
          type: string;
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

      const result = response.data?.attributes?.results?.[0];
      if (!result) return null;

      return {
        campaignId,
        statistics: result.statistics,
      };
    } catch (error) {
      console.error(`[KLAVIYO] Failed to get report for campaign ${campaignId}:`, error);
      return null;
    }
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
    } catch {
      return 0;
    }
  }

  /**
   * Get segment profile count for audience estimation
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
    } catch {
      return 0;
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
