/**
 * Import Historical Typeform Leads
 *
 * Imports CSV exports from Typeform into typeform_leads table
 * with fuzzy matching against NetSuite customers.
 *
 * Usage: npx tsx scripts/import-typeform-leads.ts
 */

import { createClient } from "@supabase/supabase-js";
import { parse } from "csv-parse/sync";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  getAutoMatchResult,
  type CustomerForMatching,
} from "../lib/fuzzy-match";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Supabase connection
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// CSV file paths
const CORPORATE_CSV = "/Users/trevorfunderburk/Downloads/responses-VWZ2nfQj-01KCF3GAKF9DYRY8FD0YCVMHXG-P75R87A1H50888L96QRT1MGQ.csv";
const B2B_CSV = "/Users/trevorfunderburk/Downloads/responses-YZoEWZT2-01KCF350TJ2G3D0D1F73VNNWHN-62J39OSXDQ83I4DHMI4H229L.csv";

// Form IDs
const CORPORATE_FORM_ID = "VWZ2nfQj";
const B2B_FORM_ID = "YZoEWZT2";

interface CorporateRow {
  "#": string;
  "What is the best email to reach you on about this project?": string;
  "What is your first & last name?": string;
  "What is the best phone number to reach you on?": string;
  "If this gift inquiry is for a corporation, what company are you inquiring on behalf of?": string;
  "Do you have a specific piece of cookware in mind for your giftees?": string;
  "How many recipients will this gifting project be for?": string;
  "Would these gifts be shipping to a single location or to individual addresses?": string;
  "Are you interested in having these gifts engraved?": string;
  "Would you be interested in text or a graphic logo engraved?": string;
  "If text engraving please enter your message below": string;
  "Please upload a file of your logo in .eps or .dxf format": string;
  "Response Type": string;
  "Start Date (UTC)": string;
  "Submit Date (UTC)": string;
}

