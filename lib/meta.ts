/**
 * Meta Marketing API Client
 * Fetches ad campaign and creative performance data from Facebook/Instagram
 * API Documentation: https://developers.facebook.com/docs/marketing-apis/
 *
 * Key requirements:
 * - System User access token (60+ day lifespan)
 * - Ad Account ID format: act_XXXXXXXXX
 * - Historical data: 37 months general, 13 months for breakdowns
 * - Attribution windows: 7d_view/28d_view deprecated Jan 12, 2026
 *
 * Rate limits are dynamic based on active ads - we use conservative
 * delays and exponential backoff to stay within limits.
 */

const META_API_BASE = "https://graph.facebook.com/v21.0";

// Default fields for insights queries
const CAMPAIGN_INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "objective",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
].join(",");

const AD_INSIGHT_FIELDS = [
  "ad_id",
  "ad_name",
  "adset_id",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "actions",
  "action_values",
].join(",");

// ============================================================
// Types
// ============================================================

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  created_time: string;
  updated_time: string;
}

export interface MetaCampaignInsight {
  campaign_id: string;
  campaign_name: string;
  objective?: string;
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  reach?: string;
  frequency?: string;
  clicks: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

export interface MetaAdInsight {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

export interface MetaAction {
  action_type: string;
  value: string;
}

export interface MetaAdCreative {
  id: string;
  name: string;
  thumbnail_url?: string;
  image_url?: string; // Full resolution image (for static image ads)
  object_type?: string; // IMAGE, VIDEO, CAROUSEL, etc.
}

export interface MetaAd {
  id: string;
  name: string;
  status: string;
  creative?: MetaAdCreative;
  adset_id?: string;
  campaign_id?: string;
}

interface MetaClientConfig {
  accessToken: string;
  adAccountId: string;
}

interface MetaApiResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
}

// ============================================================
// Parsed types for database insertion
// ============================================================

export interface ParsedCampaignInsight {
  meta_campaign_id: string;
  name: string;
  objective: string | null;
  date: string;
  spend: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  purchases: number;
  purchase_value: number;
  add_to_carts: number;
  initiated_checkouts: number;
  platform_roas: number | null;
}

export interface ParsedAdInsight {
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  date: string;
  creative_type: string | null;
  thumbnail_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  purchases: number;
  purchase_value: number;
}

// ============================================================
// Client
// ============================================================

export class MetaClient {
  private accessToken: string;
  private adAccountId: string;

  constructor(config: MetaClientConfig) {
    this.accessToken = config.accessToken;
    this.adAccountId = config.adAccountId;

    // Ensure ad account ID has act_ prefix
    if (!this.adAccountId.startsWith("act_")) {
      this.adAccountId = `act_${this.adAccountId}`;
    }
  }

  /**
   * Make authenticated request to Meta API with retry on rate limit
   * Uses exponential backoff with 200ms base delay
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retries = 3
  ): Promise<T> {
    // Add access token to URL
    const separator = endpoint.includes("?") ? "&" : "?";
    const url = `${META_API_BASE}${endpoint}${separator}access_token=${this.accessToken}`;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const logUrl = url.replace(this.accessToken, "[REDACTED]");
      console.log(`[META] Request: ${logUrl}${attempt > 0 ? ` (retry ${attempt})` : ""}`);

      const response = await fetch(url, {
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      // Handle rate limiting
      if (response.status === 429 && attempt < retries) {
        // Meta rate limit headers
        const retryAfter = response.headers.get("Retry-After");
        let waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 30 * Math.pow(2, attempt);

        console.log(`[META] Rate limited, waiting ${waitSeconds}s before retry...`);
        await new Promise((r) => setTimeout(r, waitSeconds * 1000));
        continue;
      }

      // Handle other errors
      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Meta API error ${response.status}: ${errorText}`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = `Meta API error ${response.status}: ${errorJson.error.message}`;

            // Check for token expiration
            if (errorJson.error.code === 190) {
              console.error("[META] Access token has expired. Please generate a new token.");
            }
          }
        } catch {
          // Use original error text
        }

        throw new Error(errorMessage);
      }

      return response.json();
    }

    throw new Error(`Meta API request failed after ${retries} retries`);
  }

  /**
   * Get all campaigns from the ad account
   */
  async getCampaigns(status?: string): Promise<MetaCampaign[]> {
    const campaigns: MetaCampaign[] = [];
    let after: string | undefined;

    do {
      let endpoint = `/${this.adAccountId}/campaigns?fields=id,name,status,objective,created_time,updated_time&limit=100`;

      if (status) {
        endpoint += `&filtering=[{"field":"effective_status","operator":"IN","value":["${status}"]}]`;
      }

      if (after) {
        endpoint += `&after=${after}`;
      }

      const response = await this.request<MetaApiResponse<MetaCampaign>>(endpoint);
      campaigns.push(...response.data);

      after = response.paging?.cursors?.after;

      // Rate limit buffer
      if (after) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } while (after);

    console.log(`[META] Retrieved ${campaigns.length} campaigns`);
    return campaigns;
  }

