/**
 * Debug P&L - Check account-level totals by channel
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/server";
import { executeSuiteQL } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Auth check - requires admin session
  const { error: authError } = await requireAdmin(request);
  if (authError) return authError;

  try {
    // Query income accounts by class (channel) for June 2025
    // This is how Fathom gets its data
    const accountByClassQuery = `
      SELECT
        a.acctnumber,
        a.accountsearchdisplayname as account_name,
        tl.class as class_id,
        SUM(tal.amount) as total
      FROM transactionaccountingline tal
      JOIN transaction t ON tal.transaction = t.id
      JOIN account a ON tal.account = a.id
      LEFT JOIN transactionline tl ON tal.transactionline = tl.id AND tal.transaction = tl.transaction
      WHERE t.posting = 'T'
      AND t.trandate >= TO_DATE('2025-06-01', 'YYYY-MM-DD')
      AND t.trandate <= TO_DATE('2025-06-30', 'YYYY-MM-DD')
      AND a.accttype = 'Income'
      GROUP BY a.acctnumber, a.accountsearchdisplayname, tl.class
      ORDER BY a.acctnumber, tl.class
    `;

    const accountsByClass = await executeSuiteQL<{
      acctnumber: string;
      account_name: string;
      class_id: string;
      total: string;
    }>(accountByClassQuery);

    // Check for sub-accounts or departments that might give Cast Iron vs Carbon Steel
    const itemCategoryQuery = `
      SELECT
        CASE
          WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CI-%' THEN 'Cast Iron'
          WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CS-%' THEN 'Carbon Steel'
          WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%GLID%' THEN 'Glass Lids'
          ELSE 'Other Cookware'
        END as category,
        tl.class as class_id,
        SUM(tal.amount) as total
      FROM transactionaccountingline tal
      JOIN transaction t ON tal.transaction = t.id
      JOIN account a ON tal.account = a.id
      JOIN transactionline tl ON tal.transactionline = tl.id AND tal.transaction = tl.transaction
      WHERE t.posting = 'T'
      AND t.trandate >= TO_DATE('2025-06-01', 'YYYY-MM-DD')
      AND t.trandate <= TO_DATE('2025-06-30', 'YYYY-MM-DD')
      AND a.acctnumber = '40200'
      GROUP BY
        CASE
          WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CI-%' THEN 'Cast Iron'
          WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%CS-%' THEN 'Carbon Steel'
          WHEN UPPER(BUILTIN.DF(tl.item)) LIKE '%GLID%' THEN 'Glass Lids'
          ELSE 'Other Cookware'
        END,
        tl.class
      ORDER BY category, tl.class
    `;

    const cookwareBreakdown = await executeSuiteQL<{
      category: string;
      class_id: string;
      total: string;
    }>(itemCategoryQuery);

    return NextResponse.json({
      june2025: {
        byAccountAndClass: accountsByClass.map(a => ({
          account: a.acctnumber,
          name: a.account_name,
          classId: a.class_id,
          channel: a.class_id === "4" ? "Web" : a.class_id === "5" ? "Wholesale" : "Other",
          amount: Math.abs(parseFloat(a.total) || 0)
        })),
        cookwareBreakdown: cookwareBreakdown.map(c => ({
          category: c.category,
          classId: c.class_id,
          channel: c.class_id === "4" ? "Web" : c.class_id === "5" ? "Wholesale" : "Other",
          amount: Math.abs(parseFloat(c.total) || 0)
        }))
      }
    });
  } catch (error) {
    console.error("Debug query failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
