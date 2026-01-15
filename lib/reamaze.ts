/**
 * Re:amaze API Client
 * Fetches customer service conversations for AI classification
 * Includes CSAT (Customer Satisfaction) ratings support
 */

export interface ReamazeSatisfactionRating {
  id: string;
  rating: number | null; // 1-5 scale
  comment: string | null;
  user_id: string;
  assignee_id: string;
  conversation_id: string;
  created_at: string;
  updated_at: string;
}

export interface ReamazeSatisfactionResponse {
  page_size: number;
  page_count: number;
  total_count: number;
  satisfaction_ratings: ReamazeSatisfactionRating[];
}

export interface ReamazeMessage {
  body: string;
  created_at: string;
}

export interface ReamazeCategory {
  channel: number;
  name?: string;
  slug?: string;
}

export interface ReamazeAuthor {
  id: number;
  name: string;
  email: string;
  data?: {
    "(smithey-iron-ware.myshopify.com) Order count"?: string;
    "(smithey-iron-ware.myshopify.com) Total spent"?: string;
    "(smithey-iron-ware.myshopify.com) Recent order"?: string | null;
    [key: string]: string | null | undefined;
  };
}

export interface ReamazeConversation {
  slug: string; // Unique identifier
  subject: string | null;
  status: string;
  created_at: string;
  message: ReamazeMessage; // First message
  last_customer_message?: ReamazeMessage;
  category: ReamazeCategory;
  tag_list?: string[];
  author?: ReamazeAuthor; // Customer who created the conversation
  perma_url: string; // Public permalink with auth token (e.g., .../perma?token=xxx)
}

export interface ReamazeConversationsResponse {
  conversations: ReamazeConversation[];
  page_count: number;
  page_size: number;
  total_count: number;
}

interface ReamazeClientConfig {
  brand: string; // Subdomain (e.g., 'smithey')
  email: string;
  apiToken: string;
}

const EXCLUDED_CHANNELS = [10]; // Channel 10 is excluded (from Make.com filter)

export class ReamazeClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ReamazeClientConfig) {
    this.baseUrl = `https://${config.brand}.reamaze.com/api/v1`;
    // Basic auth: email:token base64 encoded
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
  }

  /**
   * Fetch conversations with optional filters
   */
  async getConversations(options: {
    filter?: "archived" | "open" | "unassigned" | "all";
    startDate?: string; // ISO8601
    endDate?: string; // ISO8601
    page?: number;
    sort?: "updated" | "changed";
  } = {}): Promise<ReamazeConversationsResponse> {
    const params = new URLSearchParams();

    if (options.filter) params.set("filter", options.filter);
    if (options.startDate) params.set("start_date", options.startDate);
    if (options.endDate) params.set("end_date", options.endDate);
    if (options.page) params.set("page", options.page.toString());
    if (options.sort) params.set("sort", options.sort);

    const url = `${this.baseUrl}/conversations${params.toString() ? `?${params}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": this.authHeader,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Re:amaze API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  /**
   * Fetch a single conversation by slug
   */
  async getConversation(slug: string): Promise<ReamazeConversation> {
    const url = `${this.baseUrl}/conversations/${slug}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": this.authHeader,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Re:amaze API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.conversation;
  }

  /**
   * Fetch all new conversations since a given date
   * Handles pagination and filters out excluded channels
   */
  async fetchNewConversations(sinceDate: string): Promise<ReamazeConversation[]> {
    const allConversations: ReamazeConversation[] = [];
    let page = 1;
    let hasMore = true;

    console.log(`Fetching conversations since ${sinceDate}...`);

    while (hasMore) {
      const response = await this.getConversations({
        filter: "all",
        startDate: sinceDate,
        page,
        sort: "changed",
      });

      const filtered = response.conversations.filter(
        (conv) => !EXCLUDED_CHANNELS.includes(conv.category?.channel)
      );

      allConversations.push(...filtered);

      console.log(`Page ${page}: ${response.conversations.length} total, ${filtered.length} after filter`);

      // Check if there are more pages
      hasMore = page < response.page_count;
      page++;

      // Rate limiting - be nice to the API
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    console.log(`Total conversations fetched: ${allConversations.length}`);
    return allConversations;
  }

  /**
   * Build permalink URL for a conversation
   */
  static getPermalink(brand: string, slug: string): string {
    return `https://${brand}.reamaze.com/conversations/${slug}`;
  }

  /**
   * Fetch satisfaction ratings (CSAT scores)
   * Requires access_reports permission
   */
  async getSatisfactionRatings(options: {
    rating?: number; // 1-5 filter
    createdAfter?: string; // ISO8601
    createdBefore?: string; // ISO8601
    page?: number;
  } = {}): Promise<ReamazeSatisfactionResponse> {
    const params = new URLSearchParams();

    if (options.rating) params.set("rating", options.rating.toString());
    if (options.createdAfter) params.set("created_after", options.createdAfter);
    if (options.createdBefore) params.set("created_before", options.createdBefore);
    if (options.page) params.set("page", options.page.toString());

    const url = `${this.baseUrl}/satisfaction_ratings${params.toString() ? `?${params}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": this.authHeader,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Re:amaze API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  /**
   * Fetch all CSAT ratings for a date range
   * Returns CSAT metrics summary
   */
  async fetchCSATMetrics(startDate: string, endDate: string): Promise<{
    totalRatings: number;
    averageScore: number;
    distribution: { [key: number]: number }; // 1-5 distribution
    satisfactionRate: number; // % of 4-5 ratings
  }> {
    const allRatings: ReamazeSatisfactionRating[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getSatisfactionRatings({
        createdAfter: startDate,
        createdBefore: endDate,
        page,
      });

      allRatings.push(...response.satisfaction_ratings);
      hasMore = page < response.page_count;
      page++;

      // Rate limiting
      if (hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // Calculate metrics
    const validRatings = allRatings.filter((r) => r.rating !== null);
    const totalRatings = validRatings.length;

    const distribution: { [key: number]: number } = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    for (const r of validRatings) {
      if (r.rating !== null) {
        distribution[r.rating] = (distribution[r.rating] || 0) + 1;
        sum += r.rating;
      }
    }

    const averageScore = totalRatings > 0 ? Math.round((sum / totalRatings) * 100) / 100 : 0;
    const satisfiedCount = (distribution[4] || 0) + (distribution[5] || 0);
    const satisfactionRate = totalRatings > 0
      ? Math.round((satisfiedCount / totalRatings) * 1000) / 10
      : 0;

    return {
      totalRatings,
      averageScore,
      distribution,
      satisfactionRate,
    };
  }
}

/**
 * Create a Re:amaze client from environment variables
 */
export function createReamazeClient(): ReamazeClient {
  const brand = process.env.REAMAZE_BRAND;
  const email = process.env.REAMAZE_EMAIL;
  const apiToken = process.env.REAMAZE_API_TOKEN;

  if (!brand || !email || !apiToken) {
    throw new Error(
      "Missing Re:amaze configuration. Required env vars: REAMAZE_BRAND, REAMAZE_EMAIL, REAMAZE_API_TOKEN"
    );
  }

  return new ReamazeClient({ brand, email, apiToken });
}

/**
 * Extract clean message body from HTML
 * Re:amaze returns HTML, we need plain text for AI classification
 */
export function cleanMessageBody(html: string): string {
  if (!html) return "";

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Truncate if too long (for AI token limits)
  const MAX_LENGTH = 4000;
  if (text.length > MAX_LENGTH) {
    text = text.substring(0, MAX_LENGTH) + "...";
  }

  return text;
}
