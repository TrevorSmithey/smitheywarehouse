/**
 * Debug endpoint for testing Assembly Build queries
 */

import { NextResponse } from "next/server";
import { executeSuiteQL, hasNetSuiteCredentials } from "@/lib/netsuite";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasNetSuiteCredentials()) {
    return NextResponse.json({ error: "Missing NetSuite credentials" }, { status: 500 });
  }

  const url = new URL(request.url);
  const queryType = url.searchParams.get("q") || "types";

  try {
    if (queryType === "types") {
      // Simple query: list distinct transaction types
      const query = `
        SELECT DISTINCT type
        FROM transaction
        WHERE trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
      `;
      const results = await executeSuiteQL<{ type: string }>(query);
      return NextResponse.json({ success: true, queryType, results });
    }

    if (queryType === "assembly") {
      // Test Assembly Build query
      const query = `
        SELECT t.id, t.type, t.trandate
        FROM transaction t
        WHERE t.type = 'AssyBld'
        AND t.trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
        FETCH FIRST 5 ROWS ONLY
      `;
      const results = await executeSuiteQL(query);
      return NextResponse.json({ success: true, queryType, results });
    }

    if (queryType === "build") {
      // Test Build transaction type
      const query = `
        SELECT t.id, t.type, t.trandate
        FROM transaction t
        WHERE t.type = 'Build'
        AND t.trandate >= TO_DATE('2025-12-01', 'YYYY-MM-DD')
        FETCH FIRST 5 ROWS ONLY
      `;
      const results = await executeSuiteQL(query);
      return NextResponse.json({ success: true, queryType, results });
    }

    if (queryType === "search") {
      // Try to list saved searches
      const query = `
        SELECT id, title
        FROM savedsearch
        WHERE title LIKE '%assembl%'
        FETCH FIRST 10 ROWS ONLY
      `;
      const results = await executeSuiteQL(query);
      return NextResponse.json({ success: true, queryType, results });
    }

    return NextResponse.json({ error: "Unknown query type. Use ?q=types|assembly|build|search" }, { status: 400 });
  } catch (error) {
    console.error("[DEBUG] Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
