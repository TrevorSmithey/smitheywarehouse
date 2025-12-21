/**
 * Typeform Webhook Handler
 *
 * Receives form submissions from Typeform B2B Wholesale and Corporate forms.
 * Extracts lead data, runs fuzzy matching against NetSuite accounts,
 * and stores in typeform_leads table.
 *
 * Webhook URL: https://smitheywarehouse.vercel.app/api/webhooks/typeform
 *
 * Required env vars:
 * - TYPEFORM_WEBHOOK_SECRET: Shared secret for HMAC verification
 * - TYPEFORM_WHOLESALE_FORM_ID: Form ID for B2B wholesale applications
 * - TYPEFORM_CORPORATE_FORM_ID: Form ID for corporate/gifting applications
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { getAutoMatchResult, type CustomerForMatching } from "@/lib/fuzzy-match";
import type { LeadFormType, TypeformLead } from "@/lib/types";
import Anthropic from "@anthropic-ai/sdk";

// Typeform webhook payload structure
interface TypeformWebhook {
  event_id: string;
  event_type: string;
  form_response: {
    form_id: string;
    token: string; // Response ID
    submitted_at: string;
    landed_at: string;
    definition: {
      id: string;
      title: string;
      fields: Array<{
        id: string;
        title: string;
        type: string;
        ref: string;
      }>;
    };
    answers: Array<{
      field: {
        id: string;
        type: string;
        ref: string;
      };
      type: string;
      text?: string;
      email?: string;
      phone_number?: string;
      url?: string;
      boolean?: boolean;
      choice?: {
        label: string;
      };
      choices?: {
        labels: string[];
      };
    }>;
  };
}

// Field mapping configuration
// Maps Typeform field titles to our database columns using pattern matching
// Patterns match against lowercase field titles
const FIELD_MAPPING = {
  // Core contact fields
  // B2B: "What is your first name?"
  // Corporate: "What is your first & last name?" (combined - handled specially)
  // IMPORTANT: Order matters - check full_name BEFORE first/last to avoid partial matches
  full_name: ["first & last name", "first and last name"], // Corporate form combines first/last
  first_name: ["what is your first name"],
  last_name: ["what is your last name"],

  // Company name
  // B2B: "What is the name of your store?"
  // Corporate: "If this gift inquiry is for a corporation, what company are you inquiring on behalf of?"
  company_name: ["name of your store", "corporation", "company", "inquiring on behalf"],

  // Title/Role
  // B2B: "What is your title at {{field}}?"
  title: ["what is your title", "title at"],

  // Email
  // B2B: "What is your email address?"
  // Corporate: "What is the best email to reach you on about this project?"
  email: ["email address", "best email", "email"],

  // Phone
  // B2B: "What is the best phone number to reach you on?"
  // Corporate: "What is the best phone number to reach you on?"
  phone: ["phone number", "phone"],

  // Address (B2B only - labeled fields)
  address: ["address"],
  address_line_2: ["address line 2"],
  city: ["city", "town"],
  state: ["state", "region", "province"],
  zip_code: ["zip", "post code"],
  country: ["country"],

  // Business details (B2B form)
  // "Does {{field}} have a brick and mortar location, online store only, or both..."
  store_type: ["brick and mortar location", "online store only", "brick and mortar presence"],
  // "How many brick and mortar locations does {{field}} have?"
  location_count: ["how many brick and mortar locations"],
  // "What industry does your store best fit in?"
  industry: ["what industry", "store best fit"],
  // "How many years has {{field}} been in business?"
  years_in_business: ["how many years", "been in business"],
  // "What is your EIN number?"
  ein: ["ein number", "ein"],

  // Social/Web (B2B form)
  // "Does {{field}} have an Instagram page?"
  has_instagram: ["have an instagram page"],
  // "Does {{field}} have a website?"
  has_website: ["have a website"],
  // "Please link to {{field}}'s Instagram/Facebook profile below"
  instagram_url: ["link to", "instagram", "facebook profile"],
  // "Please link to {{field}}'s website below"
  website: ["website below", "link to", "website"],

  // Lead qualification
  // B2B: "How did you first hear about Smithey?"
  referral_source: ["hear about smithey", "how did you first hear"],
  // B2B: "Why might Smithey be a good fit in {{field}}?"
  fit_reason: ["good fit", "why might smithey"],
  // B2B: "If there is anything else you would like to share with us..."
  notes: ["anything else", "share with us", "let us know below"],

  // Corporate-specific fields
  // "Do you have a specific piece of cookware in mind for your giftees?"
  product_interest: ["specific piece of cookware", "cookware in mind"],
  // "How many recipients will this gifting project be for?"
  recipient_count: ["how many recipients", "gifting project"],
  // "Would these gifts be shipping to a single location or to individual addresses?"
  shipping_type: ["single location", "individual addresses", "shipping to"],
  // "Are you interested in having these gifts engraved?"
  wants_engraving: ["interested in having", "gifts engraved"],
  // "Would you be interested in text or a graphic logo engraved?"
  engraving_type: ["text or a graphic logo", "logo engraved"],
};

/**
 * Verify Typeform webhook signature
 * Uses SHA256 HMAC with base64 encoding
 */
function verifyTypeformSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64");

  // Typeform sends signature as "sha256=<hash>"
  const expectedSignature = `sha256=${hash}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Find answer value by matching field title patterns
 */
function findAnswer(
  answers: TypeformWebhook["form_response"]["answers"],
  definition: TypeformWebhook["form_response"]["definition"],
  patterns: string[]
): string | boolean | null {
  for (const answer of answers) {
    // Find the field definition to get the title
    const fieldDef = definition.fields.find((f) => f.id === answer.field.id);
    if (!fieldDef) continue;

    const fieldTitle = fieldDef.title.toLowerCase();

    // Check if any pattern matches
    for (const pattern of patterns) {
      if (fieldTitle.includes(pattern.toLowerCase())) {
        // Return based on answer type
        if (answer.type === "text" && answer.text !== undefined) {
          return answer.text;
        }
        if (answer.type === "email" && answer.email !== undefined) {
          return answer.email;
        }
        if (answer.type === "phone_number" && answer.phone_number !== undefined) {
          return answer.phone_number;
        }
        if (answer.type === "url" && answer.url !== undefined) {
          return answer.url;
        }
        if (answer.type === "boolean" && answer.boolean !== undefined) {
          return answer.boolean;
        }
        if (answer.type === "choice" && answer.choice?.label !== undefined) {
          return answer.choice.label;
        }
        if (answer.type === "choices" && answer.choices?.labels !== undefined) {
          return answer.choices.labels.join(", ");
        }
      }
    }
  }

  return null;
}

/**
 * Extract lead data from Typeform webhook payload
 */
function extractLeadData(webhook: TypeformWebhook) {
  const { form_response } = webhook;
  const { answers, definition } = form_response;

  const getString = (patterns: string[]): string | null => {
    const value = findAnswer(answers, definition, patterns);
    return typeof value === "string" ? value : null;
  };

  const getBool = (patterns: string[]): boolean | null => {
    const value = findAnswer(answers, definition, patterns);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return value.toLowerCase() === "yes" || value.toLowerCase() === "true";
    }
    return null;
  };

  // Handle first/last name - B2B has separate fields, Corporate has combined
  // Check full_name FIRST (Corporate form: "What is your first & last name?")
  const fullName = getString(FIELD_MAPPING.full_name);
  let firstName: string | null = null;
  let lastName: string | null = null;

  if (fullName) {
    // Corporate form: split "Sarah Johnson" into first/last
    const parts = fullName.trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(" ") || null;
  } else {
    // B2B form: separate fields
    firstName = getString(FIELD_MAPPING.first_name);
    lastName = getString(FIELD_MAPPING.last_name);
  }

  // Get company name - different questions for B2B vs Corporate
  const companyName = getString(FIELD_MAPPING.company_name);

  // Corporate-specific fields (combined into notes for storage)
  const productInterest = getString(FIELD_MAPPING.product_interest);
  const recipientCount = getString(FIELD_MAPPING.recipient_count);
  const shippingType = getString(FIELD_MAPPING.shipping_type);
  const wantsEngraving = getBool(FIELD_MAPPING.wants_engraving);
  const engravingType = getString(FIELD_MAPPING.engraving_type);

  // Build notes - include corporate-specific details if present
  let notes = getString(FIELD_MAPPING.notes) || "";
  if (productInterest || recipientCount || shippingType || wantsEngraving !== null) {
    const corpDetails: string[] = [];
    if (productInterest) corpDetails.push(`Product interest: ${productInterest}`);
    if (recipientCount) corpDetails.push(`Recipients: ${recipientCount}`);
    if (shippingType) corpDetails.push(`Shipping: ${shippingType}`);
    if (wantsEngraving !== null) corpDetails.push(`Wants engraving: ${wantsEngraving ? "Yes" : "No"}`);
    if (engravingType) corpDetails.push(`Engraving type: ${engravingType}`);

    const corpNote = corpDetails.join(" | ");
    notes = notes ? `${notes}\n\n[Corporate Details] ${corpNote}` : `[Corporate Details] ${corpNote}`;
  }

  return {
    contact_first_name: firstName,
    contact_last_name: lastName,
    company_name: companyName || "Unknown Company",
    contact_title: getString(FIELD_MAPPING.title),
    email: getString(FIELD_MAPPING.email),
    phone: getString(FIELD_MAPPING.phone),
    address: getString(FIELD_MAPPING.address),
    address_line_2: getString(FIELD_MAPPING.address_line_2),
    city: getString(FIELD_MAPPING.city),
    state: getString(FIELD_MAPPING.state),
    zip_code: getString(FIELD_MAPPING.zip_code),
    country: getString(FIELD_MAPPING.country),
    store_type: getString(FIELD_MAPPING.store_type),
    location_count: getString(FIELD_MAPPING.location_count),
    industry: getString(FIELD_MAPPING.industry),
    years_in_business: getString(FIELD_MAPPING.years_in_business),
    ein: getString(FIELD_MAPPING.ein),
    instagram_url: getString(FIELD_MAPPING.instagram_url),
    has_instagram: getBool(FIELD_MAPPING.has_instagram),
    has_website: getBool(FIELD_MAPPING.has_website),
    website: getString(FIELD_MAPPING.website),
    referral_source: getString(FIELD_MAPPING.referral_source),
    fit_reason: getString(FIELD_MAPPING.fit_reason),
    notes: notes || null,
  };
}

/**
 * Determine form type from form ID
 */
function getFormType(formId: string): LeadFormType {
  const wholesaleFormId = process.env.TYPEFORM_WHOLESALE_FORM_ID;
  const corporateFormId = process.env.TYPEFORM_CORPORATE_FORM_ID;

  if (formId === wholesaleFormId) return "wholesale";
  if (formId === corporateFormId) return "corporate";

  // Default to wholesale if unknown
  console.warn(`Unknown form ID: ${formId}, defaulting to wholesale`);
  return "wholesale";
}

// AI Analysis prompts
const B2B_WHOLESALE_PROMPT = `You are evaluating wholesale partnership applications for Smithey Ironware, a premium cast iron and carbon steel cookware company based in Charleston, SC. Our products are heirloom-quality, handcrafted cookware priced at $200-$500+ per piece.

