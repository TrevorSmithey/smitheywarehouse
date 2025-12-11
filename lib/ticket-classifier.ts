/**
 * Claude AI Ticket Classifier
 * Classifies customer service tickets into categories with sentiment analysis
 * Ported from Make.com GPT-4o-mini integration
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TicketCategory, TicketSentiment, TicketUrgency } from "./types";

// Lazy-initialize Anthropic client (to allow dotenv to load first in scripts)
let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

// System prompt - ported from Make.com blueprint
const CLASSIFICATION_PROMPT = `You are an expert customer experience classification model used by product, support, operations, and leadership teams at Smithey, a premium cast iron cookware company specializing in heirloom-quality skillets, Dutch ovens, and carbon steel. Your task is to classify and summarize customer messages with clarity, precision, and objectivity.

1. Classify the message into a primary category. Choose from the following standard categories when applicable:
- Spam
- Product Inquiry
- Product Recommendation
- Ordering Inquiry
- Engraving Question
- Order Status
- Shipping Status
- Order Cancellation or Edit
- Cooking Advice
- Seasoning & Care
- Dutch Oven Issue
- Website Issue
- Quality Issue
- Glass Lid Issue
- Promotion or Sale Inquiry
- Factory Seconds Question
- Shipping Setup Issue
- Delivery Delay or Problem
- Return or Exchange
- Wholesale Request
- Metal Testing
- New Product Inquiry
- Positive Feedback
- Phone Call (No Context)
- Other

If the message involves multiple issues, select the most specific or urgent one as the primary category and list secondary categories in the summary (e.g., 'Secondaries: Return or Exchange, Quality Issue'). IMPORTANT: Always use one of the standard categories above. Only use 'Other' if the message truly doesn't fit any category. Do NOT create new custom categories - use 'Other' instead and note the specific topic in the summary.

2. Use the following guidelines and examples:
- 'Spam': Irrelevant promotions, ads, or unsolicited links.
- 'Product Inquiry': Product details, specifications, availability, or suitability questions.
- 'Product Recommendation': Comparison requests between cookware types or models.
- 'Ordering Inquiry': Pre-purchase order logistics (gift shipping, split shipments, delivery scheduling, multiple addresses).
- 'Engraving Question': Any inquiry about engraving, personalization, or customization.
- 'Order Status': Questions before shipping (order processing, confirmation).
- 'Shipping Status': Questions about timing/location after shipment.
- 'Order Cancellation or Edit': Requests to cancel, change, or update orders (address, engraving, item changes).
- 'Cooking Advice': Questions about recipes or cooking techniques only (NOT care, cleaning, or seasoning).
- 'Seasoning & Care': Rust, flaking, mottling, discoloration, seasoning issues, care instructions, cleaning questions, or general cookware maintenance. If a quality defect is caused by seasoning issues, list 'Quality Issue' as a secondary category.
- 'Dutch Oven Issue': Any problem, damage, or seasoning issue specific to Dutch ovens.
- 'Website Issue': Checkout failures, pricing errors, broken links, discount code issues.
- 'Quality Issue': Defects, damage, or missing parts excluding glass lids.
- 'Glass Lid Issue': Broken, shattered, or defective glass lids.
- 'Promotion or Sale Inquiry': Questions about discounts, gift sets, or special offers.
- 'Factory Seconds Question': Questions about blemished or discounted products.
- 'Shipping Setup Issue': Pre-order shipping options, costs, or eligibility.
- 'Delivery Delay or Problem': Tracking issues, delays, or carrier failures after shipping.
- 'Return or Exchange': Refunds, replacements, or exchange requests.
- 'Wholesale Request': Bulk, hospitality, or wholesale program inquiries.
- 'Metal Testing': Questions about third-party testing for lead, cadmium, or harmful metals in Smithey products, product safety certifications, or safety information requests.
- 'New Product Inquiry': Questions about upcoming products, future releases, when new products will be available, or requests for products not currently offered.
- 'Positive Feedback': Praise or satisfaction without a request.
- 'Phone Call (No Context)': Logged calls with no message or clear request.

3. Additional metadata:
- Sentiment: Positive, Negative, Neutral, or Mixed — always include in the summary (e.g., '[Sentiment: Negative]').
- Urgency: Include if immediate action is needed (e.g., '[Urgency: High - Time-sensitive delivery]').
- Ambiguity: If unclear, note 'Unclear intent' in the summary.

4. Write a concise summary in 1–2 sentences:
- State the request/issue directly without filler.
- Include sentiment, urgency, and any secondary categories.
- Do not include personal names unless essential.
- Base strictly on the provided message; do not infer details.

5. Output format (JSON):
{
  "category": "<primary category>",
  "sentiment": "<Positive|Negative|Neutral|Mixed>",
  "urgency": "<High|Normal|null>",
  "summary": "<short summary of message intent>"
}

Maintain consistent terminology, clarity, and precision. Output ONLY valid JSON, no additional text.`;

export interface ClassificationResult {
  category: TicketCategory;
  sentiment: TicketSentiment;
  urgency: TicketUrgency;
  summary: string;
}

// Valid categories for validation
const VALID_CATEGORIES: TicketCategory[] = [
  "Spam",
  "Product Inquiry",
  "Product Recommendation",
  "Ordering Inquiry",
  "Engraving Question",
  "Order Status",
  "Shipping Status",
  "Order Cancellation or Edit",
  "Cooking Advice",
  "Seasoning & Care",
  "Dutch Oven Issue",
  "Website Issue",
  "Quality Issue",
  "Glass Lid Issue",
  "Promotion or Sale Inquiry",
  "Factory Seconds Question",
  "Shipping Setup Issue",
  "Delivery Delay or Problem",
  "Return or Exchange",
  "Wholesale Request",
  "Metal Testing",
  "New Product Inquiry",
  "Positive Feedback",
  "Phone Call (No Context)",
  "Other",
];

const VALID_SENTIMENTS: TicketSentiment[] = ["Positive", "Negative", "Neutral", "Mixed"];

/**
 * Classify a customer message using Claude Haiku
 */