  /**
   * Get campaign insights for a date range
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   * @param level - 'campaign' for campaign-level, 'ad' for ad-level
   */
  async getCampaignInsights(
    startDate: string,
    endDate: string
  ): Promise<ParsedCampaignInsight[]> {
    const insights: ParsedCampaignInsight[] = [];
    let after: string | undefined;

    do {
      let endpoint = `/${this.adAccountId}/insights`;
      endpoint += `?fields=${CAMPAIGN_INSIGHT_FIELDS}`;
      endpoint += `&level=campaign`;
      endpoint += `&time_range={"since":"${startDate}","until":"${endDate}"}`;
      endpoint += `&time_increment=1`; // Daily breakdown
      endpoint += `&limit=500`;

      if (after) {
        endpoint += `&after=${after}`;
      }

      const response = await this.request<MetaApiResponse<MetaCampaignInsight>>(endpoint);

      // Parse and transform each insight
      for (const raw of response.data) {
        insights.push(this.parseCampaignInsight(raw));
      }

      after = response.paging?.cursors?.after;

      // Rate limit buffer - 50ms is safe for Meta's dynamic limits
      if (after) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } while (after);

    console.log(`[META] Retrieved ${insights.length} campaign insights for ${startDate} to ${endDate}`);
    return insights;
  }

  /**
   * Get ad-level insights for a date range
   */
  async getAdInsights(
    startDate: string,
    endDate: string
  ): Promise<ParsedAdInsight[]> {
    const insights: ParsedAdInsight[] = [];
    let after: string | undefined;

    do {
      let endpoint = `/${this.adAccountId}/insights`;
      endpoint += `?fields=${AD_INSIGHT_FIELDS}`;
      endpoint += `&level=ad`;
      endpoint += `&time_range={"since":"${startDate}","until":"${endDate}"}`;
      endpoint += `&time_increment=1`; // Daily breakdown
      endpoint += `&limit=500`;

      if (after) {
        endpoint += `&after=${after}`;
      }

      const response = await this.request<MetaApiResponse<MetaAdInsight>>(endpoint);

      // Parse and transform each insight
      for (const raw of response.data) {
        insights.push(this.parseAdInsight(raw));
      }

      after = response.paging?.cursors?.after;

      // Rate limit buffer - 50ms is safe for Meta's dynamic limits
      if (after) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } while (after);

    console.log(`[META] Retrieved ${insights.length} ad insights for ${startDate} to ${endDate}`);
    return insights;
  }