interface B2BRow {
  "#": string;
  "What is your first name?": string;
  "What is your last name?": string;
  "What is the name of your store?": string;
  [key: string]: string; // Title field has dynamic name
  "What is your email address?": string;
  "What is the best phone number to reach you on?": string;
  "Address": string;
  "Address line 2": string;
  "City/Town": string;
  "State/Region/Province": string;
  "Zip/Post Code": string;
  "Country": string;
  "What industry does your store best fit in?": string;
  "Response Type": string;
  "Start Date (UTC)": string;
  "Submit Date (UTC)": string;
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // Format: "2025-12-14 03:38:16" -> ISO format
  const parsed = new Date(dateStr.replace(" ", "T") + "Z");
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cleanPhone(phone: string): string | null {
  if (!phone) return null;
  // Remove '+' prefix and quotes
  return phone.replace(/^['+]+/, "").trim() || null;
}

function splitName(fullName: string): { first: string | null; last: string | null } {
  if (!fullName) return { first: null, last: null };
  const parts = fullName.trim().split(/\s+/);
  return {
    first: parts[0] || null,
    last: parts.slice(1).join(" ") || null,
  };
}

async function importCorporateLeads(customers: CustomerForMatching[]) {
  console.log("\n=== Importing Corporate Leads ===");

  const csvContent = fs.readFileSync(CORPORATE_CSV, "utf-8");
  const rows: CorporateRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  console.log(`Found ${rows.length} corporate leads to import`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Skip incomplete responses
      if (row["Response Type"] !== "completed") {
        skipped++;
        continue;
      }

      const responseId = row["#"];
      const email = row["What is the best email to reach you on about this project?"];
      const fullName = row["What is your first & last name?"];
      const phone = cleanPhone(row["What is the best phone number to reach you on?"]);
      const companyName = row["If this gift inquiry is for a corporation, what company are you inquiring on behalf of?"] || "Unknown Company";
      const productInterest = row["Do you have a specific piece of cookware in mind for your giftees?"];
      const recipientCount = row["How many recipients will this gifting project be for?"];
      const shippingType = row["Would these gifts be shipping to a single location or to individual addresses?"];
      const wantsEngraving = row["Are you interested in having these gifts engraved?"]?.toLowerCase() === "yes";
      const engravingType = row["Would you be interested in text or a graphic logo engraved?"];
      const engravingText = row["If text engraving please enter your message below"];
      const submittedAt = parseDate(row["Submit Date (UTC)"]);

      const { first, last } = splitName(fullName);

      // Build notes with corporate details
      const corpDetails: string[] = [];
      if (productInterest) corpDetails.push(`Product interest: ${productInterest}`);
      if (recipientCount) corpDetails.push(`Recipients: ${recipientCount}`);
      if (shippingType) corpDetails.push(`Shipping: ${shippingType}`);
      if (wantsEngraving) corpDetails.push(`Wants engraving: Yes`);
      if (engravingType) corpDetails.push(`Engraving type: ${engravingType}`);
      if (engravingText) corpDetails.push(`Engraving text: ${engravingText}`);
      const notes = corpDetails.length > 0 ? `[Corporate Details] ${corpDetails.join(" | ")}` : null;

      // Run fuzzy matching
      const matchResult = getAutoMatchResult(companyName, email, customers);

      const leadRecord = {
        typeform_response_id: responseId,
        typeform_form_id: CORPORATE_FORM_ID,
        form_type: "corporate",
        contact_first_name: first,
        contact_last_name: last,
        company_name: companyName,
        email: email || null,
        phone: phone,
        notes: notes,
        submitted_at: submittedAt,
        status: "new",
        match_status: matchResult.match_status,
        matched_customer_id: matchResult.matched_customer_id,
        match_confidence: matchResult.match_confidence,
        match_candidates: matchResult.match_candidates,
        matched_at: matchResult.match_status === "auto_matched" ? new Date().toISOString() : null,
        matched_by: matchResult.match_status === "auto_matched" ? "auto" : null,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("typeform_leads")
        .upsert(leadRecord, { onConflict: "typeform_response_id" });

      if (error) {
        console.error(`Error importing ${responseId}:`, error.message);
        errors++;
      } else {
        imported++;
      }
    } catch (err) {
      console.error(`Error processing row:`, err);
      errors++;
    }
  }

  console.log(`Corporate leads: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return imported;
}

async function importB2BLeads(customers: CustomerForMatching[]) {
  console.log("\n=== Importing B2B Wholesale Leads ===");

  const csvContent = fs.readFileSync(B2B_CSV, "utf-8");
  const rows: B2BRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  console.log(`Found ${rows.length} B2B leads to import`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Skip incomplete responses
      if (row["Response Type"] !== "completed") {
        skipped++;
        continue;
      }

      const responseId = row["#"];
      const firstName = row["What is your first name?"];
      const lastName = row["What is your last name?"];
      const companyName = row["What is the name of your store?"] || "Unknown Company";
      const email = row["What is your email address?"];
      const phone = cleanPhone(row["What is the best phone number to reach you on?"]);
      const address = row["Address"];
      const addressLine2 = row["Address line 2"];
      const city = row["City/Town"];
      const state = row["State/Region/Province"];
      const zipCode = row["Zip/Post Code"];
      const country = row["Country"];
      const industry = row["What industry does your store best fit in?"];
      const submittedAt = parseDate(row["Submit Date (UTC)"]);

      // Find title field (has dynamic field reference in column name)
      let title: string | null = null;
      for (const key of Object.keys(row)) {
        if (key.includes("What is your title at")) {
          title = row[key] || null;
          break;
        }
      }

      // Find other dynamic fields
      let storeType: string | null = null;
      let locationCount: string | null = null;
      let yearsInBusiness: string | null = null;
      let hasInstagram: boolean | null = null;
      let hasWebsite: boolean | null = null;
      let instagramUrl: string | null = null;
      let websiteUrl: string | null = null;
      let ein: string | null = null;
      let referralSource: string | null = null;
      let fitReason: string | null = null;
      let additionalNotes: string | null = null;

      for (const key of Object.keys(row)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes("brick and mortar location")) {
          storeType = row[key] || null;
        } else if (lowerKey.includes("how many brick and mortar locations")) {
          locationCount = row[key] || null;
        } else if (lowerKey.includes("how many years")) {
          yearsInBusiness = row[key] || null;
        } else if (lowerKey.includes("have an instagram page")) {
          hasInstagram = row[key]?.toLowerCase() === "yes";
        } else if (lowerKey.includes("have a website")) {
          hasWebsite = row[key]?.toLowerCase() === "yes";
        } else if (lowerKey.includes("instagram") && lowerKey.includes("link")) {
          instagramUrl = row[key] || null;
        } else if (lowerKey.includes("website") && lowerKey.includes("link")) {
          websiteUrl = row[key] || null;
        } else if (lowerKey.includes("ein number")) {
          ein = row[key] || null;
        } else if (lowerKey.includes("hear about smithey")) {
          referralSource = row[key] || null;
        } else if (lowerKey.includes("good fit")) {
          fitReason = row[key] || null;
        } else if (lowerKey.includes("anything else")) {
          additionalNotes = row[key] || null;
        }
      }

      // Run fuzzy matching
      const matchResult = getAutoMatchResult(companyName, email, customers);

      const leadRecord = {
        typeform_response_id: responseId,
        typeform_form_id: B2B_FORM_ID,
        form_type: "wholesale",
        contact_first_name: firstName || null,
        contact_last_name: lastName || null,
        contact_title: title,
        company_name: companyName,
        email: email || null,
        phone: phone,
        address: address || null,
        address_line_2: addressLine2 || null,
        city: city || null,
        state: state || null,
        zip_code: zipCode || null,
        country: country || null,
        store_type: storeType,
        location_count: locationCount,
        industry: industry || null,
        years_in_business: yearsInBusiness,
        ein: ein,
        has_instagram: hasInstagram,
        has_website: hasWebsite,
        instagram_url: instagramUrl,
        website: websiteUrl,
        referral_source: referralSource,
        fit_reason: fitReason,
        notes: additionalNotes,
        submitted_at: submittedAt,
        status: "new",
        match_status: matchResult.match_status,
        matched_customer_id: matchResult.matched_customer_id,
        match_confidence: matchResult.match_confidence,
        match_candidates: matchResult.match_candidates,
        matched_at: matchResult.match_status === "auto_matched" ? new Date().toISOString() : null,
        matched_by: matchResult.match_status === "auto_matched" ? "auto" : null,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("typeform_leads")
        .upsert(leadRecord, { onConflict: "typeform_response_id" });

      if (error) {
        console.error(`Error importing ${responseId}:`, error.message);
        errors++;
      } else {
        imported++;
      }
    } catch (err) {
      console.error(`Error processing row:`, err);
      errors++;
    }
  }

  console.log(`B2B leads: ${imported} imported, ${skipped} skipped, ${errors} errors`);
  return imported;
}

async function main() {
  console.log("Starting Typeform leads import...\n");

  // First, fetch all NetSuite customers for matching
  console.log("Fetching NetSuite customers for matching...");
  const { data: customers, error: customersError } = await supabase
    .from("ns_wholesale_customers")
    .select("ns_customer_id, company_name, email")
    .not("company_name", "is", null);

  if (customersError) {
    console.error("Failed to fetch customers:", customersError);
    process.exit(1);
  }

  console.log(`Loaded ${customers?.length || 0} customers for matching\n`);

  const customerList = (customers || []) as CustomerForMatching[];

  // Import both forms
  const corporateCount = await importCorporateLeads(customerList);
  const b2bCount = await importB2BLeads(customerList);

  console.log("\n=== Import Complete ===");
  console.log(`Total leads imported: ${corporateCount + b2bCount}`);
}

main().catch(console.error);