IDEAL WHOLESALE PARTNERS:
- Established retail stores with 3+ years in business
- Premium kitchenware, home goods, or specialty food stores
- High-end hospitality (restaurants, hotels, resorts)
- Curated lifestyle boutiques with affluent clientele
- Strong physical presence (brick & mortar preferred)
- Professional web presence and/or social media
- Clear understanding of premium positioning

RED FLAGS:
- Brand new businesses (<1 year)
- Mass-market discount retailers
- Vague or generic business descriptions
- No web/social presence
- Commodity-focused retailers

Return JSON with:
{
  "summary": "2-3 sentence assessment of who this is and their fit",
  "fit_score": 1-5 (1=poor, 3=maybe, 5=excellent),
  "recommendation": "APPROVE" | "REVIEW" | "DECLINE"
}

Only output valid JSON.`;

const CORPORATE_GIFTING_PROMPT = `You are evaluating corporate gifting inquiries for Smithey Ironware, a premium cast iron and carbon steel cookware company. Our corporate program serves businesses giving high-end gifts to clients, employees, or partners.

IDEAL CORPORATE CLIENTS:
- Established companies with meaningful gifting budgets
- Executive/VIP gift programs
- Client appreciation gifts
- Employee milestone awards (5/10/25 year, retirement)
- Holiday gifting programs
- Real estate closing gifts