  /**
   * Get ad creative details including high-quality thumbnail URLs
   * @param adIds - Array of ad IDs to fetch
   *
   * Note: Meta's default thumbnail_url is only 64x64 pixels which is too small.
   * To get larger thumbnails (480px), we must query the AdCreative endpoint
   * directly with thumbnail_width parameter - it doesn't work on nested queries.
   *
   * Two-step process:
   * 1. Get creative IDs from ads
   * 2. Query each creative directly with thumbnail_width=480
   */
  async getAdCreatives(adIds: string[]): Promise<Map<string, MetaAdCreative>> {
    const creatives = new Map<string, MetaAdCreative>();

    // Batch requests in groups of 50 to avoid hitting limits
    const batchSize = 50;

    // Step 1: Get creative IDs from ads
    const adToCreativeMap = new Map<string, string>();

    for (let i = 0; i < adIds.length; i += batchSize) {
      const batch = adIds.slice(i, i + batchSize);

      for (const adId of batch) {
        try {
          const endpoint = `/${adId}?fields=creative{id}`;
          const response = await this.request<{ creative?: { id: string } }>(endpoint);

          if (response.creative?.id) {
            adToCreativeMap.set(adId, response.creative.id);
          }
        } catch (error) {
          console.warn(`[META] Failed to get creative ID for ad ${adId}:`, error);
        }

        // Reduced delay - Meta rate limits are dynamic, 10ms is usually safe
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (i + batchSize < adIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    console.log(`[META] Found ${adToCreativeMap.size} creative IDs from ${adIds.length} ads`);

    // Step 2: Query each creative directly with thumbnail_width=480
    const creativeIds = [...new Set(adToCreativeMap.values())];

    for (let i = 0; i < creativeIds.length; i += batchSize) {
      const batch = creativeIds.slice(i, i + batchSize);

      for (const creativeId of batch) {
        try {
          // Query creative directly with thumbnail_width parameter
          // This gives us 480x480 thumbnails instead of 64x64
          const endpoint = `/${creativeId}?fields=id,name,thumbnail_url,object_type,image_url&thumbnail_width=480&thumbnail_height=480`;
          const response = await this.request<MetaAdCreative>(endpoint);

          if (response) {
            // Store by creative ID
            creatives.set(creativeId, response);
          }
        } catch (error) {
          console.warn(`[META] Failed to get creative ${creativeId}:`, error);
        }

        // Reduced delay for faster sync
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      if (i + batchSize < creativeIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`[META] Retrieved ${creatives.size} ad creatives with high-res thumbnails`);

    // Return map keyed by ad ID (not creative ID)
    const result = new Map<string, MetaAdCreative>();
    for (const [adId, creativeId] of adToCreativeMap) {
      const creative = creatives.get(creativeId);
      if (creative) {
        result.set(adId, creative);
      }
    }

    return result;
  }

  /**
   * Get account-level spend summary for quick validation
   */
  async getAccountSpendSummary(
    startDate: string,
    endDate: string
  ): Promise<{ spend: number; impressions: number; clicks: number }> {
    const endpoint = `/${this.adAccountId}/insights?fields=spend,impressions,clicks&time_range={"since":"${startDate}","until":"${endDate}"}`;

    const response = await this.request<MetaApiResponse<{
      spend: string;
      impressions: string;
      clicks: string;
    }>>(endpoint);

    const data = response.data[0] || { spend: "0", impressions: "0", clicks: "0" };

    return {
      spend: parseFloat(data.spend) || 0,
      impressions: parseInt(data.impressions, 10) || 0,
      clicks: parseInt(data.clicks, 10) || 0,
    };
  }

  /**
   * Parse raw campaign insight into database-ready format
   */
  private parseCampaignInsight(raw: MetaCampaignInsight): ParsedCampaignInsight {
    const spend = parseFloat(raw.spend) || 0;
    const purchases = this.extractActionValue(raw.actions, "purchase") ||
                      this.extractActionValue(raw.actions, "omni_purchase") || 0;
    const purchaseValue = this.extractActionValue(raw.action_values, "purchase") ||
                          this.extractActionValue(raw.action_values, "omni_purchase") || 0;

    return {
      meta_campaign_id: raw.campaign_id,
      name: raw.campaign_name,
      objective: raw.objective || null,
      date: raw.date_start, // Daily breakdown means date_start = date_stop
      spend,
      impressions: parseInt(raw.impressions, 10) || 0,
      reach: raw.reach ? parseInt(raw.reach, 10) : null,
      frequency: raw.frequency ? parseFloat(raw.frequency) : null,
      clicks: parseInt(raw.clicks, 10) || 0,
      ctr: raw.ctr ? parseFloat(raw.ctr) : null,
      cpc: raw.cpc ? parseFloat(raw.cpc) : null,
      cpm: raw.cpm ? parseFloat(raw.cpm) : null,
      purchases,
      purchase_value: purchaseValue,
      add_to_carts: this.extractActionValue(raw.actions, "add_to_cart") ||
                    this.extractActionValue(raw.actions, "omni_add_to_cart") || 0,
      initiated_checkouts: this.extractActionValue(raw.actions, "initiate_checkout") ||
                           this.extractActionValue(raw.actions, "omni_initiated_checkout") || 0,
      platform_roas: spend > 0 ? purchaseValue / spend : null,
    };
  }

  /**
   * Parse raw ad insight into database-ready format
   */
  private parseAdInsight(raw: MetaAdInsight): ParsedAdInsight {
    const purchases = this.extractActionValue(raw.actions, "purchase") ||
                      this.extractActionValue(raw.actions, "omni_purchase") || 0;
    const purchaseValue = this.extractActionValue(raw.action_values, "purchase") ||
                          this.extractActionValue(raw.action_values, "omni_purchase") || 0;

    return {
      meta_ad_id: raw.ad_id,
      meta_adset_id: raw.adset_id || null,
      meta_campaign_id: raw.campaign_id,
      ad_name: raw.ad_name || null,
      adset_name: raw.adset_name || null,
      campaign_name: raw.campaign_name || null,
      date: raw.date_start,
      creative_type: null, // Will be populated from creative fetch
      thumbnail_url: null, // Will be populated from creative fetch
      spend: parseFloat(raw.spend) || 0,
      impressions: parseInt(raw.impressions, 10) || 0,
      clicks: parseInt(raw.clicks, 10) || 0,
      ctr: raw.ctr ? parseFloat(raw.ctr) : null,
      purchases,
      purchase_value: purchaseValue,
    };
  }

  /**
   * Extract numeric value from Meta actions array
   */
  private extractActionValue(actions: MetaAction[] | undefined, actionType: string): number {
    if (!actions) return 0;

    const action = actions.find((a) => a.action_type === actionType);
    return action ? parseFloat(action.value) || 0 : 0;
  }
}

// ============================================================
// Factory
// ============================================================

export function createMetaClient(): MetaClient {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!accessToken) {
    throw new Error("Missing Meta configuration. Required env var: META_ACCESS_TOKEN");
  }

  if (!adAccountId) {
    throw new Error("Missing Meta configuration. Required env var: META_AD_ACCOUNT_ID");
  }

  return new MetaClient({ accessToken, adAccountId });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Get date range for historical sync (37 months for Meta max)
 */
export function getHistoricalDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 37);

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * Get date range for daily sync (90 days to capture attribution changes)
 * Used for campaign-level data where attribution accuracy matters
 */
export function getDailySyncDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * Get date range for ad-level sync (30 days)
 * Shorter than campaign sync because:
 * 1. Ad-level data generates ~4x more rows (200 ads × 90 days = huge)
 * 2. Creative fatigue detection only needs ~30 days of CTR trend
 * 3. Meta attribution typically settles within 7-14 days
 */
export function getAdInsightsSyncDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * Format date as YYYY-MM-DD for Meta API
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Get date range for a specific month
 */
export function getMonthDateRange(year: number, month: number): { startDate: string; endDate: string } {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0); // Last day of month

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

/**
 * Generate array of months for historical backfill
 * Used for batching requests to avoid timeout
 */
export function getHistoricalMonths(monthsBack = 37): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  const now = new Date();

  for (let i = 0; i < monthsBack; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: date.getFullYear(), month: date.getMonth() });
  }

  return months;
}
