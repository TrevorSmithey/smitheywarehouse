/**
 * Setup budgets table in Supabase and migrate data from JSON
 *
 * Schema design:
 * - Normalized: one row per SKU per month (not wide table with 12 month columns)
 * - Easier to query date ranges, more flexible, standard relational design
 *
 * Run: npx tsx scripts/setup-budgets-table.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

// Budget data from JSON file
const budgetData: Record<string, Record<string, Record<string, number>>> = {
  "2025": {
    "Smith-AC-Scrub1": { "Jan": 2009, "Feb": 1771, "Mar": 1594, "Apr": 1618, "May": 1718, "Jun": 1528, "Jul": 1388, "Aug": 1557, "Sep": 1909, "Oct": 2323, "Nov": 14859, "Dec": 8782 },
    "Smith-AC-FGph": { "Jan": 318, "Feb": 279, "Mar": 246, "Apr": 249, "May": 264, "Jun": 234, "Jul": 213, "Aug": 240, "Sep": 295, "Oct": 322, "Nov": 987, "Dec": 1288 },
    "Smith-AC-Sleeve1": { "Jan": 1126, "Feb": 991, "Mar": 873, "Apr": 887, "May": 942, "Jun": 838, "Jul": 761, "Aug": 853, "Sep": 1046, "Oct": 1259, "Nov": 3744, "Dec": 4810 },
    "Smith-AC-Sleeve2": { "Jan": 808, "Feb": 712, "Mar": 645, "Apr": 653, "May": 693, "Jun": 616, "Jul": 560, "Aug": 629, "Sep": 772, "Oct": 895, "Nov": 2691, "Dec": 3476 },
    "Smith-AC-SpatW1": { "Jan": 780, "Feb": 683, "Mar": 623, "Apr": 622, "May": 657, "Jun": 581, "Jul": 532, "Aug": 601, "Sep": 743, "Oct": 840, "Nov": 10442, "Dec": 3103 },
    "Smith-AC-SpatB1": { "Jan": 1183, "Feb": 1050, "Mar": 967, "Apr": 980, "May": 1040, "Jun": 924, "Jul": 840, "Aug": 944, "Sep": 1158, "Oct": 1343, "Nov": 4037, "Dec": 5214 },
    "Smith-AC-PHTLg": { "Jan": 145, "Feb": 125, "Mar": 141, "Apr": 140, "May": 148, "Jun": 130, "Jul": 120, "Aug": 135, "Sep": 168, "Oct": 182, "Nov": 526, "Dec": 667 },
    "Smith-AC-KeeperW": { "Jan": 159, "Feb": 140, "Mar": 116, "Apr": 116, "May": 123, "Jun": 109, "Jul": 100, "Aug": 112, "Sep": 138, "Oct": 174, "Nov": 497, "Dec": 627 },
    "Smith-AC-Season": { "Jan": 1800, "Feb": 1599, "Mar": 1452, "Apr": 1509, "May": 1614, "Jun": 1446, "Jul": 1299, "Aug": 1445, "Sep": 1751, "Oct": 2266, "Nov": 6934, "Dec": 9032 },
    "Smith-AC-CareKit": { "Jan": 398, "Feb": 357, "Mar": 308, "Apr": 327, "May": 352, "Jun": 317, "Jul": 282, "Aug": 311, "Sep": 373, "Oct": 602, "Nov": 1747, "Dec": 2219 },
    "Smith-Bottle1": { "Jan": 0, "Feb": 0, "Mar": 0, "Apr": 0, "May": 0, "Jun": 74, "Jul": 67, "Aug": 75, "Sep": 91, "Oct": 84, "Nov": 293, "Dec": 404 },
    "Smith-CS-Farm12": { "Jan": 323, "Feb": 288, "Mar": 316, "Apr": 275, "May": 280, "Jun": 252, "Jul": 233, "Aug": 258, "Sep": 321, "Oct": 434, "Nov": 1179, "Dec": 1443 },
    "Smith-CS-Deep12": { "Jan": 359, "Feb": 330, "Mar": 403, "Apr": 356, "May": 363, "Jun": 325, "Jul": 302, "Aug": 335, "Sep": 418, "Oct": 462, "Nov": 1336, "Dec": 1693 },
    "Smith-CS-RRoastM": { "Jan": 129, "Feb": 119, "Mar": 139, "Apr": 94, "May": 95, "Jun": 84, "Jul": 79, "Aug": 90, "Sep": 114, "Oct": 119, "Nov": 309, "Dec": 368 },
    "Smith-CS-OvalM": { "Jan": 157, "Feb": 153, "Mar": 125, "Apr": 96, "May": 97, "Jun": 86, "Jul": 81, "Aug": 91, "Sep": 116, "Oct": 154, "Nov": 366, "Dec": 414 },
    "Smith-CS-WokM": { "Jan": 239, "Feb": 220, "Mar": 255, "Apr": 208, "May": 211, "Jun": 188, "Jul": 176, "Aug": 196, "Sep": 245, "Oct": 281, "Nov": 733, "Dec": 879 },
    "Smith-CS-Round17N": { "Jan": 105, "Feb": 88, "Mar": 55, "Apr": 50, "May": 50, "Jun": 44, "Jul": 42, "Aug": 48, "Sep": 61, "Oct": 89, "Nov": 218, "Dec": 251 },
    "Smith-CS-Farm9": { "Jan": 353, "Feb": 281, "Mar": 446, "Apr": 311, "May": 317, "Jun": 285, "Jul": 264, "Aug": 291, "Sep": 362, "Oct": 367, "Nov": 1051, "Dec": 1325 },
    "Smith-CS-Fish": { "Jan": 0, "Feb": 0, "Mar": 0, "Apr": 0, "May": 0, "Jun": 0, "Jul": 0, "Aug": 0, "Sep": 0, "Oct": 165, "Nov": 474, "Dec": 613 },
    "Smith-CI-Skil8": { "Jan": 972, "Feb": 868, "Mar": 912, "Apr": 698, "May": 712, "Jun": 642, "Jul": 592, "Aug": 652, "Sep": 808, "Oct": 1006, "Nov": 2862, "Dec": 3594 },
    "Smith-CI-Chef10": { "Jan": 708, "Feb": 626, "Mar": 624, "Apr": 510, "May": 519, "Jun": 463, "Jul": 431, "Aug": 481, "Sep": 603, "Oct": 828, "Nov": 7195, "Dec": 2651 },
    "Smith-CI-Flat10": { "Jan": 265, "Feb": 236, "Mar": 299, "Apr": 182, "May": 186, "Jun": 167, "Jul": 154, "Aug": 170, "Sep": 212, "Oct": 268, "Nov": 806, "Dec": 1041 },
    "Smith-CI-Flat12": { "Jan": 737, "Feb": 657, "Mar": 865, "Apr": 516, "May": 527, "Jun": 475, "Jul": 438, "Aug": 481, "Sep": 596, "Oct": 817, "Nov": 2242, "Dec": 2763 },
    "Smith-CI-Skil6": { "Jan": 561, "Feb": 496, "Mar": 659, "Apr": 384, "May": 391, "Jun": 350, "Jul": 325, "Aug": 361, "Sep": 451, "Oct": 428, "Nov": 1144, "Dec": 1390 },
    "Smith-CI-Skil10": { "Jan": 1121, "Feb": 1991, "Mar": 1096, "Apr": 828, "May": 843, "Jun": 751, "Jul": 700, "Aug": 782, "Sep": 981, "Oct": 1567, "Nov": 4121, "Dec": 4955 },
    "Smith-CI-Skil12": { "Jan": 2064, "Feb": 1835, "Mar": 1827, "Apr": 1497, "May": 1525, "Jun": 1368, "Jul": 1267, "Aug": 1404, "Sep": 1749, "Oct": 2462, "Nov": 6679, "Dec": 8178 },
    "Smith-CI-TradSkil14": { "Jan": 383, "Feb": 343, "Mar": 407, "Apr": 290, "May": 296, "Jun": 267, "Jul": 246, "Aug": 271, "Sep": 335, "Oct": 469, "Nov": 1379, "Dec": 1760 },
    "Smith-CI-Skil14": { "Jan": 472, "Feb": 417, "Mar": 592, "Apr": 370, "May": 376, "Jun": 334, "Jul": 313, "Aug": 351, "Sep": 442, "Oct": 672, "Nov": 1692, "Dec": 1981 },
    "Smith-CI-DSkil11": { "Jan": 679, "Feb": 599, "Mar": 846, "Apr": 458, "May": 466, "Jun": 417, "Jul": 388, "Aug": 431, "Sep": 539, "Oct": 672, "Nov": 1692, "Dec": 1981 },
    "Smith-CI-Grill12": { "Jan": 177, "Feb": 157, "Mar": 159, "Apr": 128, "May": 130, "Jun": 117, "Jul": 108, "Aug": 120, "Sep": 150, "Oct": 314, "Nov": 746, "Dec": 842 },
    "Smith-CI-Dutch4": { "Jan": 177, "Feb": 157, "Mar": 191, "Apr": 138, "May": 140, "Jun": 125, "Jul": 117, "Aug": 130, "Sep": 164, "Oct": 224, "Nov": 607, "Dec": 743 },
    "Smith-CI-Dutch5": { "Jan": 324, "Feb": 289, "Mar": 369, "Apr": 256, "May": 261, "Jun": 234, "Jul": 217, "Aug": 241, "Sep": 300, "Oct": 392, "Nov": 1063, "Dec": 1301 },
    "Smith-CI-Dutch7": { "Jan": 324, "Feb": 289, "Mar": 346, "Apr": 236, "May": 241, "Jun": 217, "Jul": 200, "Aug": 221, "Sep": 274, "Oct": 313, "Nov": 876, "Dec": 1091 },
    "Smith-CI-Dual6": { "Jan": 701, "Feb": 496, "Mar": 161, "Apr": 148, "May": 150, "Jun": 133, "Jul": 125, "Aug": 140, "Sep": 177, "Oct": 224, "Nov": 607, "Dec": 743 },
    "Smith-CI-Griddle18": { "Jan": 0, "Feb": 0, "Mar": 0, "Apr": 0, "May": 700, "Jun": 675, "Jul": 575, "Aug": 401, "Sep": 491, "Oct": 872, "Nov": 2523, "Dec": 3198 },
    "Smith-CI-Dual12": { "Jan": 0, "Feb": 0, "Mar": 80, "Apr": 820, "May": 620, "Jun": 400, "Jul": 325, "Aug": 361, "Sep": 451, "Oct": 347, "Nov": 993, "Dec": 1252 },
    "Smith-CI-Sauce1": { "Jan": 0, "Feb": 0, "Mar": 0, "Apr": 0, "May": 0, "Jun": 0, "Jul": 0, "Aug": 40, "Sep": 75, "Oct": 0, "Nov": 0, "Dec": 0 },
    "Smith-AC-Glid10": { "Jan": 450, "Feb": 402, "Mar": 357, "Apr": 334, "May": 340, "Jun": 306, "Jul": 283, "Aug": 312, "Sep": 388, "Oct": 644, "Nov": 1844, "Dec": 2325 },
    "Smith-AC-Glid12": { "Jan": 966, "Feb": 863, "Mar": 709, "Apr": 1013, "May": 927, "Jun": 762, "Jul": 675, "Aug": 736, "Sep": 905, "Oct": 1294, "Nov": 3665, "Dec": 4594 },
    "Smith-AC-Glid14": { "Jan": 215, "Feb": 353, "Mar": 370, "Apr": 347, "May": 354, "Jun": 319, "Jul": 294, "Aug": 324, "Sep": 402, "Oct": 595, "Nov": 1638, "Dec": 2022 },
    "Smith-AC-CSlid12": { "Jan": 0, "Feb": 0, "Mar": 0, "Apr": 0, "May": 0, "Jun": 0, "Jul": 0, "Aug": 0, "Sep": 0, "Oct": 0, "Nov": 0, "Dec": 0 }
  },
  "2026": {
    "Smith-AC-Scrub1": { "Jan": 2894, "Feb": 2354, "Mar": 2129, "Apr": 1912, "May": 2419, "Jun": 2092, "Jul": 1866, "Aug": 1953, "Sep": 2214, "Oct": 2945, "Nov": 8972, "Dec": 11696 },
    "Smith-AC-FGph": { "Jan": 412, "Feb": 334, "Mar": 302, "Apr": 272, "May": 348, "Jun": 302, "Jul": 268, "Aug": 278, "Sep": 313, "Oct": 415, "Nov": 1304, "Dec": 1725 },
    "Smith-AC-Sleeve1": { "Jan": 1577, "Feb": 1281, "Mar": 1159, "Apr": 1041, "May": 1321, "Jun": 1142, "Jul": 1018, "Aug": 1064, "Sep": 1204, "Oct": 1602, "Nov": 4906, "Dec": 6413 },
    "Smith-AC-Sleeve2": { "Jan": 1130, "Feb": 917, "Mar": 830, "Apr": 746, "May": 949, "Jun": 821, "Jul": 731, "Aug": 763, "Sep": 861, "Oct": 1144, "Nov": 3536, "Dec": 4641 },
    "Smith-AC-SpatW1": { "Jan": 1035, "Feb": 843, "Mar": 762, "Apr": 684, "May": 861, "Jun": 744, "Jul": 665, "Aug": 698, "Sep": 794, "Oct": 1058, "Nov": 3181, "Dec": 4123 },
    "Smith-AC-SpatB1": { "Jan": 1695, "Feb": 1376, "Mar": 1245, "Apr": 1119, "May": 1424, "Jun": 1232, "Jul": 1097, "Aug": 1144, "Sep": 1291, "Oct": 1717, "Nov": 5305, "Dec": 6962 },
    "Smith-AC-PHTLg": { "Jan": 223, "Feb": 182, "Mar": 165, "Apr": 148, "May": 186, "Jun": 160, "Jul": 143, "Aug": 151, "Sep": 172, "Oct": 229, "Nov": 685, "Dec": 886 },
    "Smith-AC-KeeperW": { "Jan": 212, "Feb": 173, "Mar": 156, "Apr": 140, "May": 175, "Jun": 151, "Jul": 136, "Aug": 143, "Sep": 163, "Oct": 217, "Nov": 645, "Dec": 831 },
    "Smith-AC-Season": { "Jan": 2897, "Feb": 2346, "Mar": 2125, "Apr": 1913, "May": 2446, "Jun": 2118, "Jul": 1881, "Aug": 1957, "Sep": 2198, "Oct": 2919, "Nov": 9152, "Dec": 12091 },
    "Smith-AC-CareKit": { "Jan": 741, "Feb": 604, "Mar": 546, "Apr": 489, "May": 616, "Jun": 533, "Jul": 476, "Aug": 500, "Sep": 569, "Oct": 758, "Nov": 2276, "Dec": 2947 },
    "Smith-Bottle1": { "Jan": 118, "Feb": 94, "Mar": 86, "Apr": 78, "May": 103, "Jun": 90, "Jul": 79, "Aug": 80, "Sep": 87, "Oct": 115, "Nov": 398, "Dec": 549 },
    "Smith-CS-Farm12": { "Jan": 510, "Feb": 419, "Mar": 378, "Apr": 337, "May": 416, "Jun": 358, "Jul": 323, "Aug": 342, "Sep": 395, "Oct": 528, "Nov": 1496, "Dec": 1881 },
    "Smith-CS-Deep12": { "Jan": 567, "Feb": 462, "Mar": 418, "Apr": 375, "May": 471, "Jun": 407, "Jul": 364, "Aug": 380, "Sep": 433, "Oct": 577, "Nov": 1726, "Dec": 2231 },
    "Smith-CS-RRoastM": { "Jan": 136, "Feb": 112, "Mar": 101, "Apr": 90, "May": 109, "Jun": 94, "Jul": 85, "Aug": 91, "Sep": 106, "Oct": 142, "Nov": 387, "Dec": 476 },
    "Smith-CS-OvalM": { "Jan": 165, "Feb": 138, "Mar": 123, "Apr": 109, "May": 129, "Jun": 111, "Jul": 102, "Aug": 110, "Sep": 132, "Oct": 177, "Nov": 447, "Dec": 526 },
    "Smith-CS-WokM": { "Jan": 321, "Feb": 265, "Mar": 238, "Apr": 212, "May": 259, "Jun": 223, "Jul": 202, "Aug": 215, "Sep": 251, "Oct": 336, "Nov": 921, "Dec": 1138 },
    "Smith-CS-Round17N": { "Jan": 97, "Feb": 81, "Mar": 73, "Apr": 64, "May": 77, "Jun": 66, "Jul": 60, "Aug": 65, "Sep": 77, "Oct": 104, "Nov": 269, "Dec": 321 },
    "Smith-CS-Farm9": { "Jan": 448, "Feb": 365, "Mar": 330, "Apr": 296, "May": 371, "Jun": 320, "Jul": 287, "Aug": 300, "Sep": 343, "Oct": 457, "Nov": 1355, "Dec": 1744 },
    "Smith-CS-Fish": { "Jan": 199, "Feb": 162, "Mar": 146, "Apr": 132, "May": 167, "Jun": 145, "Jul": 129, "Aug": 134, "Sep": 151, "Oct": 200, "Nov": 619, "Dec": 812 },
    "Smith-CI-Skil8": { "Jan": 1221, "Feb": 998, "Mar": 901, "Apr": 807, "May": 1010, "Jun": 872, "Jul": 781, "Aug": 818, "Sep": 936, "Oct": 1248, "Nov": 3681, "Dec": 4723 },
    "Smith-CI-Chef10": { "Jan": 956, "Feb": 789, "Mar": 709, "Apr": 632, "May": 774, "Jun": 666, "Jul": 603, "Aug": 640, "Sep": 745, "Oct": 998, "Nov": 2768, "Dec": 3441 },
    "Smith-CI-Flat10": { "Jan": 339, "Feb": 275, "Mar": 249, "Apr": 224, "May": 284, "Jun": 246, "Jul": 219, "Aug": 227, "Sep": 256, "Oct": 341, "Nov": 1052, "Dec": 1380 },
    "Smith-CI-Flat12": { "Jan": 966, "Feb": 793, "Mar": 715, "Apr": 639, "May": 791, "Jun": 682, "Jul": 614, "Aug": 648, "Sep": 747, "Oct": 998, "Nov": 2856, "Dec": 3610 },
    "Smith-CI-Skil6": { "Jan": 497, "Feb": 409, "Mar": 368, "Apr": 329, "May": 404, "Jun": 348, "Jul": 314, "Aug": 333, "Sep": 387, "Oct": 517, "Nov": 1447, "Dec": 1808 },
    "Smith-CI-Skil10": { "Jan": 1799, "Feb": 1486, "Mar": 1336, "Apr": 1190, "May": 1454, "Jun": 1251, "Jul": 1133, "Aug": 1205, "Sep": 1405, "Oct": 1882, "Nov": 5185, "Dec": 6423 },
    "Smith-CI-Skil12": { "Jan": 2888, "Feb": 2375, "Mar": 2139, "Apr": 1910, "May": 2356, "Jun": 2030, "Jul": 1832, "Aug": 1936, "Sep": 2240, "Oct": 2994, "Nov": 8480, "Dec": 10661 },
    "Smith-CI-TradSkil14": { "Jan": 583, "Feb": 474, "Mar": 429, "Apr": 385, "May": 486, "Jun": 420, "Jul": 375, "Aug": 391, "Sep": 443, "Oct": 590, "Nov": 1788, "Dec": 2325 },
    "Smith-CI-Skil14": { "Jan": 749, "Feb": 622, "Mar": 558, "Apr": 496, "May": 597, "Jun": 513, "Jul": 467, "Aug": 501, "Sep": 591, "Oct": 793, "Nov": 2101, "Dec": 2546 },
    "Smith-CI-DSkil11": { "Jan": 749, "Feb": 622, "Mar": 558, "Apr": 496, "May": 597, "Jun": 513, "Jul": 467, "Aug": 501, "Sep": 591, "Oct": 793, "Nov": 2101, "Dec": 2546 },
    "Smith-CI-Grill12": { "Jan": 336, "Feb": 281, "Mar": 252, "Apr": 223, "May": 263, "Jun": 226, "Jul": 207, "Aug": 225, "Sep": 269, "Oct": 362, "Nov": 910, "Dec": 1068 },
    "Smith-CI-Dutch4": { "Jan": 263, "Feb": 216, "Mar": 194, "Apr": 174, "May": 214, "Jun": 185, "Jul": 167, "Aug": 176, "Sep": 204, "Oct": 272, "Nov": 771, "Dec": 969 },
    "Smith-CI-Dutch5": { "Jan": 460, "Feb": 378, "Mar": 340, "Apr": 304, "May": 375, "Jun": 323, "Jul": 291, "Aug": 308, "Sep": 356, "Oct": 476, "Nov": 1349, "Dec": 1696 },
    "Smith-CI-Dutch7": { "Jan": 375, "Feb": 308, "Mar": 277, "Apr": 248, "May": 309, "Jun": 267, "Jul": 240, "Aug": 252, "Sep": 289, "Oct": 386, "Nov": 1122, "Dec": 1429 },
    "Smith-CI-Dual6": { "Jan": 263, "Feb": 216, "Mar": 194, "Apr": 174, "May": 214, "Jun": 185, "Jul": 167, "Aug": 176, "Sep": 204, "Oct": 272, "Nov": 771, "Dec": 969 },
    "Smith-CI-Griddle18": { "Jan": 1071, "Feb": 873, "Mar": 789, "Apr": 708, "May": 890, "Jun": 769, "Jul": 688, "Aug": 718, "Sep": 818, "Oct": 1090, "Nov": 3260, "Dec": 4214 },
    "Smith-CI-Dual12": { "Jan": 423, "Feb": 345, "Mar": 312, "Apr": 279, "May": 350, "Jun": 303, "Jul": 271, "Aug": 283, "Sep": 324, "Oct": 431, "Nov": 1279, "Dec": 1647 },
    "Smith-CI-Sauce1": { "Jan": 0, "Feb": 0, "Mar": 0, "Apr": 0, "May": 0, "Jun": 0, "Jul": 0, "Aug": 63, "Sep": 69, "Oct": 91, "Nov": 316, "Dec": 435 },
    "Smith-AC-Glid10": { "Jan": 785, "Feb": 641, "Mar": 579, "Apr": 519, "May": 651, "Jun": 562, "Jul": 503, "Aug": 526, "Sep": 601, "Oct": 801, "Nov": 2377, "Dec": 3059 },
    "Smith-AC-Glid12": { "Jan": 1565, "Feb": 1280, "Mar": 1155, "Apr": 1034, "May": 1293, "Jun": 1116, "Jul": 1001, "Aug": 1049, "Sep": 1201, "Oct": 1602, "Nov": 4709, "Dec": 6034 },
    "Smith-AC-Glid14": { "Jan": 705, "Feb": 579, "Mar": 522, "Apr": 466, "May": 578, "Jun": 498, "Jul": 448, "Aug": 473, "Sep": 545, "Oct": 728, "Nov": 2088, "Dec": 2643 },
    "Smith-AC-CSlid12": { "Jan": 0, "Feb": 0, "Mar": 314, "Apr": 304, "May": 188, "Jun": 103, "Jul": 90, "Aug": 91, "Sep": 99, "Oct": 130, "Nov": 451, "Dec": 622 }
  }
};

const MONTH_MAP: Record<string, number> = {
  "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
  "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
};

async function createTable() {
  console.log("Creating budgets table...");

  // Create table using raw SQL via RPC (if you have a function) or manually in Supabase UI
  // For now, we'll check if table exists and create rows

  // First, let's check if the table exists by trying to query it
  const { error: checkError } = await supabase
    .from("budgets")
    .select("id")
    .limit(1);

  if (checkError && checkError.code === "42P01") {
    console.log("Table doesn't exist. Please create it in Supabase SQL editor:");
    console.log(`
CREATE TABLE budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sku TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  budget INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sku, year, month)
);

-- Indexes for fast lookups
CREATE INDEX idx_budgets_sku_year_month ON budgets(sku, year, month);
CREATE INDEX idx_budgets_year_month ON budgets(year, month);

-- Enable RLS
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

-- Allow read access
CREATE POLICY "Allow read access" ON budgets FOR SELECT USING (true);
`);
    return false;
  }

  console.log("Table exists!");
  return true;
}

async function migrateData() {
  console.log("Migrating budget data to Supabase...");

  const rows: { sku: string; year: number; month: number; budget: number }[] = [];

  for (const [year, skuData] of Object.entries(budgetData)) {
    for (const [sku, monthData] of Object.entries(skuData)) {
      for (const [monthName, budget] of Object.entries(monthData)) {
        rows.push({
          sku,
          year: parseInt(year),
          month: MONTH_MAP[monthName],
          budget
        });
      }
    }
  }

  console.log(`Prepared ${rows.length} budget rows for insertion`);

  // Delete existing data first (clean migration)
  const { error: deleteError } = await supabase
    .from("budgets")
    .delete()
    .gte("year", 2025);

  if (deleteError) {
    console.error("Error deleting existing data:", deleteError);
    return;
  }

  // Insert in batches of 500
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error: insertError } = await supabase
      .from("budgets")
      .insert(batch);

    if (insertError) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
      return;
    }
    console.log(`Inserted batch ${i / batchSize + 1} (${batch.length} rows)`);
  }

  console.log("Migration complete!");

  // Verify
  const { count } = await supabase
    .from("budgets")
    .select("*", { count: "exact", head: true });

  console.log(`Total rows in budgets table: ${count}`);
}

async function main() {
  const tableExists = await createTable();
  if (tableExists) {
    await migrateData();
  }
}

main().catch(console.error);
