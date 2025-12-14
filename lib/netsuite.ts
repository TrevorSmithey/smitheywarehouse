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

      console.error(`[NETSUITE] ${errorType} error (attempt ${attempt + 1}/${retries}): ${errorMessage}`);

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
 */
export async function fetchWholesaleTransactions(
  offset = 0,
  limit = 1000
): Promise<NSTransaction[]> {
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
    ORDER BY t.id
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  return executeSuiteQL<NSTransaction>(query);
}

/**
 * Fetch wholesale line items
 */
export async function fetchWholesaleLineItems(
  offset = 0,
  limit = 1000
): Promise<NSLineItem[]> {
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
    ORDER BY t.id, tl.linesequencenumber
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  return executeSuiteQL<NSLineItem>(query);
}

/**
 * Fetch wholesale customers (business entities)
 * Uses optimized field list for performance
 */
export async function fetchWholesaleCustomers(
  offset = 0,
  limit = 1000
): Promise<NSCustomer[]> {
  // Core fields needed for sync - optimized for performance
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
      BUILTIN.DF(c.terms) as terms,
      BUILTIN.DF(c.category) as category,
      BUILTIN.DF(c.entitystatus) as entitystatus,
      BUILTIN.DF(c.salesrep) as salesrep,
      BUILTIN.DF(c.territory) as territory,
      BUILTIN.DF(c.currency) as currency,
      c.creditlimit,
      c.balance,
      c.overduebalance,
      c.consolbalance,
      c.unbilledorders,
      c.depositbalance,
      c.billaddress,
      c.shipaddress,
      c.defaultbillingaddress,
      c.defaultshippingaddress
    FROM customer c
    WHERE c.isperson = 'F'
    AND c.id NOT IN (493, 2501)
    ORDER BY c.id
    OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
  `;

  return executeSuiteQL<NSCustomer>(query);
}
