/**
 * Analyze Excel file structure
 */
import * as XLSX from "xlsx";

const filePath = process.argv[2] || "/Users/trevorfunderburk/Library/CloudStorage/OneDrive-SharedLibraries-SmitheyIronwareCompany,LLC/Smithey Ironware Team Site - Documents/Reporting/Looker Dashboards/Customer Service Analysis.xlsx";

console.log("Reading:", filePath);
console.log("");

const workbook = XLSX.readFile(filePath);

console.log("=".repeat(60));
console.log("SHEET NAMES:");
console.log("=".repeat(60));
workbook.SheetNames.forEach((name, i) => {
  console.log(`${i + 1}. ${name}`);
});
console.log("");

// Analyze first 2 sheets as requested
for (let i = 0; i < Math.min(2, workbook.SheetNames.length); i++) {
  const sheetName = workbook.SheetNames[i];
  const sheet = workbook.Sheets[sheetName];

  console.log("=".repeat(60));
  console.log(`SHEET ${i + 1}: "${sheetName}"`);
  console.log("=".repeat(60));

  // Get range
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");
  console.log(`Range: ${sheet["!ref"]}`);
  console.log(`Rows: ${range.e.r - range.s.r + 1}`);
  console.log(`Columns: ${range.e.c - range.s.c + 1}`);
  console.log("");

  // Convert to JSON to see structure
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  // Show headers (first row)
  console.log("HEADERS (Row 1):");
  console.log("-".repeat(40));
  if (data[0]) {
    (data[0] as string[]).forEach((header, j) => {
      console.log(`  Col ${j + 1}: ${header || "(empty)"}`);
    });
  }
  console.log("");

  // Show sample rows (rows 2-6)
  console.log("SAMPLE DATA (Rows 2-6):");
  console.log("-".repeat(40));
  for (let r = 1; r <= Math.min(5, data.length - 1); r++) {
    console.log(`\nRow ${r + 1}:`);
    const row = data[r] as unknown[];
    const headers = data[0] as string[];
    if (row) {
      row.forEach((cell, j) => {
        const header = headers[j] || `Col ${j + 1}`;
        const value = cell !== undefined && cell !== null ? String(cell).substring(0, 100) : "(empty)";
        console.log(`  ${header}: ${value}`);
      });
    }
  }
  console.log("");

  // Show last few rows
  console.log("LAST 3 ROWS:");
  console.log("-".repeat(40));
  const lastRows = data.slice(-3);
  lastRows.forEach((row, idx) => {
    const actualRowNum = data.length - 3 + idx + 1;
    console.log(`\nRow ${actualRowNum}:`);
    const headers = data[0] as string[];
    if (row) {
      (row as unknown[]).forEach((cell, j) => {
        const header = headers[j] || `Col ${j + 1}`;
        const value = cell !== undefined && cell !== null ? String(cell).substring(0, 100) : "(empty)";
        console.log(`  ${header}: ${value}`);
      });
    }
  });
  console.log("");
}
