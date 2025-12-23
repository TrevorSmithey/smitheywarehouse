import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

async function migrate() {
  // Use RPC to run raw SQL
  const { error } = await supabase.rpc("exec_sql", {
    sql: `
      ALTER TABLE support_tickets
      ADD COLUMN IF NOT EXISTS customer_email TEXT,
      ADD COLUMN IF NOT EXISTS order_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_spent NUMERIC(10,2) DEFAULT 0;
    `,
  });

  if (error) {
    // If RPC doesn't exist, try direct query approach
    console.log("RPC not available, trying alternative...");

    // Test if columns already exist by trying to select them
    const { error: testError } = await supabase
      .from("support_tickets")
      .select("customer_email, order_count, total_spent")
      .limit(1);

    if (testError && testError.message.includes("does not exist")) {
      console.error("Columns don't exist. Please run this SQL in Supabase dashboard:");
      console.log(`
ALTER TABLE support_tickets
ADD COLUMN IF NOT EXISTS customer_email TEXT,
ADD COLUMN IF NOT EXISTS order_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_spent NUMERIC(10,2) DEFAULT 0;
      `);
    } else if (!testError) {
      console.log("Columns already exist!");
    } else {
      console.error("Test error:", testError);
    }
  } else {
    console.log("Columns added successfully!");
  }
}

migrate();
