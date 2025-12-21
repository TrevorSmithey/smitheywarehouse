/**
 * NetSuite REST API Client
 *
 * Uses OAuth 1.0 Token-Based Authentication (TBA)
 * Ported from Python sync-netsuite-wholesale-v3.py
 */

import crypto from "crypto";

// NetSuite credentials from environment
const NS_ACCOUNT_ID = process.env.NS_ACCOUNT_ID || "9649233";
const NS_CONSUMER_KEY = process.env.NS_CONSUMER_KEY;
const NS_CONSUMER_SECRET = process.env.NS_CONSUMER_SECRET;
const NS_TOKEN_ID = process.env.NS_TOKEN_ID;
const NS_TOKEN_SECRET = process.env.NS_TOKEN_SECRET;

const NS_BASE_URL = `https://${NS_ACCOUNT_ID}.suitetalk.api.netsuite.com`;

/**
 * Generate OAuth 1.0 signature for NetSuite API requests
 */
function generateOAuthSignature(
  method: string,
  url: string,
  oauthParams: Record<string, string>
): string {
  // Create parameter string (sorted alphabetically)
  const sortedParams = Object.keys(oauthParams)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(oauthParams[key])}`)
    .join("&");

  // Create base string
  const baseUrl = url.split("?")[0];
  const baseString = `${method}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(sortedParams)}`;

  // Create signing key
  const signingKey = `${encodeURIComponent(NS_CONSUMER_SECRET || "")}&${encodeURIComponent(NS_TOKEN_SECRET || "")}`;

  // Generate HMAC-SHA256 signature
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(baseString)
    .digest("base64");

  return signature;
}

/**
 * Build OAuth 1.0 Authorization header for NetSuite
 */
function buildAuthHeader(method: string, url: string): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: NS_CONSUMER_KEY || "",
    oauth_token: NS_TOKEN_ID || "",
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_version: "1.0",
  };

  // Generate signature
  oauthParams.oauth_signature = generateOAuthSignature(method, url, oauthParams);

  // Build header string
  const authParams = Object.keys(oauthParams)
    .map((key) => `${key}="${encodeURIComponent(oauthParams[key])}"`)
    .join(", ");

  return `OAuth realm="${NS_ACCOUNT_ID}", ${authParams}`;
}

/**
 * Execute SuiteQL query against NetSuite
 * Uses AbortController for timeout and exponential backoff for reliability
 */
export async function executeSuiteQL<T = Record<string, unknown>>(
  query: string,
  retries = 4
): Promise<T[]> {
  const url = `${NS_BASE_URL}/services/rest/query/v1/suiteql`;
  const TIMEOUT_MS = 30000; // 30 second timeout for Vercel serverless

  for (let attempt = 0; attempt < retries; attempt++) {
    // Create AbortController for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const authHeader = buildAuthHeader("POST", url);

      console.log(`[NETSUITE] Executing query (attempt ${attempt + 1}/${retries})...`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Prefer: "transient",
        },
        body: JSON.stringify({ q: query }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        console.log(`[NETSUITE] Rate limited (429), waiting 30s...`);
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NetSuite API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      console.log(`[NETSUITE] Query successful, got ${data.items?.length || 0} items`);
      return (data.items || []) as T[];
    } catch (error) {
      clearTimeout(timeoutId);

      // Classify error type for better debugging
      const isTimeout = error instanceof Error && error.name === "AbortError";
      const errorType = isTimeout ? "TIMEOUT" : "NETWORK/API";
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : "";

      console.error(`[NETSUITE] ${errorType} error (attempt ${attempt + 1}/${retries}): ${errorMessage}`);
      console.error(`[NETSUITE] Error details: name=${error instanceof Error ? error.name : "unknown"}, cause=${JSON.stringify((error as Error)?.cause || "none")}`);
      if (errorStack) console.error(`[NETSUITE] Stack: ${errorStack.split("\n").slice(0, 3).join(" -> ")}`);

      if (attempt < retries - 1) {
        // Exponential backoff: 2s, 8s, 32s
        const backoffMs = Math.pow(4, attempt) * 2000;
        console.log(`[NETSUITE] Waiting ${backoffMs / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error("NetSuite request failed after all retries");
}

/**
 * Check if NetSuite credentials are configured
 */
