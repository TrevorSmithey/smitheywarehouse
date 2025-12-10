import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function createTable() {
  // Read the migration file
  const sql = fs.readFileSync("supabase/migrations/20251210_support_tickets.sql", "utf-8");

  console.log("Executing SQL via Supabase Management API...");
  console.log("SQL:", sql.substring(0, 200) + "...");

  // Use the REST API to run SQL
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_KEY!,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY!}`,
      },
      body: JSON.stringify({ sql }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.log("RPC not available:", text);
    console.log("\nPlease run this SQL in the Supabase SQL Editor:");
    console.log("https://supabase.com/dashboard/project/rpfkpxoyucocriifutfy/sql/new");
    console.log("\n" + sql);

    // Try a simple insert to verify the table exists or not
    console.log("\nChecking if table exists...");
    const { data, error } = await supabase
      .from("support_tickets")
      .select("count")
      .limit(1);

    if (error) {
      console.log("Table does NOT exist:", error.message);
      console.log("\nCopy the SQL above and run it in Supabase SQL Editor.");
    } else {
      console.log("Table already exists!");
    }
  } else {
    console.log("SQL executed successfully!");
  }
}

createTable().catch(console.error);
