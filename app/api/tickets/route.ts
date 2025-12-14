/**
 * Voice of Customer API
 * Returns tickets with TOR, sentiment-enhanced word cloud, auto-insights, and executive metrics
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  TicketsResponse,
  SupportTicket,
  TicketCategoryCount,
  TicketSentimentBreakdown,
  TicketAlertCounts,
  TicketCategory,
  WordCloudItem,
  TopicTheme,
  VOCInsight,
  CSATMetrics,
  PurchaseTimingBreakdown,
} from "@/lib/types";
import { createReamazeClient } from "@/lib/reamaze";
import { checkRateLimit, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEMS_PER_PAGE = 50;

export async function GET(request: Request) {
  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const rateLimitResult = checkRateLimit(`tickets:${ip}`, RATE_LIMITS.API);
  if (!rateLimitResult.success) {
    return rateLimitedResponse(rateLimitResult);
  }

  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const page = parseInt(searchParams.get("page") || "1", 10);
    const category = searchParams.get("category");
    const sentiment = searchParams.get("sentiment");
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const search = searchParams.get("search");

    // Default date range: last 30 days
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rangeStart = startDate ? new Date(startDate) : defaultStart;
    const rangeEnd = endDate ? new Date(endDate) : now;

    // Calculate previous period for delta comparison
    const rangeDuration = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeEnd = new Date(rangeStart.getTime() - 1);
    const prevRangeStart = new Date(prevRangeEnd.getTime() - rangeDuration);

    // Build base query for current period (paginated with filters)
    let ticketsQuery = supabase
      .from("support_tickets")
      .select("id, reamaze_id, created_at, subject, category, sentiment, summary, urgency, perma_url", { count: "exact" })
      .gte("created_at", rangeStart.toISOString())
      .lte("created_at", rangeEnd.toISOString())
      .order("created_at", { ascending: false });

    // Apply filters
    if (category) {
      ticketsQuery = ticketsQuery.eq("category", category);
    }
    if (sentiment) {
      ticketsQuery = ticketsQuery.eq("sentiment", sentiment);
    }
    if (search) {
      const escapedSearch = search.replace(/[%_\\]/g, "\\$&");
      ticketsQuery = ticketsQuery.or(
        `summary.ilike.%${escapedSearch}%,subject.ilike.%${escapedSearch}%`
      );
    }

    // Pagination
    const offset = (page - 1) * ITEMS_PER_PAGE;
    ticketsQuery = ticketsQuery.range(offset, offset + ITEMS_PER_PAGE - 1);

    // Execute ALL queries in parallel for performance
    const [
      ticketsResult,
      allTicketsResult,
      prevTicketsResult,
      orderCountResult,
      prevOrderCountResult,
      lastSyncedResult,
      dailyTicketsResult,
      dailyOrdersResult,
    ] = await Promise.all([
      // Paginated tickets for display
      ticketsQuery,
      // All tickets for aggregates (current period) - includes order_count for purchase timing
      supabase
        .from("support_tickets")
        .select("category, sentiment, summary, order_count, customer_email")
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", rangeEnd.toISOString()),
      // Previous period tickets for delta
      supabase
        .from("support_tickets")
        .select("category, sentiment, summary")
        .gte("created_at", prevRangeStart.toISOString())
        .lte("created_at", prevRangeEnd.toISOString()),
      // Order count (current period)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", rangeEnd.toISOString())
        .eq("canceled", false),
      // Order count (previous period)
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("created_at", prevRangeStart.toISOString())
        .lte("created_at", prevRangeEnd.toISOString())
        .eq("canceled", false),
      // Last synced time
      supabase
        .from("support_tickets")
        .select("synced_at")
        .order("synced_at", { ascending: false })
        .limit(1)
        .single(),
      // Daily ticket counts for TOR trend chart
      supabase
        .from("support_tickets")
        .select("created_at")
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", rangeEnd.toISOString()),
      // Daily order counts for TOR trend chart
      supabase
        .from("orders")
        .select("created_at")
        .gte("created_at", rangeStart.toISOString())
        .lte("created_at", rangeEnd.toISOString())
        .eq("canceled", false),
    ]);

    // Destructure results
    const { data: tickets, count: totalCount, error: ticketsError } = ticketsResult;
    const { data: allTickets, error: allError } = allTicketsResult;
    const { data: prevTickets, error: prevError } = prevTicketsResult;
    const { count: orderCount, error: orderError } = orderCountResult;
    const { count: prevOrderCount, error: prevOrderError } = prevOrderCountResult;
    const { data: lastSyncedData } = lastSyncedResult;
    const { data: dailyTickets } = dailyTicketsResult;
    const { data: dailyOrders } = dailyOrdersResult;

    if (ticketsError) {
      throw new Error(`Tickets query error: ${ticketsError.message}`);
    }
    if (allError) {
      throw new Error(`All tickets query error: ${allError.message}`);
    }
    if (prevError) {
      throw new Error(`Previous period query error: ${prevError.message}`);
    }
    if (orderError) {
      console.error("Order count error:", orderError.message);
    }
    if (prevOrderError) {
      console.error("Previous order count error:", prevOrderError.message);
    }

    const currentOrderCount = orderCount || 0;
    const previousOrderCount = prevOrderCount || 0;
    const currentTicketCount = allTickets?.length || 0;
    const previousTicketCount = prevTickets?.length || 0;

    // Calculate TOR (Ticket-to-Order Ratio)
    const ticketToOrderRatio =
      currentOrderCount > 0
        ? Math.round((currentTicketCount / currentOrderCount) * 1000) / 10
        : 0;
    const previousTOR =
      previousOrderCount > 0
        ? Math.round((previousTicketCount / previousOrderCount) * 1000) / 10
        : 0;

    // Calculate category counts with delta
    const categoryCounts = calculateCategoryCounts(
      allTickets || [],
      prevTickets || []
    );

    // Calculate sentiment breakdown
    const sentimentBreakdown = calculateSentimentBreakdown(allTickets || []);

    // Calculate alert counts
    const alertCounts = calculateAlertCounts(allTickets || []);

    // Generate word cloud with sentiment context
    const wordCloud = generateWordCloud(allTickets || []);

    // Generate topic themes with deltas
    const topicThemes = generateTopicThemes(allTickets || [], prevTickets || []);

    // Generate AI-style insights
    const insights = generateInsights(
      allTickets || [],
      prevTickets || [],
      alertCounts,
      categoryCounts,
      ticketToOrderRatio,
      previousTOR,
      sentimentBreakdown
    );

    // Calculate TOR trend data for line chart
    const torTrend = calculateTORTrend(dailyTickets || [], dailyOrders || []);

    // Calculate pre/post purchase timing breakdown
    const purchaseTiming = calculatePurchaseTiming(allTickets || []);

    // Note: CSAT from Re:amaze is disabled for performance
    // Re:amaze API calls add 2-4 seconds of latency
    // If CSAT is needed, implement as separate endpoint

    const response: TicketsResponse = {
      tickets: (tickets || []) as SupportTicket[],
      totalCount: totalCount || 0,
      previousTotalCount: previousTicketCount,
      orderCount: currentOrderCount,
      previousOrderCount: previousOrderCount,
      ticketToOrderRatio,
      previousTOR,
      categoryCounts,
      sentimentBreakdown,
      alertCounts,
      wordCloud,
      topicThemes,
      insights,
      torTrend,
      purchaseTiming,
      lastSynced: lastSyncedData?.synced_at || null,
    };

    // Add cache headers - tickets sync hourly, cache for 60s
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error("[TICKETS API] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch tickets",
      },
      { status: 500 }
    );
  }
}

function calculateCategoryCounts(
  current: { category: string; sentiment: string }[],
  previous: { category: string; sentiment: string }[]
): TicketCategoryCount[] {
  // Count current period
  const currentCounts = new Map<string, number>();
  for (const ticket of current) {
    currentCounts.set(
      ticket.category,
      (currentCounts.get(ticket.category) || 0) + 1
    );
  }

  // Count previous period
  const prevCounts = new Map<string, number>();
  for (const ticket of previous) {
    prevCounts.set(
      ticket.category,
      (prevCounts.get(ticket.category) || 0) + 1
    );
  }

  // Build result with deltas
  const results: TicketCategoryCount[] = [];
  const allCategories = new Set([...currentCounts.keys(), ...prevCounts.keys()]);

  for (const category of allCategories) {
    const currentCount = currentCounts.get(category) || 0;
    const prevCount = prevCounts.get(category) || 0;
    const delta = currentCount - prevCount;

    if (currentCount > 0) {
      results.push({
        category: category as TicketCategory,
        count: currentCount,
        delta,
      });
    }
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count);

  return results;
}

function calculateSentimentBreakdown(
  tickets: { category: string; sentiment: string }[]
): TicketSentimentBreakdown {
  const total = tickets.length || 1; // Avoid division by zero

  const counts = {
    positive: 0,
    neutral: 0,
    negative: 0,
    mixed: 0,
  };

  for (const ticket of tickets) {
    const sentiment = ticket.sentiment?.toLowerCase() || "neutral";
    if (sentiment === "positive") counts.positive++;
    else if (sentiment === "negative") counts.negative++;
    else if (sentiment === "mixed") counts.mixed++;
    else counts.neutral++;
  }

  return {
    positive: counts.positive,
    neutral: counts.neutral,
    negative: counts.negative,
    mixed: counts.mixed,
    positivePct: Math.round((counts.positive / total) * 1000) / 10,
    neutralPct: Math.round((counts.neutral / total) * 1000) / 10,
    negativePct: Math.round((counts.negative / total) * 1000) / 10,
    mixedPct: Math.round((counts.mixed / total) * 1000) / 10,
  };
}

function calculateAlertCounts(
  tickets: { category: string; sentiment: string }[]
): TicketAlertCounts {
  let qualityNegative = 0;
  let deliveryProblems = 0;
  let returnRequests = 0;
  let allNegative = 0;

  for (const ticket of tickets) {
    const category = ticket.category;
    const sentiment = ticket.sentiment?.toLowerCase();

    // All negative reviews
    if (sentiment === "negative") {
      allNegative++;

      // Quality issues that are negative
      if (category === "Quality Issue") {
        qualityNegative++;
      }
    }

    // Delivery problems (any sentiment)
    if (category === "Delivery Delay or Problem") {
      deliveryProblems++;
    }

    // Return requests (any sentiment)
    if (category === "Return or Exchange") {
      returnRequests++;
    }
  }

  return {
    qualityNegative,
    deliveryProblems,
    returnRequests,
    allNegative,
  };
}

// Stop words to filter out from word cloud
const STOP_WORDS = new Set([
  // Common English stop words
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "under", "again", "further", "then", "once", "here",
  "there", "when", "where", "why", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "also", "now", "about", "regarding", "their", "they", "them", "this", "that",
  "these", "those", "what", "which", "who", "whom", "and", "but",
  "if", "or", "because", "until", "while", "although", "though",
  "since", "unless", "however", "therefore", "thus", "hence", "whereas",
  "whether", "yet", "still", "even", "like", "well", "made", "make",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves", "he", "him",
  "his", "himself", "she", "her", "hers", "herself", "it", "its",
  "itself", "who", "whom", "whose", "which", "that", "what",

  // AI summary boilerplate - these pollute word clouds
  "customer", "customers", "inquiry", "inquiring", "inquires",
  "asking", "asks", "asked", "wants", "want", "wanted", "needing",
  "needs", "needed", "request", "requests", "requesting", "requested",
  "seeking", "seeks", "assistance", "help", "support", "information",
  "urgency", "urgent", "high", "medium", "low", "immediate", "immediately",
  "neutral", "positive", "negative", "mixed", "sentiment", "sensitive",
  "resolution", "resolved", "resolving", "attention", "required", "requires",
  "potential", "possibly", "possible", "likely", "unlikely", "expected",
  "regarding", "concerning", "related", "reports", "reporting",
  "experiencing", "experiences", "experience", "noticed", "noticing",
  "appears", "appearing", "seems", "appear", "seem",
  "clarification", "guidance", "advice", "update", "updates",

  // Domain-specific noise (too generic)
  "smithey", "ironware", "product", "products", "order", "orders",
  "issue", "issues", "problem", "problems", "concern", "concerns",
  "received", "purchased", "recently", "purchase", "bought",
  "cookware", "item", "items", "pans", "piece",
  "free", "address", "status", "question", "questions",
]);

// Smithey-relevant keywords to boost (no generic product terms)
const BOOST_WORDS = new Set([
  "dutch", "oven", "carbon", "steel", "cast", "iron",
  "seasoning", "engraving", "leather", "handle", "lid", "glass",
  "shipping", "delivery", "tracking", "return", "exchange", "refund",
  "quality", "defect", "damaged", "rust", "scratch", "warranty",
  "gift", "holiday", "christmas", "sale", "discount", "promo",
  "wholesale", "bulk", "factory", "seconds", "cooking", "recipe",
]);

function generateWordCloud(
  tickets: { category: string; sentiment: string; summary?: string }[]
): WordCloudItem[] {
  // Track word counts and sentiment scores
  const wordData = new Map<
    string,
    { count: number; positive: number; negative: number; neutral: number }
  >();

  for (const ticket of tickets) {
    if (!ticket.summary) continue;

    const sentiment = ticket.sentiment?.toLowerCase() || "neutral";

    // Extract words from summary
    const words = ticket.summary
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

    for (const word of words) {
      const existing = wordData.get(word) || {
        count: 0,
        positive: 0,
        negative: 0,
        neutral: 0,
      };
      const boost = BOOST_WORDS.has(word) ? 2 : 1;
      existing.count += boost;
      if (sentiment === "positive") existing.positive++;
      else if (sentiment === "negative") existing.negative++;
      else existing.neutral++;
      wordData.set(word, existing);
    }
  }

  // Sort by frequency and take top 40
  const sorted = [...wordData.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 40);

  return sorted.map(([text, data]) => {
    const total = data.positive + data.negative + data.neutral || 1;
    // Calculate sentiment score: -1 (all negative) to +1 (all positive)
    const sentimentScore =
      (data.positive - data.negative) / total;

    let sentiment: "positive" | "negative" | "neutral" | "mixed";
    if (sentimentScore > 0.3) sentiment = "positive";
    else if (sentimentScore < -0.3) sentiment = "negative";
    else if (data.positive > 0 && data.negative > 0) sentiment = "mixed";
    else sentiment = "neutral";

    return {
      text,
      value: data.count,
      sentiment,
      sentimentScore: Math.round(sentimentScore * 100) / 100,
    };
  });
}

// Topic theme definitions - grouping categories into meaningful themes
const TOPIC_THEME_CONFIG = [
  {
    name: "Product Issues",
    categories: [
      "Quality Issue",
      "Seasoning Issue",
      "Dutch Oven Issue",
      "Glass Lid Issue",
    ],
    defaultSentiment: "negative" as const,
  },
  {
    name: "Order Management",
    categories: ["Order Status", "Order Cancellation or Edit", "Ordering Inquiry"],
    defaultSentiment: "neutral" as const,
  },
  {
    name: "Shipping & Delivery",
    categories: [
      "Shipping Status",
      "Shipping Setup Issue",
      "Delivery Delay or Problem",
    ],
    defaultSentiment: "neutral" as const,
  },
  {
    name: "Returns & Exchanges",
    categories: ["Return or Exchange"],
    defaultSentiment: "negative" as const,
  },
  {
    name: "Product Questions",
    categories: [
      "Product Inquiry",
      "Product Recommendation",
      "Cooking Advice",
      "Engraving Question",
    ],
    defaultSentiment: "neutral" as const,
  },
  {
    name: "Sales & Promotions",
    categories: [
      "Promotion or Sale Inquiry",
      "Factory Seconds Question",
      "Wholesale Request",
    ],
    defaultSentiment: "positive" as const,
  },
  {
    name: "Positive Feedback",
    categories: ["Positive Feedback"],
    defaultSentiment: "positive" as const,
  },
];

function generateTopicThemes(
  current: { category: string; sentiment: string; summary?: string }[],
  previous: { category: string; sentiment: string; summary?: string }[]
): TopicTheme[] {
  const themes: TopicTheme[] = [];

  for (const config of TOPIC_THEME_CONFIG) {
    const currentTickets = current.filter((t) =>
      config.categories.includes(t.category)
    );
    const prevTickets = previous.filter((t) =>
      config.categories.includes(t.category)
    );

    const currentCount = currentTickets.length;
    const prevCount = prevTickets.length;

    if (currentCount === 0 && prevCount === 0) continue;

    const delta = currentCount - prevCount;
    const deltaPct =
      prevCount > 0
        ? Math.round(((currentCount - prevCount) / prevCount) * 100)
        : currentCount > 0
          ? 100
          : 0;

    // Calculate dominant sentiment for this theme
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    for (const t of currentTickets) {
      const s = t.sentiment?.toLowerCase() || "neutral";
      if (s in sentimentCounts) {
        sentimentCounts[s as keyof typeof sentimentCounts]++;
      }
    }

    let dominantSentiment: "positive" | "negative" | "neutral" | "mixed" =
      config.defaultSentiment;
    const maxCount = Math.max(...Object.values(sentimentCounts));
    if (maxCount > 0) {
      for (const [s, count] of Object.entries(sentimentCounts)) {
        if (count === maxCount) {
          dominantSentiment = s as typeof dominantSentiment;
          break;
        }
      }
    }

    themes.push({
      name: config.name,
      count: currentCount,
      previousCount: prevCount,
      delta,
      deltaPct,
      sentiment: dominantSentiment,
      categories: config.categories.filter((c) =>
        currentTickets.some((t) => t.category === c)
      ),
    });
  }

  // Sort by count descending
  themes.sort((a, b) => b.count - a.count);

  return themes;
}

function generateInsights(
  current: { category: string; sentiment: string; summary?: string }[],
  previous: { category: string; sentiment: string; summary?: string }[],
  alerts: TicketAlertCounts,
  categories: TicketCategoryCount[],
  currentTOR: number,
  prevTOR: number,
  sentiment: TicketSentimentBreakdown
): VOCInsight[] {
  const insights: VOCInsight[] = [];

  // TOR trend insight
  const torChange = currentTOR - prevTOR;
  if (Math.abs(torChange) > 0.2) {
    if (torChange > 0) {
      insights.push({
        type: "alert",
        title: "TOR Increasing",
        description: `Ticket-to-Order ratio is up ${torChange.toFixed(1)}% from last period. More customers are reaching out relative to orders.`,
        metric: `${currentTOR.toFixed(1)}%`,
        action: "Review top ticket categories for systemic issues",
      });
    } else {
      insights.push({
        type: "positive",
        title: "TOR Improving",
        description: `Ticket-to-Order ratio is down ${Math.abs(torChange).toFixed(1)}% from last period.`,
        metric: `${currentTOR.toFixed(1)}%`,
      });
    }
  }

  // Quality issues alert
  if (alerts.qualityNegative > 10) {
    const prevQuality =
      previous.filter(
        (t) =>
          t.category === "Quality Issue" &&
          t.sentiment?.toLowerCase() === "negative"
      ).length;
    const qualityChange = alerts.qualityNegative - prevQuality;
    const qualityPctChange =
      prevQuality > 0
        ? Math.round((qualityChange / prevQuality) * 100)
        : alerts.qualityNegative > 0
          ? 100
          : 0;

    if (qualityChange > 0) {
      insights.push({
        type: "alert",
        title: "Quality Concerns Rising",
        description: `${alerts.qualityNegative} negative quality tickets this period, up ${qualityChange} from last period.`,
        metric: qualityPctChange > 0 ? `+${qualityPctChange}%` : `${qualityPctChange}%`,
        action: "Audit recent production batches and supplier quality",
      });
    }
  }

  // Delivery issues trending
  const prevDelivery = previous.filter(
    (t) => t.category === "Delivery Delay or Problem"
  ).length;
  const deliveryChange = alerts.deliveryProblems - prevDelivery;
  if (deliveryChange > 5 || (deliveryChange > 0 && alerts.deliveryProblems > 20)) {
    insights.push({
      type: "trend",
      title: "Delivery Issues Trending Up",
      description: `${alerts.deliveryProblems} delivery-related tickets, up ${deliveryChange} from last period.`,
      metric: `+${deliveryChange}`,
      action: "Check carrier performance and holiday delays",
    });
  }

  // Top growing category
  const growingCategories = categories
    .filter((c) => c.delta > 5)
    .sort((a, b) => b.delta - a.delta);
  if (growingCategories.length > 0) {
    const top = growingCategories[0];
    const pctChange =
      top.count - top.delta > 0
        ? Math.round((top.delta / (top.count - top.delta)) * 100)
        : 100;
    if (pctChange > 20) {
      insights.push({
        type: "trend",
        title: `${top.category} Volume Increasing`,
        description: `${top.count} tickets this period, up ${top.delta} from last period.`,
        metric: `+${pctChange}%`,
      });
    }
  }

  // Positive sentiment highlight
  if (sentiment.positivePct > 30) {
    insights.push({
      type: "positive",
      title: "Strong Positive Sentiment",
      description: `${sentiment.positivePct}% of conversations have positive sentiment. Customers are happy!`,
      metric: `${sentiment.positive} tickets`,
    });
  }

  // High negative sentiment warning
  if (sentiment.negativePct > 25) {
    insights.push({
      type: "alert",
      title: "Elevated Negative Sentiment",
      description: `${sentiment.negativePct}% of conversations have negative sentiment. Worth investigating root causes.`,
      metric: `${sentiment.negative} tickets`,
      action: "Filter by negative sentiment to identify patterns",
    });
  }

  // Return rate insight
  if (alerts.returnRequests > 20) {
    const prevReturns = previous.filter(
      (t) => t.category === "Return or Exchange"
    ).length;
    const returnChange = alerts.returnRequests - prevReturns;
    if (returnChange > 5) {
      insights.push({
        type: "trend",
        title: "Return Requests Increasing",
        description: `${alerts.returnRequests} return/exchange requests, up ${returnChange} from last period.`,
        metric: `+${returnChange}`,
      });
    }
  }

  // Limit to top 4 most important insights
  return insights.slice(0, 4);
}

/**
 * Calculate TOR trend over time for line chart
 * Groups tickets and orders by day, calculates daily TOR
 */
