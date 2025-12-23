import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function migrate() {
  console.log("Creating support_tickets table...");

  // Create the table using raw SQL via rpc
  const { error } = await supabase.rpc("exec_sql", {
    sql: `
      -- Create support_tickets table
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        reamaze_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        subject TEXT,
        message_body TEXT,
        channel TEXT,
        perma_url TEXT,

        -- AI classification
        category TEXT NOT NULL,
        sentiment TEXT NOT NULL,
        summary TEXT NOT NULL,
        urgency TEXT,

        -- Metadata
        analyzed_at TIMESTAMPTZ DEFAULT NOW(),
        synced_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON support_tickets(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tickets_category ON support_tickets(category);
      CREATE INDEX IF NOT EXISTS idx_tickets_sentiment ON support_tickets(sentiment);
      CREATE INDEX IF NOT EXISTS idx_tickets_reamaze_id ON support_tickets(reamaze_id);
    `,
  });

  if (error) {
    // If rpc doesn't exist, we need to create table via Supabase dashboard or different method
    console.log("RPC not available, trying alternative approach...");

    // Test if table already exists by trying to select from it
    const { error: selectError } = await supabase
      .from("support_tickets")
      .select("id")
      .limit(1);

    if (selectError?.code === "42P01") {
      console.log("Table does not exist. Please create it via Supabase SQL Editor:");
      console.log(`
-- Create support_tickets table
CREATE TABLE support_tickets (
  id SERIAL PRIMARY KEY,
  reamaze_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  subject TEXT,
  message_body TEXT,
  channel TEXT,
  perma_url TEXT,

  -- AI classification
  category TEXT NOT NULL,
  sentiment TEXT NOT NULL,
  summary TEXT NOT NULL,
  urgency TEXT,

  -- Metadata
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX idx_tickets_category ON support_tickets(category);
CREATE INDEX idx_tickets_sentiment ON support_tickets(sentiment);
CREATE INDEX idx_tickets_reamaze_id ON support_tickets(reamaze_id);
      `);
    } else if (selectError) {
      console.log("Error checking table:", selectError.message);
    } else {
      console.log("Table already exists!");
    }
  } else {
    console.log("Migration completed successfully!");
  }
}

migrate().catch(console.error);