Return JSON with:
{
  "summary": "2-3 sentence assessment of who this is and their gifting needs",
  "fit_score": 1-5 (1=poor, 3=maybe, 5=excellent),
  "recommendation": "HIGH_PRIORITY" | "STANDARD" | "LOW_PRIORITY"
}

Only output valid JSON.`;

interface LeadAnalysisResult {
  summary: string;
  fit_score: number;
  recommendation: string;
}

/**
 * Run AI analysis on a new lead
 */
async function analyzeLeadWithAI(
  leadData: ReturnType<typeof extractLeadData>,
  formType: LeadFormType
): Promise<LeadAnalysisResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[TYPEFORM] No ANTHROPIC_API_KEY, skipping AI analysis");
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const isB2B = formType === "wholesale";
  const systemPrompt = isB2B ? B2B_WHOLESALE_PROMPT : CORPORATE_GIFTING_PROMPT;

  // Build context string from lead data
  const lines: string[] = [`Company: ${leadData.company_name}`];
  if (leadData.contact_first_name || leadData.contact_last_name) {
    lines.push(`Contact: ${[leadData.contact_first_name, leadData.contact_last_name].filter(Boolean).join(" ")}${leadData.contact_title ? ` (${leadData.contact_title})` : ""}`);
  }
  if (leadData.email) lines.push(`Email: ${leadData.email}`);
  if (leadData.industry) lines.push(`Industry: ${leadData.industry}`);
  if (leadData.years_in_business) lines.push(`Years in Business: ${leadData.years_in_business}`);
  if (leadData.store_type) lines.push(`Store Type: ${leadData.store_type}`);
  if (leadData.location_count) lines.push(`Locations: ${leadData.location_count}`);
  if (leadData.city || leadData.state) lines.push(`Location: ${[leadData.city, leadData.state].filter(Boolean).join(", ")}`);
  if (leadData.has_website !== null) lines.push(`Has Website: ${leadData.has_website ? "Yes" : "No"}`);
  if (leadData.website) lines.push(`Website: ${leadData.website}`);
  if (leadData.has_instagram !== null) lines.push(`Has Instagram: ${leadData.has_instagram ? "Yes" : "No"}`);
  if (leadData.referral_source) lines.push(`How they heard about Smithey: ${leadData.referral_source}`);
  if (leadData.fit_reason) lines.push(`Why they think they'd be a good fit: ${leadData.fit_reason}`);
  if (leadData.notes) lines.push(`Additional notes: ${leadData.notes}`);

  const leadContext = lines.join("\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      temperature: 0.3,
      messages: [{ role: "user", content: `Analyze this ${isB2B ? "wholesale partnership" : "corporate gifting"} application:\n\n${leadContext}` }],
      system: systemPrompt,
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;

    // Parse JSON response
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) jsonText = jsonMatch[1];

    const parsed = JSON.parse(jsonText);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "Analysis incomplete.",
      fit_score: typeof parsed.fit_score === "number" ? Math.max(1, Math.min(5, Math.round(parsed.fit_score))) : 3,
      recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : "REVIEW",
    };
  } catch (error) {
    console.error("[TYPEFORM] AI analysis error:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET;

  try {
    // Get raw body for signature verification
    const body = await request.text();
    const signature = request.headers.get("typeform-signature");

    // Verify signature if secret is configured
    if (secret && !verifyTypeformSignature(body, signature, secret)) {
      console.error("[TYPEFORM] Webhook signature verification failed");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const webhook: TypeformWebhook = JSON.parse(body);

    // Only process form submissions
    if (webhook.event_type !== "form_response") {
      console.log(`[TYPEFORM] Ignoring event type: ${webhook.event_type}`);
      return NextResponse.json({ success: true, ignored: true });
    }

    const { form_response } = webhook;
    const supabase = createServiceClient();

    // Extract lead data from form answers
    const leadData = extractLeadData(webhook);
    const formType = getFormType(form_response.form_id);

    console.log(
      `[TYPEFORM] Processing ${formType} lead: ${leadData.company_name}`
    );

    // Fetch NetSuite customers for matching
    const { data: customers } = await supabase
      .from("ns_wholesale_customers")
      .select("ns_customer_id, company_name, email")
      .not("company_name", "is", null);

    // Run auto-matching
    const matchResult = getAutoMatchResult(
      leadData.company_name,
      leadData.email,
      (customers || []) as CustomerForMatching[]
    );

    // Prepare record for upsert
    const leadRecord = {
      typeform_response_id: form_response.token,
      typeform_form_id: form_response.form_id,
      form_type: formType,
      ...leadData,
      submitted_at: form_response.submitted_at,
      raw_payload: webhook,
      status: "new",
      match_status: matchResult.match_status,
      matched_customer_id: matchResult.matched_customer_id,
      match_confidence: matchResult.match_confidence,
      match_candidates: matchResult.match_candidates,
      matched_at: matchResult.match_status === "auto_matched"
        ? new Date().toISOString()
        : null,
      matched_by: matchResult.match_status === "auto_matched" ? "auto" : null,
      synced_at: new Date().toISOString(),
    };

    // Upsert to typeform_leads
    const { data: upsertedLead, error: upsertError } = await supabase
      .from("typeform_leads")
      .upsert(leadRecord, {
        onConflict: "typeform_response_id",
      })
      .select("id")
      .single();

    if (upsertError) {
      console.error("[TYPEFORM] Upsert error:", upsertError);
      throw upsertError;
    }

    // Run AI analysis on new lead
    let aiScore: number | null = null;
    const analysis = await analyzeLeadWithAI(leadData, formType);
    if (analysis && upsertedLead?.id) {
      const { error: updateError } = await supabase
        .from("typeform_leads")
        .update({
          ai_summary: analysis.summary,
          ai_fit_score: analysis.fit_score,
          ai_analyzed_at: new Date().toISOString(),
        })
        .eq("id", upsertedLead.id);

      if (updateError) {
        console.error("[TYPEFORM] AI update error:", updateError);
      } else {
        aiScore = analysis.fit_score;
        console.log(`[TYPEFORM] AI analysis: Score ${analysis.fit_score}/5 - ${analysis.recommendation}`);
      }
    }

    const elapsed = Date.now() - startTime;

    // Log successful processing
    await supabase.from("sync_logs").insert({
      sync_type: "typeform_lead",
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      status: "success",
      records_expected: 1,
      records_synced: 1,
      duration_ms: elapsed,
      details: {
        form_type: formType,
        company_name: leadData.company_name,
        match_status: matchResult.match_status,
        match_confidence: matchResult.match_confidence,
      },
    });

    console.log(
      `[TYPEFORM] Lead processed: ${leadData.company_name} (${matchResult.match_status}, ${matchResult.match_confidence ?? "N/A"}% confidence) in ${elapsed}ms`
    );

    return NextResponse.json({
      success: true,
      lead: {
        company_name: leadData.company_name,
        form_type: formType,
        match_status: matchResult.match_status,
        match_confidence: matchResult.match_confidence,
        ai_fit_score: aiScore,
      },
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    console.error("[TYPEFORM] Webhook error:", error);

    // Log failure
    try {
      const supabase = createServiceClient();
      await supabase.from("sync_logs").insert({
        sync_type: "typeform_lead",
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        status: "failed",
        records_expected: 1,
        records_synced: 0,
        error_message: errorMessage,
        duration_ms: elapsed,
      });
    } catch (logError) {
      console.error("[TYPEFORM] Failed to log error:", logError);
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