function calculateTORTrend(
  tickets: { created_at: string }[],
  orders: { created_at: string }[]
): { date: string; tickets: number; orders: number; tor: number }[] {
  // Group tickets by date
  const ticketsByDate = new Map<string, number>();
  for (const ticket of tickets) {
    const date = ticket.created_at.slice(0, 10); // YYYY-MM-DD
    ticketsByDate.set(date, (ticketsByDate.get(date) || 0) + 1);
  }

  // Group orders by date
  const ordersByDate = new Map<string, number>();
  for (const order of orders) {
    const date = order.created_at.slice(0, 10); // YYYY-MM-DD
    ordersByDate.set(date, (ordersByDate.get(date) || 0) + 1);
  }

  // Get all unique dates and sort
  const allDates = new Set([...ticketsByDate.keys(), ...ordersByDate.keys()]);
  const sortedDates = [...allDates].sort();

  // Calculate TOR for each day
  return sortedDates.map((date) => {
    const ticketCount = ticketsByDate.get(date) || 0;
    const orderCount = ordersByDate.get(date) || 0;
    const tor = orderCount > 0 ? Math.round((ticketCount / orderCount) * 1000) / 10 : 0;

    return {
      date,
      tickets: ticketCount,
      orders: orderCount,
      tor,
    };
  });
}

