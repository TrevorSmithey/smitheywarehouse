/**
 * Wholesale Conversations Full Sync
 *
 * Fetches ALL conversations from Reamaze smitheysales brand,
 * including full message threads, and stores them in Supabase.
 *
 * Usage: npx tsx scripts/sync-wholesale-conversations.ts
 */

import * as dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

// Configuration
const REAMAZE_BRAND = process.env.REAMAZE_WHOLESALE_BRAND!;
const REAMAZE_EMAIL = process.env.REAMAZE_EMAIL!;
const REAMAZE_API_TOKEN = process.env.REAMAZE_API_TOKEN!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const reamazeAuth = `Basic ${Buffer.from(`${REAMAZE_EMAIL}:${REAMAZE_API_TOKEN}`).toString("base64")}`;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Rate limiting
const DELAY_BETWEEN_PAGES = 100; // ms
const DELAY_BETWEEN_CONVERSATIONS = 50; // ms

interface ReamazeConversation {
  slug: string;
  subject: string | null;
  status: string;
  created_at: string;
  updated_at?: string;
  message: {
    body: string;
    created_at: string;
  };
  author?: {
    name: string;
    email: string;
  };
  tag_list?: string[];
}

interface ReamazeMessage {
  id?: string;
  body: string;
  created_at: string;
  user?: {
    name: string;
    email: string;
    staff?: boolean;
  };
}

/**
 * Strip HTML tags and clean up message body
 */
function cleanHtml(html: string): string {
  if (!html) return "";

  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Limit length for storage
  if (text.length > 10000) {
    text = text.substring(0, 10000) + "...";
  }

  return text;
}

/**
 * Infer company name from email domain
 */
function inferCompany(email: string): string | null {
  if (!email) return null;

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // Skip generic domains
  const genericDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com"];
  if (genericDomains.includes(domain)) return null;

  // Extract company name from domain
  const parts = domain.split(".");
  if (parts.length >= 2) {
    // Return the main part, capitalized
    const company = parts[0];
    return company.charAt(0).toUpperCase() + company.slice(1);
  }

  return null;
}

/**
 * Fetch a single conversation with full message thread
 */
async function fetchConversationThread(slug: string): Promise<ReamazeMessage[]> {
  try {
    const response = await fetch(
      `https://${REAMAZE_BRAND}.reamaze.com/api/v1/conversations/${slug}`,
      {
        headers: {
          "Accept": "application/json",
          "Authorization": reamazeAuth,
        },
      }
    );

    if (!response.ok) {
      console.error(`  Failed to fetch thread for ${slug}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.conversation?.messages || [];
  } catch (error) {
    console.error(`  Error fetching thread for ${slug}:`, error);
    return [];
  }
}

/**
 * Main sync function
 */
async function syncAllConversations() {
  console.log("=== Wholesale Conversations Full Sync ===\n");
  console.log(`Brand: ${REAMAZE_BRAND}`);
  console.log(`Supabase: ${SUPABASE_URL}\n`);

  // Get total count first
  const initialResp = await fetch(
    `https://${REAMAZE_BRAND}.reamaze.com/api/v1/conversations?filter=all&page=1`,
    {
      headers: {
        "Accept": "application/json",
        "Authorization": reamazeAuth,
      },
    }
  );

  if (!initialResp.ok) {
    throw new Error(`Failed to connect to Reamaze: ${initialResp.status}`);
  }

  const initialData = await initialResp.json();
  const totalCount = initialData.total_count;
  const pageCount = initialData.page_count;

  console.log(`Total conversations: ${totalCount}`);
  console.log(`Total pages: ${pageCount}`);
  console.log(`Starting sync...\n`);

  let synced = 0;
  let errors = 0;
  const startTime = Date.now();

  // Process all pages
  for (let page = 1; page <= pageCount; page++) {
    const pageStart = Date.now();

    // Fetch page of conversations
    const response = await fetch(
      `https://${REAMAZE_BRAND}.reamaze.com/api/v1/conversations?filter=all&page=${page}`,
      {
        headers: {
          "Accept": "application/json",
          "Authorization": reamazeAuth,
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch page ${page}: ${response.status}`);
      errors++;
      continue;
    }

    const data = await response.json();
    const conversations: ReamazeConversation[] = data.conversations;

    // Process each conversation
    for (const conv of conversations) {
      try {
        // Fetch full message thread
        const messages = await fetchConversationThread(conv.slug);

        // Prepare conversation record
        const convRecord = {
          reamaze_slug: conv.slug,
          subject: conv.subject,
          status: conv.status,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          customer_name: conv.author?.name || null,
          customer_email: conv.author?.email || null,
          customer_company: inferCompany(conv.author?.email || ""),
          first_message: conv.message?.body || null,
          first_message_clean: cleanHtml(conv.message?.body || ""),
          message_count: messages.length || 1,
          tags: conv.tag_list || [],
          synced_at: new Date().toISOString(),
          raw_data: conv,
        };

        // Upsert conversation
        const { data: upsertedConv, error: convError } = await supabase
          .from("wholesale_conversations")
          .upsert(convRecord, { onConflict: "reamaze_slug" })
          .select("id")
          .single();

        if (convError) {
          console.error(`  Error upserting ${conv.slug}:`, convError.message);
          errors++;
          continue;
        }

        // Insert messages if we have them
        if (messages.length > 0 && upsertedConv) {
          const messageRecords = messages.map((msg, idx) => ({
            conversation_id: upsertedConv.id,
            reamaze_message_id: msg.id || `${conv.slug}-${idx}`,
            body: msg.body,
            body_clean: cleanHtml(msg.body),
            sender_name: msg.user?.name || null,
            sender_email: msg.user?.email || null,
            sender_type: msg.user?.staff ? "staff" : "customer",
            created_at: msg.created_at,
          }));

          // Upsert messages (ignore conflicts)
          const { error: msgError } = await supabase
            .from("wholesale_messages")
            .upsert(messageRecords, {
              onConflict: "conversation_id,reamaze_message_id",
              ignoreDuplicates: true
            });

          if (msgError && !msgError.message.includes("duplicate")) {
            console.error(`  Error inserting messages for ${conv.slug}:`, msgError.message);
          }
        }

        synced++;

        // Rate limiting between conversations
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_CONVERSATIONS));

      } catch (err) {
        console.error(`  Error processing ${conv.slug}:`, err);
        errors++;
      }
    }

    // Progress update
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (synced / (parseInt(elapsed) || 1)).toFixed(1);
    const eta = ((totalCount - synced) / parseFloat(rate) / 60).toFixed(1);

    console.log(`Page ${page}/${pageCount} | Synced: ${synced}/${totalCount} | Rate: ${rate}/s | ETA: ${eta} min | Errors: ${errors}`);

    // Rate limiting between pages
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log("\n=== Sync Complete ===");
  console.log(`Total synced: ${synced}`);
  console.log(`Errors: ${errors}`);
  console.log(`Time: ${totalTime} minutes`);

  // Verify counts
  const { count } = await supabase
    .from("wholesale_conversations")
    .select("*", { count: "exact", head: true });

  console.log(`\nDatabase now has: ${count} conversations`);
}

// Run
syncAllConversations().catch(console.error);
