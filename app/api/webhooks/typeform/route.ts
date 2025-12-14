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
import type { LeadFormType } from "@/lib/types";

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
    const { error: upsertError } = await supabase
      .from("typeform_leads")
      .upsert(leadRecord, {
        onConflict: "typeform_response_id",
      });

    if (upsertError) {
      console.error("[TYPEFORM] Upsert error:", upsertError);
      throw upsertError;
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
