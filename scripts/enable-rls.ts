/**
 * Enable RLS on all public tables
 * This prevents direct database access via the anon key
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const TABLES = [
  "orders",
  "line_items",
  "shipments",
  "inventory",
  "inventory_history",
  "products",
  "warehouses",
  "b2b_fulfilled",
  "sync_logs",
  "daily_stats",
  "shopify_customers",
  "typeform_leads",
  "abandoned_checkouts",
  "customer_cohorts",
  "daily_ecommerce_stats",
  "session_metrics",
  "cross_sell_sequences",
  "basket_affinity",
  "product_repeat_rates",
  "forecasts",
  "holiday_tracking",
  "cron_locks",
  "sku_canonical",
  "assembly_daily",
  "assembly_sku_daily",
  "assembly_targets",
  "assembly_config",
  "production_targets",
  "component_lead_times",
  "component_orders",
  "bill_of_materials",
  "ns_customer_transactions",
  "ns_wholesale_transactions",
  "ns_wholesale_line_items",
  "ns_pl_monthly",
  "ns_pl_by_account",
  // Historical tracking tables (added 2025-12-23)
  "daily_operations_snapshot",
  "component_inventory_history",
  "budget_changelog",
  "lead_time_history",
];

async function enableRLS() {
  console.log(`Enabling RLS on ${TABLES.length} tables...\n`);

  let success = 0;
  let failed = 0;

  for (const table of TABLES) {
    const sql = `
      ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Service role only" ON public.${table};
      CREATE POLICY "Service role only" ON public.${table}
        FOR ALL USING (auth.role() = 'service_role');
    `;

    const { error } = await supabase.rpc("exec_sql", { sql });

    if (error) {
      // Try alternative approach - run statements separately
      const statements = [
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
        `DROP POLICY IF EXISTS "Service role only" ON public.${table}`,
        `CREATE POLICY "Service role only" ON public.${table} FOR ALL USING (auth.role() = 'service_role')`,
      ];

      let stmtSuccess = true;
      for (const stmt of statements) {
        const { error: stmtError } = await supabase.rpc("exec_sql", { sql: stmt });
        if (stmtError) {
          console.error(`✗ ${table}: ${stmtError.message}`);
          stmtSuccess = false;
          break;
        }
      }

      if (stmtSuccess) {
        console.log(`✓ ${table}`);
        success++;
      } else {
        failed++;
      }
    } else {
      console.log(`✓ ${table}`);
      success++;
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`RLS enabled on ${success}/${TABLES.length} tables`);
  if (failed > 0) {
    console.log(`Failed: ${failed} tables (may need manual intervention)`);
  }
}

enableRLS().catch(console.error);
