/**
 * Setup Component Planning Tables
 * Creates component_orders and component_lead_times tables, then inserts sample data
 * Run with: npx tsx scripts/setup-component-planning.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// SQL to create tables (copied from migration)
const createTablesSql = `
-- Component Orders Table
CREATE TABLE IF NOT EXISTS component_orders (
  id SERIAL PRIMARY KEY,
  component_sku TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  po_number TEXT,
  supplier TEXT,
  order_date DATE NOT NULL,
  expected_arrival DATE,
  actual_arrival DATE,
  status TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'in_transit', 'partial', 'received', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Component Lead Times Table
CREATE TABLE IF NOT EXISTS component_lead_times (
  id SERIAL PRIMARY KEY,
  component_sku TEXT NOT NULL,
  supplier TEXT,
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days >= 0),
  min_order_quantity INTEGER DEFAULT 1,
  cost_per_unit DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(component_sku, COALESCE(supplier, ''))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comp_orders_sku ON component_orders(component_sku);
CREATE INDEX IF NOT EXISTS idx_comp_orders_status ON component_orders(status);
CREATE INDEX IF NOT EXISTS idx_comp_lead_times_sku ON component_lead_times(component_sku);
`;

// Sample lead times (placeholder - user will provide real data)
const sampleLeadTimes = [
  // Boxes typically have long lead times (overseas suppliers)
  { component_sku: "Box Insert 12T", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Box Insert 10T", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Box Insert 10C", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Box Insert 8C", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Product Box 12T", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Product Box 10T", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Product Box 10C", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },
  { component_sku: "Product Box 8C", supplier: "Box Supplier", lead_time_days: 45, min_order_quantity: 500 },

  // Raw castings - foundry lead times
  { component_sku: "12Trad Raw", supplier: "Foundry", lead_time_days: 21, min_order_quantity: 100 },
  { component_sku: "10Trad Raw", supplier: "Foundry", lead_time_days: 21, min_order_quantity: 100 },
  { component_sku: "10Chef Raw", supplier: "Foundry", lead_time_days: 21, min_order_quantity: 100 },
  { component_sku: "8Chef Raw", supplier: "Foundry", lead_time_days: 21, min_order_quantity: 100 },

  // Printed materials - shorter lead times
  { component_sku: "Handle Tag", supplier: "Print Shop", lead_time_days: 14, min_order_quantity: 1000 },
  { component_sku: "Use Postcard", supplier: "Print Shop", lead_time_days: 14, min_order_quantity: 1000 },
  { component_sku: "12Trad Slip", supplier: "Print Shop", lead_time_days: 14, min_order_quantity: 500 },
  { component_sku: "10Trad Slip", supplier: "Print Shop", lead_time_days: 14, min_order_quantity: 500 },
  { component_sku: "10Chef Slip", supplier: "Print Shop", lead_time_days: 14, min_order_quantity: 500 },
  { component_sku: "8Chef Slip", supplier: "Print Shop", lead_time_days: 14, min_order_quantity: 500 },
];

// Sample orders on order (placeholder data)
const sampleOrders = [
  // Box order coming in January
  {
    component_sku: "Box Insert 12T",
    quantity_ordered: 2000,
    quantity_received: 0,
    po_number: "PO-2024-1201",
    supplier: "Box Supplier",
    order_date: "2024-11-15",
    expected_arrival: "2025-01-15",
    status: "in_transit",
    notes: "Restock order for Q1 production",
  },
  {
    component_sku: "Box Insert 10T",
    quantity_ordered: 1500,
    quantity_received: 0,
    po_number: "PO-2024-1202",
    supplier: "Box Supplier",
    order_date: "2024-11-15",
    expected_arrival: "2025-01-15",
    status: "in_transit",
    notes: "Restock order for Q1 production",
  },
  // Raw castings order
  {
    component_sku: "12Trad Raw",
    quantity_ordered: 1000,
    quantity_received: 0,
    po_number: "PO-2024-1210",
    supplier: "Foundry",
    order_date: "2024-12-01",
    expected_arrival: "2025-01-05",
    status: "ordered",
    notes: "January production run",
  },
  // Print materials
  {
    component_sku: "Handle Tag",
    quantity_ordered: 50000,
    quantity_received: 0,
    po_number: "PO-2024-1215",
    supplier: "Print Shop",
    order_date: "2024-12-10",
    expected_arrival: "2024-12-28",
    status: "ordered",
    notes: "Quarterly print run",
  },
];

async function setupComponentPlanning() {
  console.log("Setting up component planning tables...\n");

  // Create tables using raw SQL
  console.log("Creating tables...");
  const { error: sqlError } = await supabase.rpc("exec_sql", { sql: createTablesSql }).single();

  // If RPC doesn't exist, try direct query (this is just for local dev)
  if (sqlError) {
    console.log("Note: exec_sql RPC not available, tables may need to be created via Supabase dashboard");
    console.log("Proceeding with data insertion...\n");
  }

  // Insert sample lead times
  console.log("Inserting sample lead times...");
  const { data: leadTimeData, error: leadTimeError } = await supabase
    .from("component_lead_times")
    .upsert(sampleLeadTimes, { onConflict: "component_sku,supplier" })
    .select();

  if (leadTimeError) {
    if (leadTimeError.message.includes("does not exist")) {
      console.error("Table component_lead_times does not exist. Please create it via Supabase dashboard using the migration SQL.");
      console.log("\nSQL to run in Supabase SQL Editor:");
      console.log("----------------------------------------");
      console.log(createTablesSql);
      console.log("----------------------------------------");
      return;
    }
    console.error("Error inserting lead times:", leadTimeError.message);
  } else {
    console.log(`  Inserted ${leadTimeData?.length || 0} lead time entries`);
  }

  // Insert sample orders
  console.log("Inserting sample orders...");
  const { data: orderData, error: orderError } = await supabase
    .from("component_orders")
    .upsert(sampleOrders, { onConflict: "id" })
    .select();

  if (orderError) {
    console.error("Error inserting orders:", orderError.message);
  } else {
    console.log(`  Inserted ${orderData?.length || 0} order entries`);
  }

  console.log("\nSetup complete!");
  console.log("\nNote: This is sample/placeholder data.");
  console.log("User should update with real lead times and current orders.");
}

setupComponentPlanning();