export function hasNetSuiteCredentials(): boolean {
  return !!(NS_CONSUMER_KEY && NS_CONSUMER_SECRET && NS_TOKEN_ID && NS_TOKEN_SECRET);
}

/**
 * Test NetSuite connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    await executeSuiteQL("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// Transaction types from NetSuite
export interface NSTransaction {
  transaction_id: number;
  tranid: string;
  transaction_type: string;
  trandate: string;
  transaction_total: string | null;
  status: string | null;
  customer_id: number;
}

export interface NSLineItem {
  transaction_id: number;
  line_id: number;
  item_id: number | null;
  sku: string;
  quantity: string;
  rate: string | null;
  netamount: string | null;
  foreignamount: string | null;
  itemtype: string | null;
}

export interface NSCustomer {
  // Core identifiers
  id: number;
  entityid: string;
  entitynumber: string | null;
  entitytitle: string | null;
  externalid: string | null;
  companyname: string;
  altname: string | null;
  fullname: string | null;

  // Contact info
  email: string | null;
  phone: string | null;
  altphone: string | null;
  fax: string | null;
  url: string | null;

  // Dates
  datecreated: string | null;
  dateclosed: string | null;
  lastmodifieddate: string | null;
  firstsaledate: string | null;
  lastsaledate: string | null;
  firstorderdate: string | null;
  lastorderdate: string | null;
  firstsaleperiod: string | null;
  lastsaleperiod: string | null;

  // Status flags
  isinactive: string;
  isperson: string;
  isjob: string;
  isbudgetapproved: string;
  duplicate: string;
  weblead: string;
  giveaccess: string;
  unsubscribe: string;

  // Relationships
  parent: number | null;
  toplevelparent: number | null;

  // Classification
  terms: string | null;
  category: string | null;
  entitystatus: string | null;
  salesrep: string | null;
  territory: string | null;
  searchstage: string | null;
  probability: string | null;

  // Currency & Financial
  currency: string | null;
  displaysymbol: string | null;
  symbolplacement: string | null;
  overridecurrencyformat: string;
  creditlimit: string | null;
  balance: string | null;
  overduebalance: string | null;
  consolbalance: string | null;
  unbilledorders: string | null;
  depositbalance: string | null;
  receivablesaccount: string | null;
  creditholdoverride: string | null;
  oncredithold: string;
  daysoverduesearch: string | null;

  // Addresses
  billaddress: string | null;
  shipaddress: string | null;
  defaultbillingaddress: string | null;
  defaultshippingaddress: string | null;

  // Preferences
  emailpreference: string | null;
  emailtransactions: string;
  faxtransactions: string;
  printtransactions: string;
  globalsubscriptionstatus: string | null;
  shipcomplete: string;
  shippingcarrier: string | null;
  alcoholrecipienttype: string | null;
  taxable: string;

  // Custom fields (custentity_*)
  custentity1: string | null;
  custentity_2663_customer_refund: string;
  custentity_2663_direct_debit: string;
  custentity_alf_cust_hide_service_periods: string;
  custentity_alf_customer_hide_total_vat: string;
  custentity_alf_customer_store_pdf: string;
  custentity_bdc_lastupdatedbyimport: string;
  custentity_bdc_shortname: string | null;
  custentity_bdc_sync_exclude: string;
  custentity_celigo_etail_cust_exported: string;
  custentity_celigo_is_updated_via_shp: string;
  custentity_mhi_customer_type: string | null;
  custentity_mhi_intsagramfacebook: string;
  custentity_naw_trans_need_approval: string;
}

/**
 * Fetch wholesale transactions (CashSale + CustInvc for business customers)
 * @param sinceDays - If provided, only fetch transactions from the last N days (for incremental sync)
 */
