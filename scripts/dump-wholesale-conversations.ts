/**
 * Wholesale Conversations Dump Script
 *
 * Phase 1A: Fetches ALL conversations from the smitheysales Reamaze brand
 * and dumps them to a markdown file for human review.
 *
 * No classification - just raw data to understand patterns before assuming categories.
 *
 * Usage: npx tsx scripts/dump-wholesale-conversations.ts
 * Output: ~/Downloads/wholesale-conversations-raw-{date}.md
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { ReamazeClient, cleanMessageBody } from "../lib/reamaze";

// Load environment variables
dotenv.config({ path: ".env.local" });

// Extended conversation interface to include full message thread
interface FullConversation {
  slug: string;
  subject: string | null;
  status: string;
  created_at: string;
  messages: Array<{
    body: string;
    created_at: string;
    user?: {
      name: string;
      email: string;
      type: "customer" | "staff";
    };
  }>;
  author?: {
    name: string;
    email: string;
  };
  tag_list?: string[];
}

// Spam indicators to flag (but not skip - we want to see them)
const SPAM_INDICATORS = [
  "unsubscribe",
  "out of office",
  "automatic reply",
  "this is an automated",
  "delivery status notification",
  "auto-reply",
  "autoreply",
];

function isLikelySpam(subject: string | null, body: string): boolean {
  const combined = `${subject || ""} ${body}`.toLowerCase();
  return SPAM_INDICATORS.some(indicator => combined.includes(indicator));
}

async function main() {
  console.log("=== Wholesale Conversations Dump ===\n");

  // Verify env vars
  const brand = process.env.REAMAZE_WHOLESALE_BRAND;
  const email = process.env.REAMAZE_EMAIL;
  const apiToken = process.env.REAMAZE_API_TOKEN;

  if (!brand || !email || !apiToken) {
    console.error("Missing required environment variables:");
    console.error("  REAMAZE_WHOLESALE_BRAND:", brand ? "set" : "MISSING");
    console.error("  REAMAZE_EMAIL:", email ? "set" : "MISSING");
    console.error("  REAMAZE_API_TOKEN:", apiToken ? "set" : "MISSING");
    process.exit(1);
  }

  console.log(`Brand: ${brand}`);
  console.log(`Email: ${email}\n`);

  // Create client for wholesale brand
  const client = new ReamazeClient({ brand, email, apiToken });

  // First, verify connection by fetching channels
  console.log("Verifying API connection...");
  try {
    const channelsResponse = await fetch(
      `https://${brand}.reamaze.com/api/v1/channels`,
      {
        headers: {
          "Accept": "application/json",
          "Authorization": `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
        },
      }
    );

    if (!channelsResponse.ok) {
      throw new Error(`API error: ${channelsResponse.status}`);
    }

    const channelsData = await channelsResponse.json();
    console.log(`Connected! Found ${channelsData.channels?.length || 0} channels.\n`);

    // Log channel names for reference
    if (channelsData.channels) {
      console.log("Available channels:");
      for (const ch of channelsData.channels) {
        console.log(`  - ${ch.name} (${ch.slug})`);
      }
      console.log("");
    }
  } catch (error) {
    console.error("Failed to connect to Reamaze API:", error);
    process.exit(1);
  }

  // Fetch ALL conversations (paginated)
  console.log("Fetching all conversations...");
  const allConversations: Array<{
    slug: string;
    subject: string | null;
    status: string;
    created_at: string;
    message: { body: string; created_at: string };
    author?: { name: string; email: string };
    tag_list?: string[];
    category?: { name?: string };
  }> = [];

  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await client.getConversations({
      filter: "all",
      page,
      sort: "changed",
    });

    allConversations.push(...response.conversations);
    console.log(`  Page ${page}: ${response.conversations.length} conversations (total: ${allConversations.length})`);

    hasMore = page < response.page_count;
    page++;

    // Rate limiting
    if (hasMore) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\nTotal conversations: ${allConversations.length}`);

  // For each conversation, fetch full thread
  console.log("\nFetching full conversation threads...");
  const fullConversations: FullConversation[] = [];
  let processed = 0;

  for (const conv of allConversations) {
    try {
      // Fetch full conversation details
      const fullConvResponse = await fetch(
        `https://${brand}.reamaze.com/api/v1/conversations/${conv.slug}`,
        {
          headers: {
            "Accept": "application/json",
            "Authorization": `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
          },
        }
      );

      if (!fullConvResponse.ok) {
        console.error(`  Failed to fetch ${conv.slug}: ${fullConvResponse.status}`);
        continue;
      }

      const fullData = await fullConvResponse.json();
      const fullConv = fullData.conversation;

      // Extract messages from the full conversation
      const messages: FullConversation["messages"] = [];

      // Reamaze returns messages in the 'messages' array
      if (fullConv.messages && Array.isArray(fullConv.messages)) {
        for (const msg of fullConv.messages) {
          messages.push({
            body: msg.body || "",
            created_at: msg.created_at,
            user: msg.user ? {
              name: msg.user.name || "Unknown",
              email: msg.user.email || "",
              type: msg.user.staff ? "staff" : "customer",
            } : undefined,
          });
        }
      }

      fullConversations.push({
        slug: conv.slug,
        subject: conv.subject,
        status: conv.status,
        created_at: conv.created_at,
        messages,
        author: conv.author ? {
          name: conv.author.name,
          email: conv.author.email,
        } : undefined,
        tag_list: conv.tag_list,
      });

      processed++;
      if (processed % 10 === 0) {
        console.log(`  Processed ${processed}/${allConversations.length}`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`  Error processing ${conv.slug}:`, error);
    }
  }

  console.log(`\nFetched ${fullConversations.length} full conversations.`);

  // Sort by date (newest first)
  fullConversations.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Generate markdown report
  console.log("\nGenerating markdown report...");

  const dateStr = new Date().toISOString().split("T")[0];
  const outputPath = path.join(
    process.env.HOME || "/tmp",
    "Downloads",
    `wholesale-conversations-raw-${dateStr}.md`
  );

  let markdown = `# Wholesale Support Conversations - Raw Dump\n\n`;
  markdown += `**Generated**: ${new Date().toISOString()}\n`;
  markdown += `**Brand**: ${brand}\n`;
  markdown += `**Total Conversations**: ${fullConversations.length}\n\n`;

  // Summary stats
  let spamCount = 0;
  let openCount = 0;
  let archivedCount = 0;
  const dateRange = {
    oldest: fullConversations.length > 0
      ? fullConversations[fullConversations.length - 1].created_at
      : "N/A",
    newest: fullConversations.length > 0
      ? fullConversations[0].created_at
      : "N/A",
  };

  for (const conv of fullConversations) {
    const firstMessage = conv.messages[0]?.body || "";
    if (isLikelySpam(conv.subject, firstMessage)) spamCount++;
    if (conv.status === "open") openCount++;
    if (conv.status === "archived") archivedCount++;
  }

  markdown += `## Summary\n\n`;
  markdown += `- **Date Range**: ${dateRange.oldest.split("T")[0]} to ${dateRange.newest.split("T")[0]}\n`;
  markdown += `- **Open**: ${openCount}\n`;
  markdown += `- **Archived**: ${archivedCount}\n`;
  markdown += `- **Likely Spam**: ${spamCount}\n\n`;
  markdown += `---\n\n`;

  // Individual conversations
  for (let i = 0; i < fullConversations.length; i++) {
    const conv = fullConversations[i];
    const firstMessage = conv.messages[0]?.body || "";
    const spam = isLikelySpam(conv.subject, firstMessage);

    markdown += `## Conversation ${i + 1}: ${conv.slug}\n\n`;
    markdown += `- **Subject**: ${conv.subject || "(no subject)"}\n`;
    markdown += `- **Created**: ${conv.created_at}\n`;
    markdown += `- **Status**: ${conv.status}\n`;
    markdown += `- **Customer**: ${conv.author?.name || "Unknown"} (${conv.author?.email || "no email"})\n`;
    markdown += `- **Messages**: ${conv.messages.length}\n`;
    if (conv.tag_list && conv.tag_list.length > 0) {
      markdown += `- **Tags**: ${conv.tag_list.join(", ")}\n`;
    }
    if (spam) {
      markdown += `- **[LIKELY SPAM]**\n`;
    }
    markdown += `\n`;

    // Messages
    for (const msg of conv.messages) {
      const cleanBody = cleanMessageBody(msg.body);
      const role = msg.user?.type === "staff" ? "AGENT" : "CUSTOMER";
      const timestamp = msg.created_at.split("T")[0];
      const name = msg.user?.name || "Unknown";

      markdown += `### [${role}] ${name} (${timestamp})\n\n`;
      markdown += `${cleanBody.substring(0, 2000)}${cleanBody.length > 2000 ? "..." : ""}\n\n`;
    }

    markdown += `---\n\n`;
  }

  // Write file
  fs.writeFileSync(outputPath, markdown);
  console.log(`\nReport saved to: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB`);

  // Print quick summary to console
  console.log("\n=== Quick Summary ===");
  console.log(`Total: ${fullConversations.length} conversations`);
  console.log(`Open: ${openCount}`);
  console.log(`Archived: ${archivedCount}`);
  console.log(`Likely spam: ${spamCount}`);
  console.log(`Date range: ${dateRange.oldest.split("T")[0]} to ${dateRange.newest.split("T")[0]}`);
}

main().catch(console.error);
