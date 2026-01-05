/**
 * Google Ads API Client
 *
 * Provides read-only access to Google Ads campaign performance data.
 * Uses the official google-ads-api library.
 */

import { GoogleAdsApi, enums } from "google-ads-api";

/**
 * Validate that a string is a valid YYYY-MM-DD date format
 * Prevents GAQL injection by ensuring only valid date strings are used in queries
 */
function validateDateFormat(date: string, fieldName: string): void {
  // Strict regex: exactly YYYY-MM-DD with valid ranges
  const dateRegex = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

  if (!dateRegex.test(date)) {
    throw new Error(
      `Invalid ${fieldName} format: "${date}". Expected YYYY-MM-DD format.`
    );
  }

  // Additional validation: ensure it's a real date (not like 2024-02-31)
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid ${fieldName}: "${date}" is not a valid date.`
    );
  }

  // Sanity check: date should reconstruct to the same string
  const reconstructed = parsed.toISOString().split("T")[0];
  if (reconstructed !== date) {
    throw new Error(
      `Invalid ${fieldName}: "${date}" does not represent a real calendar date.`
    );
  }
}

export interface GoogleCampaignInsight {
  google_campaign_id: string;
  name: string;
  status: string;
  campaign_type: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  conversions: number;
  conversion_value: number;
  cost_per_conversion: number | null;
  search_impression_share: number | null;
  platform_roas: number | null;
}

class GoogleAdsClient {
  private client: GoogleAdsApi;
  private customerId: string;

  constructor() {
    this.client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    });
    this.customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!;
  }

  private getCustomer() {
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;

    return this.client.Customer({
      customer_id: this.customerId,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      // If accessing through a manager account, specify the login customer ID
      ...(loginCustomerId && { login_customer_id: loginCustomerId }),
    });
  }

  /**
   * Test the connection by fetching account info
   */
  async testConnection(): Promise<{
    success: boolean;
    accountName?: string;
    error?: string;
  }> {
    try {
      const customer = this.getCustomer();

      const result = await customer.query(`
        SELECT customer.id, customer.descriptive_name
        FROM customer
        LIMIT 1
      `);

      if (result && result.length > 0) {
        const name = result[0].customer?.descriptive_name || `Account ${this.customerId}`;
        return { success: true, accountName: name };
      }

      return { success: true, accountName: `Account ${this.customerId}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get list of campaigns
   */
  async getCampaigns(): Promise<
    Array<{
      id: string;
      name: string;
      status: string;
      type: string;
    }>
  > {
    const customer = this.getCustomer();

    const result = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `);

    return result.map((row) => ({
      id: String(row.campaign?.id || ""),
      name: row.campaign?.name || "",
      status: row.campaign?.status
        ? String(enums.CampaignStatus[row.campaign.status] ?? "UNKNOWN")
        : "UNKNOWN",
      type: row.campaign?.advertising_channel_type
        ? String(enums.AdvertisingChannelType[row.campaign.advertising_channel_type] ?? "UNKNOWN")
        : "UNKNOWN",
    }));
  }

  /**
   * Get campaign performance insights for a date range
   */
  async getCampaignInsights(
    startDate: string,
    endDate: string
  ): Promise<GoogleCampaignInsight[]> {
    // Validate date formats to prevent GAQL injection
    validateDateFormat(startDate, "startDate");
    validateDateFormat(endDate, "endDate");

    const customer = this.getCustomer();

    const result = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.conversions,
        metrics.conversions_value,
        metrics.search_impression_share
      FROM campaign
      WHERE segments.date >= '${startDate}'
        AND segments.date <= '${endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date DESC, metrics.cost_micros DESC
    `);

    return result.map((row) => {
      const spend = Number(row.metrics?.cost_micros || 0) / 1_000_000;
      const conversions = row.metrics?.conversions || 0;
      const conversionValue = row.metrics?.conversions_value || 0;
      const impressions = Number(row.metrics?.impressions || 0);
      const clicks = Number(row.metrics?.clicks || 0);

      return {
        google_campaign_id: String(row.campaign?.id || ""),
        name: row.campaign?.name || "",
        status: row.campaign?.status
          ? String(enums.CampaignStatus[row.campaign.status] ?? "UNKNOWN")
          : "UNKNOWN",
        campaign_type: row.campaign?.advertising_channel_type
          ? String(enums.AdvertisingChannelType[row.campaign.advertising_channel_type] ?? "UNKNOWN")
          : "UNKNOWN",
        date: row.segments?.date || "",
        spend,
        impressions,
        clicks,
        ctr: row.metrics?.ctr || null,
        cpc: row.metrics?.average_cpc
          ? Number(row.metrics.average_cpc) / 1_000_000
          : null,
        cpm: row.metrics?.average_cpm
          ? Number(row.metrics.average_cpm) / 1_000_000
          : null,
        conversions,
        conversion_value: conversionValue,
        cost_per_conversion: conversions > 0 ? spend / conversions : null,
        search_impression_share: row.metrics?.search_impression_share || null,
        platform_roas: spend > 0 ? conversionValue / spend : null,
      };
    });
  }
}

let clientInstance: GoogleAdsClient | null = null;

/**
 * Create or return singleton Google Ads client
 */
export function createGoogleAdsClient(): GoogleAdsClient {
  // Validate required config
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing Google Ads config: ${missing.join(", ")}`);
  }

  if (!clientInstance) {
    clientInstance = new GoogleAdsClient();
  }

  return clientInstance;
}

export { GoogleAdsClient };
