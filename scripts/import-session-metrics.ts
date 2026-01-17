/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/**
 * Import session/conversion metrics from KPIs - Fathom.xlsx
 *
 * Source data rows:
 * - Row 5: Web Sessions
 * - Row 6: Web Orders
 * - Row 8: New Customers
 * - Row 9: New Customer Net Sales
 * - Row 10: New Customer AOV
 * - Row 11: Returning Customers
 * - Row 12: Returning Customer Net Sales
 * - Row 13: Returning Customer AOV
 */

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface SessionMetric {
  month: string;
  web_sessions: number | null;
  web_orders: number | null;
  conversion_rate: number | null;
  new_customers: number | null;
  new_customer_revenue: number | null;
  new_customer_aov: number | null;
  returning_customers: number | null;
  returning_customer_revenue: number | null;
  returning_customer_aov: number | null;
}

async function importSessionMetrics() {
  const filePath = '/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/KPIs - Fathom.xlsx';

  console.log('Reading Excel file...');
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON with header row detection
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  // Row indices (0-based)
  // Row 0: Company Name header
  // Row 1: Financial Year Start
  // Row 2-3: Empty
  // Row 4: "Custom KPIs" + dates
  const ROW_DATES = 4;  // Row with month dates
  const ROW_WEB_SESSIONS = 6;
  const ROW_WEB_ORDERS = 7;
  const ROW_NEW_CUSTOMERS = 9;
  const ROW_NEW_CUSTOMER_SALES = 10;
  const ROW_NEW_CUSTOMER_AOV = 11;
  const ROW_RETURNING_CUSTOMERS = 12;
  const ROW_RETURNING_CUSTOMER_SALES = 13;
  const ROW_RETURNING_CUSTOMER_AOV = 14;

  // Column where data starts (after label columns)
  const DATA_START_COL = 2;

  const metrics: SessionMetric[] = [];

  // Get the date row
  const dateRow = data[ROW_DATES];
  console.log('Date row length:', dateRow?.length);
  console.log('First few date values:', dateRow?.slice(2, 6));
  console.log('Sessions row label:', data[ROW_WEB_SESSIONS]?.[1]);

  // Process each month column
  for (let col = DATA_START_COL; col < (dateRow?.length || 0); col++) {
    const dateVal = dateRow[col];
    if (!dateVal) continue;

    // Parse the date - Excel stores dates as numbers
    let monthDate: Date;
    if (typeof dateVal === 'number') {
      // Excel serial date to JS Date
      const excelEpoch = new Date(1899, 11, 30);
      monthDate = new Date(excelEpoch.getTime() + dateVal * 86400000);
      monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    } else if (dateVal instanceof Date) {
      monthDate = new Date(dateVal.getFullYear(), dateVal.getMonth(), 1);
    } else if (typeof dateVal === 'string' && dateVal.includes('-')) {
      // ISO date string
      const parsed = new Date(dateVal);
      monthDate = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    } else {
      console.log(`Skipping invalid date at col ${col}:`, dateVal);
      continue;
    }

    // Skip future dates
    if (monthDate > new Date()) continue;

    // Format as YYYY-MM-01
    const monthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`;

    const getVal = (row: number): number | null => {
      const val = data[row]?.[col];
      if (val === undefined || val === null || val === '' || val === 0) return null;
      return typeof val === 'number' ? val : parseFloat(val);
    };

    const webSessions = getVal(ROW_WEB_SESSIONS);
    const webOrders = getVal(ROW_WEB_ORDERS);
    const conversionRate = webSessions && webOrders ? webOrders / webSessions : null;

    const metric: SessionMetric = {
      month: monthStr,
      web_sessions: webSessions,
      web_orders: webOrders,
      conversion_rate: conversionRate,
      new_customers: getVal(ROW_NEW_CUSTOMERS),
      new_customer_revenue: getVal(ROW_NEW_CUSTOMER_SALES),
      new_customer_aov: getVal(ROW_NEW_CUSTOMER_AOV),
      returning_customers: getVal(ROW_RETURNING_CUSTOMERS),
      returning_customer_revenue: getVal(ROW_RETURNING_CUSTOMER_SALES),
      returning_customer_aov: getVal(ROW_RETURNING_CUSTOMER_AOV),
    };

    // Only add if we have at least sessions data
    if (metric.web_sessions) {
      metrics.push(metric);
    }
  }

  console.log(`Parsed ${metrics.length} months of data`);
  console.log('Sample:', metrics.slice(-3));

  // Upsert to database
  console.log('Upserting to database...');

  const { data: result, error } = await supabase
    .from('session_metrics')
    .upsert(metrics, { onConflict: 'month' })
    .select();

  if (error) {
    console.error('Error upserting:', error);
    throw error;
  }

  console.log(`Successfully upserted ${result?.length || 0} records`);
}

importSessionMetrics()
  .then(() => {
    console.log('Import complete');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  });