/**
 * Calculate pre/post purchase timing breakdown
 * Pre-purchase: customer has order_count = 0
 * Post-purchase: customer has order_count > 0
 */
function calculatePurchaseTiming(
  tickets: { category: string; order_count: number | null; customer_email: string | null }[]
): PurchaseTimingBreakdown {
  let prePurchase = 0;
  let postPurchase = 0;
  let unknown = 0;

  const prePurchaseByCategory = new Map<string, number>();
  const postPurchaseByCategory = new Map<string, number>();

  for (const ticket of tickets) {
    // No customer data = unknown
    if (ticket.customer_email === null) {
      unknown++;
      continue;
    }

    // order_count = 0 or null = pre-purchase
    if (ticket.order_count === null || ticket.order_count === 0) {
      prePurchase++;
      prePurchaseByCategory.set(
        ticket.category,
        (prePurchaseByCategory.get(ticket.category) || 0) + 1
      );
    } else {
      postPurchase++;
      postPurchaseByCategory.set(
        ticket.category,
        (postPurchaseByCategory.get(ticket.category) || 0) + 1
      );
    }
  }

  const totalKnown = prePurchase + postPurchase;
  const prePurchasePct = totalKnown > 0 ? Math.round((prePurchase / totalKnown) * 1000) / 10 : 0;
  const postPurchasePct = totalKnown > 0 ? Math.round((postPurchase / totalKnown) * 1000) / 10 : 0;

  // Get top 5 pre-purchase categories
  const topPrePurchaseCategories = [...prePurchaseByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({
      category,
      count,
      pct: prePurchase > 0 ? Math.round((count / prePurchase) * 1000) / 10 : 0,
    }));

  // Get top 5 post-purchase categories
  const topPostPurchaseCategories = [...postPurchaseByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({
      category,
      count,
      pct: postPurchase > 0 ? Math.round((count / postPurchase) * 1000) / 10 : 0,
    }));

  return {
    prePurchase,
    postPurchase,
    unknown,
    prePurchasePct,
    postPurchasePct,
    topPrePurchaseCategories,
    topPostPurchaseCategories,
  };
}