export async function classifyTicket(messageBody: string): Promise<ClassificationResult> {
  if (!messageBody || messageBody.trim().length === 0) {
    return {
      category: "Phone Call (No Context)",
      sentiment: "Neutral",
      urgency: null,
      summary: "Empty message or no context provided.",
    };
  }

  try {
    const response = await getAnthropicClient().messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 500,
      temperature: 0.2, // Low temperature for consistent classification
      messages: [
        {
          role: "user",
          content: `Customer message: ${messageBody}`,
        },
      ],
      system: CLASSIFICATION_PROMPT,
    });

    // Extract text content from response
    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Parse JSON response
    const result = parseClassificationResponse(textContent.text);
    return result;
  } catch (error) {
    console.error("Classification error:", error);

    // Return a safe fallback
    return {
      category: "Other",
      sentiment: "Neutral",
      urgency: null,
      summary: `Classification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

/**
 * Parse and validate the JSON response from Claude
 */
function parseClassificationResponse(text: string): ClassificationResult {
  // Try to extract JSON from the response
  let jsonText = text.trim();

  // Sometimes Claude wraps JSON in markdown code blocks
  const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  }

  // Parse the JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Try to fix common JSON issues
    jsonText = jsonText.replace(/'/g, '"').replace(/,\s*}/g, "}");
    parsed = JSON.parse(jsonText);
  }

  // Validate and normalize the response
  const category = normalizeCategory(parsed.category as string);
  const sentiment = normalizeSentiment(parsed.sentiment as string);
  const urgency = normalizeUrgency(parsed.urgency as string | null | undefined);
  const summary = typeof parsed.summary === "string" ? parsed.summary : "No summary provided.";

  return { category, sentiment, urgency, summary };
}

/**
 * Normalize category to valid value
 */
function normalizeCategory(category: string): TicketCategory {
  if (!category) return "Other";

  // Exact match
  if (VALID_CATEGORIES.includes(category as TicketCategory)) {
    return category as TicketCategory;
  }

  // Case-insensitive match
  const lowerCategory = category.toLowerCase();
  const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === lowerCategory);
  if (match) return match;

  // Partial match for common variations
  if (lowerCategory.includes("spam")) return "Spam";
  if (lowerCategory.includes("quality")) return "Quality Issue";
  if (lowerCategory.includes("shipping") && lowerCategory.includes("status")) return "Shipping Status";
  if (lowerCategory.includes("order") && lowerCategory.includes("status")) return "Order Status";
  if (lowerCategory.includes("return") || lowerCategory.includes("exchange")) return "Return or Exchange";
  if (lowerCategory.includes("delivery") || lowerCategory.includes("delay")) return "Delivery Delay or Problem";
  if (lowerCategory.includes("engraving")) return "Engraving Question";
  if (lowerCategory.includes("glass") && lowerCategory.includes("lid")) return "Glass Lid Issue";
  if (lowerCategory.includes("dutch") && lowerCategory.includes("oven")) return "Dutch Oven Issue";
  if (lowerCategory.includes("seasoning") || lowerCategory.includes("care") || lowerCategory.includes("cleaning")) return "Seasoning & Care";
  if (lowerCategory.includes("wholesale") || lowerCategory.includes("bulk")) return "Wholesale Request";
  if (lowerCategory.includes("positive") || lowerCategory.includes("feedback")) return "Positive Feedback";
  if (lowerCategory.includes("metal") || lowerCategory.includes("lead") || lowerCategory.includes("safety") || lowerCategory.includes("cadmium")) return "Metal Testing";

  // Unknown category - use Other
  console.warn(`Unknown category: "${category}" -> defaulting to "Other"`);
  return "Other";
}

/**
 * Normalize sentiment to valid value
 */
function normalizeSentiment(sentiment: string): TicketSentiment {
  if (!sentiment) return "Neutral";

  // Exact match
  if (VALID_SENTIMENTS.includes(sentiment as TicketSentiment)) {
    return sentiment as TicketSentiment;
  }

  // Case-insensitive match
  const lowerSentiment = sentiment.toLowerCase();
  if (lowerSentiment.includes("positive")) return "Positive";
  if (lowerSentiment.includes("negative")) return "Negative";
  if (lowerSentiment.includes("mixed")) return "Mixed";

  return "Neutral";
}

/**
 * Normalize urgency to valid value
 */
function normalizeUrgency(urgency: string | null | undefined): TicketUrgency {
  if (!urgency || urgency === "null" || urgency === "none") return null;

  const lowerUrgency = urgency.toLowerCase();
  if (lowerUrgency.includes("high")) return "High";
  if (lowerUrgency.includes("normal")) return "Normal";

  return null;
}

/**
 * Batch classify multiple tickets (with rate limiting)
 */
export async function classifyTicketsBatch(
  messages: { id: string; body: string }[],
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, ClassificationResult>> {
  const results = new Map<string, ClassificationResult>();
  const total = messages.length;

  for (let i = 0; i < messages.length; i++) {
    const { id, body } = messages[i];

    const result = await classifyTicket(body);
    results.set(id, result);

    if (onProgress) {
      onProgress(i + 1, total);
    }

    // Rate limiting - 5 requests per second max
    if (i < messages.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return results;
}