export async function fetchWholesaleTransactions(
  offset = 0,
  limit = 1000,
  sinceDays?: number
): Promise<NSTransaction[]> {
  const dateFilter = sinceDays
    ? `AND t.trandate >= SYSDATE - ${sinceDays}`
    : '';

  const query = `
    SELECT DISTINCT
      t.id as transaction_id,
      t.tranid,
      t.type as transaction_type,
      t.trandate,
      t.foreigntotal as transaction_total,
      t.status,
      t.entity as customer_id
    FROM transaction t
    JOIN customer c ON t.entity = c.id
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    AND t.type IN ('CashSale', 'CustInvc')
    ${dateFilter}
    ORDER BY t.id
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  return executeSuiteQL<NSTransaction>(query);
}

/**
 * Fetch wholesale line items
 * @param sinceDays - If provided, only fetch line items from transactions in the last N days (for incremental sync)
 */
export async function fetchWholesaleLineItems(
  offset = 0,
  limit = 1000,
  sinceDays?: number
): Promise<NSLineItem[]> {
  const dateFilter = sinceDays
    ? `AND t.trandate >= SYSDATE - ${sinceDays}`
    : '';

  const query = `
    SELECT
      t.id as transaction_id,
      tl.id as line_id,
      tl.item as item_id,
      BUILTIN.DF(tl.item) as sku,
      tl.quantity,
      tl.rate,
      tl.netamount,
      tl.foreignamount,
      tl.itemtype
    FROM transactionline tl
    JOIN transaction t ON tl.transaction = t.id
    JOIN customer c ON t.entity = c.id
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    AND t.type IN ('CashSale', 'CustInvc')
    AND tl.mainline = 'F'
    AND tl.item IS NOT NULL
    ${dateFilter}
    ORDER BY t.id, tl.linesequencenumber
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  return executeSuiteQL<NSLineItem>(query);
}

/**
 * Fetch wholesale customers (business entities)
 * Optimized for Vercel serverless - removed problematic fields:
 * - BUILTIN.DF calls (cause timeouts)
 * - Calculated balance fields (balance, overduebalance, consolbalance, unbilledorders, depositbalance)
 * - Address fields (billaddress, shipaddress, defaultbillingaddress, defaultshippingaddress)
 *   These fields cause 30+ second query times from Vercel serverless
 */
