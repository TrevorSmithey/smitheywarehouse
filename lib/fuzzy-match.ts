/**
 * Fuzzy Matching Utility for Company Name Matching
 *
 * Matches Typeform lead company names to NetSuite wholesale accounts.
 * Handles variations like "Trevor's General Store LLC" → "Trevors General Store"
 */

import type { MatchCandidate } from "./types";

// Common business suffixes to strip for matching
const BUSINESS_SUFFIXES = [
  "llc",
  "llp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "pllc",
  "pc",
  "pa",
  "plc",
  "gmbh",
  "ag",
  "sa",
  "nv",
  "bv",
  "pty",
  "pvt",
];

// Common words to optionally strip for better matching
const NOISE_WORDS = ["the", "and", "&", "of", "at"];

/**
 * Normalize a company name for comparison
 * - Lowercase
 * - Remove punctuation and special chars
 * - Strip business suffixes (LLC, Inc, etc.)
 * - Collapse whitespace
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return "";

  let normalized = name.toLowerCase();

  // Remove possessive apostrophes: "Trevor's" → "Trevors"
  normalized = normalized.replace(/['']s\b/g, "s");

  // Remove other apostrophes and quotes
  normalized = normalized.replace(/[''""`]/g, "");

  // Remove punctuation but keep spaces
  normalized = normalized.replace(/[.,!?;:()[\]{}<>@#$%^*+=|\\/_~-]/g, " ");

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, " ").trim();

  // Strip business suffixes
  const words = normalized.split(" ");
  const filteredWords = words.filter(
    (word) => !BUSINESS_SUFFIXES.includes(word)
  );

  return filteredWords.join(" ").trim();
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-100) between two strings
 * Uses Levenshtein distance normalized by max length
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const normalized1 = normalizeCompanyName(str1);
  const normalized2 = normalizeCompanyName(str2);

  if (normalized1 === normalized2) return 100;
  if (!normalized1 || !normalized2) return 0;

  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);

  // Convert distance to similarity percentage
  const similarity = ((maxLength - distance) / maxLength) * 100;

  return Math.round(similarity * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate a more aggressive similarity that ignores noise words
 */
function calculateAggressiveSimilarity(str1: string, str2: string): number {
  let normalized1 = normalizeCompanyName(str1);
  let normalized2 = normalizeCompanyName(str2);

  // Also strip noise words for this comparison
  const stripNoise = (s: string) =>
    s
      .split(" ")
      .filter((w) => !NOISE_WORDS.includes(w))
      .join(" ");

  normalized1 = stripNoise(normalized1);
  normalized2 = stripNoise(normalized2);

  if (normalized1 === normalized2) return 100;
  if (!normalized1 || !normalized2) return 0;

  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);

  return Math.round(((maxLength - distance) / maxLength) * 100 * 100) / 100;
}

/**
 * Check if email domains match
 */
function emailDomainMatch(email1: string | null, email2: string | null): boolean {
  if (!email1 || !email2) return false;

  const getDomain = (email: string) => {
    const match = email.toLowerCase().match(/@([^@]+)$/);
    return match ? match[1] : null;
  };

  const domain1 = getDomain(email1);
  const domain2 = getDomain(email2);

  if (!domain1 || !domain2) return false;

  // Ignore common email providers
  const commonProviders = [
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "aol.com",
    "icloud.com",
    "me.com",
    "mail.com",
    "protonmail.com",
  ];

  if (commonProviders.includes(domain1) || commonProviders.includes(domain2)) {
    return false;
  }

  return domain1 === domain2;
}

export interface CustomerForMatching {
  ns_customer_id: number;
  company_name: string;
  email?: string | null;
}

/**
 * Find best matching customers for a lead
 * Returns top 3 candidates sorted by confidence
 */
export function findBestMatches(
  leadCompanyName: string,
  leadEmail: string | null,
  customers: CustomerForMatching[],
  limit: number = 3
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  for (const customer of customers) {
    const reasons: string[] = [];
    let baseScore = 0;

    // Primary: Company name similarity
    const nameSimilarity = calculateSimilarity(leadCompanyName, customer.company_name);
    const aggressiveSimilarity = calculateAggressiveSimilarity(
      leadCompanyName,
      customer.company_name
    );

    // Use whichever is higher
    const bestNameScore = Math.max(nameSimilarity, aggressiveSimilarity);

    if (bestNameScore >= 50) {
      baseScore = bestNameScore;
      reasons.push(`company_name: ${Math.round(bestNameScore)}%`);
    }

    // Bonus: Email domain match (adds 15 points)
    if (emailDomainMatch(leadEmail, customer.email ?? null)) {
      baseScore += 15;
      reasons.push("email_domain: match");
    }

    // Only include if there's some reasonable match
    if (baseScore >= 50) {
      candidates.push({
        ns_customer_id: customer.ns_customer_id,
        company_name: customer.company_name,
        confidence: Math.min(100, baseScore), // Cap at 100
        match_reasons: reasons,
      });
    }
  }

  // Sort by confidence descending, take top N
  return candidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Determine if the best match should be auto-linked
 * Rules:
 * - Best match confidence >= 85%
 * - Best match is at least 10 points better than second-best
 */
export function shouldAutoMatch(candidates: MatchCandidate[]): boolean {
  if (candidates.length === 0) return false;

  const best = candidates[0];

  // Must have high confidence
  if (best.confidence < 85) return false;

  // If only one candidate, auto-match if >= 85
  if (candidates.length === 1) return true;

  // Must be significantly better than next best
  const secondBest = candidates[1];
  const margin = best.confidence - secondBest.confidence;

  return margin >= 10;
}

/**
 * Get auto-match result for a lead
 * Returns the customer ID if auto-match, null if manual review needed
 */
export function getAutoMatchResult(
  leadCompanyName: string,
  leadEmail: string | null,
  customers: CustomerForMatching[]
): {
  matched_customer_id: number | null;
  match_confidence: number | null;
  match_candidates: MatchCandidate[];
  match_status: "auto_matched" | "pending" | "no_match";
} {
  const candidates = findBestMatches(leadCompanyName, leadEmail, customers);

  if (candidates.length === 0) {
    return {
      matched_customer_id: null,
      match_confidence: null,
      match_candidates: [],
      match_status: "no_match",
    };
  }

  if (shouldAutoMatch(candidates)) {
    return {
      matched_customer_id: candidates[0].ns_customer_id,
      match_confidence: candidates[0].confidence,
      match_candidates: candidates,
      match_status: "auto_matched",
    };
  }

  return {
    matched_customer_id: null,
    match_confidence: candidates[0].confidence,
    match_candidates: candidates,
    match_status: "pending",
  };
}