export async function fetchWholesaleCustomers(
  offset = 0,
  limit = 200
): Promise<NSCustomer[]> {
  // Core customer fields only - no address or balance fields
  const query = `
    SELECT
      c.id,
      c.entityid,
      c.companyname,
      c.email,
      c.phone,
      c.altphone,
      c.fax,
      c.url,
      c.datecreated,
      c.lastmodifieddate,
      c.firstsaledate,
      c.lastsaledate,
      c.firstorderdate,
      c.lastorderdate,
      c.isinactive,
      c.parent,
      c.terms,
      c.category,
      c.entitystatus,
      c.salesrep,
      c.territory,
      c.currency
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    ORDER BY c.id
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  return executeSuiteQL<NSCustomer>(query);
}

// ============================================================================
// P&L Data Types and Functions
// ============================================================================

export interface NSPLByItem {
  year_month: string;
  item_name: string;
  class_id: string;
  total: string;
}

export interface NSPLByAccount {
  year_month: string;
  class_id: string;
  account_number: string;
  account_name: string;
  total: string;
}

/**
 * Categorize item SKU into product category
 */
export function categorizeItem(sku: string | null): string {
  if (!sku) return "Other";
  const upper = sku.toUpperCase();

  // Cast Iron patterns
  if (upper.startsWith("SMITH-CI-") || upper.includes("-CI-")) return "Cast Iron";

  // Carbon Steel patterns
  if (upper.startsWith("SMITH-CS-") || upper.includes("-CS-")) return "Carbon Steel";

  // Glass Lids (these are Smith-AC-Glid*)
  if (upper.includes("SMITH-AC-GLID") || upper.includes("-GLID")) return "Glass Lids";

  // Accessories (spatulas, towels, aprons, etc.) - but not glass lids
  if (
    (upper.startsWith("SMITH-AC-") && !upper.includes("GLID")) ||
    upper.startsWith("SMITH-BK-") ||
    upper.includes("SPAT") ||
    upper.includes("TOWEL") ||
    upper.includes("APRON") ||
    upper.includes("MITT") ||
    upper.includes("SCRUB") ||
    upper.includes("CARE")
  )
    return "Accessories";

  // Engraving
  if (upper.includes("SMITH-ENG") || upper === "SMITH-ENG") return "Engraving";

  // Services
  if (upper.includes("SERVICE") || upper.includes("REPAIR") || upper.includes("RESTORATION"))
    return "Services";

  return "Other";
}

/**
 * Get channel name from NS class ID
 */
export function getChannelFromClassId(classId: string | null): string {
  if (classId === "4") return "Web";
  if (classId === "5") return "Wholesale";
  return "Other";
}

/**
 * P&L Aggregated Data Type
 * Pre-aggregated by month, channel, and category in NetSuite query
 */
export interface NSPLAggregated {
  year_month: string;
  channel: string;
  category: string;
  total: string;
}

/**
 * Fetch P&L data from income accounts (the source of truth for P&L)
 * Uses transactionaccountingline to get accurate accounting amounts
 * Returns data by account, channel, and month
 *
 * EXCLUDES account 40000 "Sales" which contains "Historical Tax" entries,
 * not actual product revenue. This matches how Fathom calculates P&L.
 *
 * IMPORTANT: Uses SUM(amount * -1) for revenue accounts because:
 * - Income account credits are negative (e.g., -$1000 for $1000 sale)
 * - Discount account debits are positive (e.g., +$100 for $100 discount)
 * - Multiplying by -1 converts credits to positive revenue
 * - Discounts stay positive (they reduce net revenue separately)
 */
export async function fetchPLFromAccounts(
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<NSPLAggregated[]> {
  // Query income accounts by class (channel) - this is how Fathom gets data
  // IMPORTANT: Exclude account 40000 which is "Historical Tax (sales history only)"
  // Use SUM(amount * -1) to convert credit amounts to positive revenue
  const query = `
    SELECT
      TO_CHAR(t.trandate, 'YYYY-MM') as year_month,
      CASE
        WHEN tl.class = 4 THEN 'Web'
        WHEN tl.class = 5 THEN 'Wholesale'
        ELSE 'Other'
      END as channel,
      CASE
        WHEN a.acctnumber = '40200' THEN 'Cookware'
        WHEN a.acctnumber = '40100' THEN 'Accessories'
        WHEN a.acctnumber LIKE '403%' THEN 'Services'
        WHEN a.acctnumber LIKE '404%' THEN 'Shipping Income'
        WHEN a.acctnumber LIKE '405%' THEN 'Discounts'
        ELSE 'Other'
      END as category,
      SUM(tal.amount * -1) as total
    FROM transactionaccountingline tal
    JOIN transaction t ON tal.transaction = t.id
    JOIN account a ON tal.account = a.id
    LEFT JOIN transactionline tl ON tal.transactionline = tl.id AND tal.transaction = tl.transaction
    WHERE t.posting = 'T'
    AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
    AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
    AND a.accttype = 'Income'
    AND a.acctnumber != '40000'
    GROUP BY
      TO_CHAR(t.trandate, 'YYYY-MM'),
      CASE
        WHEN tl.class = 4 THEN 'Web'
        WHEN tl.class = 5 THEN 'Wholesale'
        ELSE 'Other'
      END,
      CASE
        WHEN a.acctnumber = '40200' THEN 'Cookware'
        WHEN a.acctnumber = '40100' THEN 'Accessories'
        WHEN a.acctnumber LIKE '403%' THEN 'Services'
        WHEN a.acctnumber LIKE '404%' THEN 'Shipping Income'
        WHEN a.acctnumber LIKE '405%' THEN 'Discounts'
        ELSE 'Other'
      END
    ORDER BY year_month, channel, category
  `;

  console.log(`[PL-FETCH] Fetching P&L from income accounts...`);
  const results = await executeSuiteQL<NSPLAggregated>(query);
  console.log(`[PL-FETCH] Got ${results.length} account-level rows`);
  return results;
}

/**
 * Fetch cookware breakdown (Cast Iron, Carbon Steel, Glass Lids)
 * Uses account 40200 with item categorization
 * Uses SUM(amount * -1) to convert credit amounts to positive revenue
 */
export async function fetchPLCookwareBreakdown(
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<NSPLAggregated[]> {
  // Break down account 40200 (Cookware) by SKU pattern
  // Use SUM(amount * -1) since income credits are negative
  const query = `
    SELECT
      TO_CHAR(t.trandate, 'YYYY-MM') as year_month,
      CASE
        WHEN tl.class = 4 THEN 'Web'
        WHEN tl.class = 5 THEN 'Wholesale'
        ELSE 'Other'
      END as channel,
      CASE
        WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CI-%' THEN 'Cast Iron'
        WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CS-%' THEN 'Carbon Steel'
        WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%GLID%' THEN 'Glass Lids'
        ELSE 'Other Cookware'
      END as category,
      SUM(tal.amount * -1) as total
    FROM transactionaccountingline tal
    JOIN transaction t ON tal.transaction = t.id
    JOIN account a ON tal.account = a.id
    JOIN transactionline tl ON tal.transactionline = tl.id AND tal.transaction = tl.transaction
    WHERE t.posting = 'T'
    AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
    AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
    AND a.acctnumber = '40200'
    GROUP BY
      TO_CHAR(t.trandate, 'YYYY-MM'),
      CASE
        WHEN tl.class = 4 THEN 'Web'
        WHEN tl.class = 5 THEN 'Wholesale'
        ELSE 'Other'
      END,
      CASE
        WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CI-%' THEN 'Cast Iron'
        WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CS-%' THEN 'Carbon Steel'
        WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%GLID%' THEN 'Glass Lids'
        ELSE 'Other Cookware'
      END
    ORDER BY year_month, channel, category
  `;

  console.log(`[PL-FETCH] Fetching cookware breakdown...`);
  const results = await executeSuiteQL<NSPLAggregated>(query);
  console.log(`[PL-FETCH] Got ${results.length} cookware breakdown rows`);
  return results;
}

/**
 * @deprecated Use fetchPLFromAccounts + fetchPLCookwareBreakdown instead
 */
export async function fetchPLCookware(
  startDate: string,
  endDate: string
): Promise<NSPLAggregated[]> {
  console.warn(`[PL-FETCH] fetchPLCookware is deprecated. Use fetchPLFromAccounts + fetchPLCookwareBreakdown.`);
  return [];
}

/**
 * Fetch P&L data for non-product income accounts
 * Services (40300), Shipping (40400), Discounts (40505)
 * Pre-aggregated by account, month, and channel
 */
export async function fetchPLAccounts(
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<NSPLAggregated[]> {
  // Query income accounts directly from transactionaccountingline
  // Only get Services, Shipping, and Discounts (not Cookware/Accessories which come from items)
  const query = `
    SELECT
      TO_CHAR(t.trandate, 'YYYY-MM') as year_month,
      CASE
        WHEN tl.class = 4 THEN 'Web'
        WHEN tl.class = 5 THEN 'Wholesale'
        ELSE 'Other'
      END as channel,
      CASE
        WHEN a.acctnumber LIKE '403%' THEN 'Services'
        WHEN a.acctnumber LIKE '404%' THEN 'Shipping Income'
        WHEN a.acctnumber = '40505' THEN 'Discounts'
        ELSE 'Other'
      END as category,
      SUM(tal.amount) as total
    FROM transactionaccountingline tal
    JOIN transaction t ON tal.transaction = t.id
    JOIN transactionline tl ON tal.transactionline = tl.id AND tal.transaction = tl.transaction
    JOIN account a ON tal.account = a.id
    WHERE t.posting = 'T'
    AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
    AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
    AND a.accttype = 'Income'
    AND (a.acctnumber LIKE '403%' OR a.acctnumber LIKE '404%' OR a.acctnumber = '40505')
    GROUP BY
      TO_CHAR(t.trandate, 'YYYY-MM'),
      CASE
        WHEN tl.class = 4 THEN 'Web'
        WHEN tl.class = 5 THEN 'Wholesale'
        ELSE 'Other'
      END,
      CASE
        WHEN a.acctnumber LIKE '403%' THEN 'Services'
        WHEN a.acctnumber LIKE '404%' THEN 'Shipping Income'
        WHEN a.acctnumber = '40505' THEN 'Discounts'
        ELSE 'Other'
      END
    ORDER BY year_month, channel, category
  `;

  console.log(`[PL-FETCH] Fetching aggregated account data...`);
  const results = await executeSuiteQL<NSPLAggregated>(query);
  console.log(`[PL-FETCH] Got ${results.length} aggregated account rows`);
  return results;
}

/**
 * @deprecated Use fetchPLCookware + fetchPLAccounts instead
 * Fetch P&L data by item for a date range (OLD - inefficient pagination)
 */
export async function fetchPLByItem(
  startDate: string,
  endDate: string
): Promise<NSPLByItem[]> {
  console.warn(`[PL-FETCH] fetchPLByItem is deprecated. Use fetchPLCookware + fetchPLAccounts.`);
  // Return empty - this function shouldn't be used anymore
  return [];
}

/**
 * Fetch P&L data by income account for a date range
 * Returns revenue grouped by month, account, and class (channel)
 */
export async function fetchPLByAccount(
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<NSPLByAccount[]> {
  const query = `
    SELECT
      TO_CHAR(t.trandate, 'YYYY-MM') as year_month,
      tl.class as class_id,
      a.acctnumber as account_number,
      a.accountsearchdisplayname as account_name,
      SUM(tal.amount) as total
    FROM transactionaccountingline tal
    JOIN transaction t ON tal.transaction = t.id
    JOIN transactionline tl ON tal.transactionline = tl.id AND tal.transaction = tl.transaction
    JOIN account a ON tal.account = a.id
    WHERE t.posting = 'T'
    AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
    AND t.trandate <= TO_DATE('${endDate}', 'YYYY-MM-DD')
    AND a.accttype = 'Income'
    GROUP BY TO_CHAR(t.trandate, 'YYYY-MM'), tl.class, a.acctnumber, a.accountsearchdisplayname
  `;

  return executeSuiteQL<NSPLByAccount>(query);
}

// ============================================================================
// Assembly Build Data Types and Functions
// ============================================================================

export interface NSAssemblyBuild {
  trandate: string;      // Date of assembly
  item_sku: string;      // SKU (e.g., Smith-CI-Skil12)
  quantity: string;      // Total quantity built that day
}

/**
 * Fetch Assembly Build transactions from NetSuite
 * Replicates the "Assembled By Day and Item Search" saved search
 * (customsearchsi_assemblies_by_day)
 *
 * Returns daily assembly totals grouped by date and item SKU
 * Paginates through all results (NetSuite limits to 1000 per query)
 *
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format (defaults to today)
 */
export async function fetchAssemblyBuilds(
  startDate: string,
  endDate?: string
): Promise<NSAssemblyBuild[]> {
  const end = endDate || new Date().toISOString().split("T")[0];
  const allResults: NSAssemblyBuild[] = [];
  const BATCH_SIZE = 1000;
  let offset = 0;

  console.log(`[NETSUITE] Fetching assembly builds from ${startDate} to ${end}...`);

  while (true) {
    // Query Assembly Build transactions grouped by date and item
    // This replicates the saved search: customsearchsi_assemblies_by_day
    // - Type: Build (NetSuite internal type for Assembly Builds)
    // - Main Line: true (to get the built item, not components)
    // - Grouped by date and item with SUM of quantity
    const query = `
      SELECT
        TO_CHAR(t.trandate, 'YYYY-MM-DD') as trandate,
        BUILTIN.DF(tl.item) as item_sku,
        SUM(tl.quantity) as quantity
      FROM transaction t
      JOIN transactionline tl ON tl.transaction = t.id
      WHERE t.type = 'Build'
      AND tl.mainline = 'T'
      AND t.trandate >= TO_DATE('${startDate}', 'YYYY-MM-DD')
      AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
      GROUP BY TO_CHAR(t.trandate, 'YYYY-MM-DD'), BUILTIN.DF(tl.item)
      ORDER BY trandate, item_sku
      OFFSET ${offset} ROWS FETCH NEXT ${BATCH_SIZE} ROWS ONLY
    `;

    const results = await executeSuiteQL<NSAssemblyBuild>(query);
    allResults.push(...results);

    console.log(`[NETSUITE] Fetched ${results.length} records (offset=${offset}, total=${allResults.length})`);

    // If we got less than BATCH_SIZE, we've reached the end
    if (results.length < BATCH_SIZE) {
      break;
    }

    offset += BATCH_SIZE;

    // Safety limit - 10,000 records max
    if (allResults.length >= 10000) {
      console.warn(`[NETSUITE] Hit 10,000 record limit, stopping pagination`);
      break;
    }
  }

  console.log(`[NETSUITE] Total assembly build records: ${allResults.length}`);
  return allResults;
}

/**
 * Fetch Assembly Builds for the current year (optimized for production planning)
 * Returns all assembly builds from Jan 1 of the current year to today
 */
export async function fetchAssemblyBuildsYTD(): Promise<NSAssemblyBuild[]> {
  const year = new Date().getFullYear();
  const startDate = `${year}-01-01`;
  return fetchAssemblyBuilds(startDate);
}

/**
 * Fetch Assembly Builds for a specific month
 */
export async function fetchAssemblyBuildsForMonth(
  year: number,
  month: number
): Promise<NSAssemblyBuild[]> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  return fetchAssemblyBuilds(startDate, endDate);
}
