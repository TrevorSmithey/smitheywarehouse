/**
 * Corporate Detection Heuristics
 *
 * These functions help identify B2B customers who may actually be corporate gifting
 * accounts that were misclassified. The PRIMARY signal is `customer.taxable = true`
 * from NetSuite (meaning they don't have a resale certificate). Secondary signals
 * include company name patterns and order characteristics.
 *
 * Use case: Ongoing audit workflow in the Wholesale Dashboard to flag potential
 * misclassifications for manual review.
 */

export interface CorporateSignals {
  /** PRIMARY: Customer is taxable (no resale certificate) - 95% accurate */
  isTaxable: boolean;
  /** Company name matches corporate patterns (Inc, LLC, Corp, etc.) */
  hasCompanyNamePattern: boolean;
  /** Overall confidence level based on combined signals */
  confidence: "high" | "medium" | "low" | "none";
  /** Human-readable reasons for the classification */
  reasons: string[];
}

/**
 * Patterns that suggest a corporate entity vs. individual consumer.
 * These are secondary signals - taxable status is the primary indicator.
 */
const CORPORATE_NAME_PATTERNS = [
  // Legal entity suffixes
  /\b(inc|incorporated|llc|l\.l\.c|corp|corporation|ltd|limited|co|company)\b/i,
  // Professional services
  /\b(associates|group|partners|enterprises|holdings|ventures)\b/i,
  // Business types often doing corporate gifting
  /\b(consulting|solutions|services|agency|firm|studio|advisors)\b/i,
  // Real estate & construction (common corporate gifting for clients)
  /\b(realty|properties|construction|builders|development|investments)\b/i,
  // Financial services
  /\b(capital|financial|wealth|insurance|mortgage)\b/i,
];

/**
 * Patterns that suggest individual/consumer, NOT corporate.
 * If these match, reduce confidence in corporate classification.
 */
const CONSUMER_NAME_PATTERNS = [
  // Personal names with possessive or family indicators
  /\b(family|household|home|residence)\b/i,
  // Obvious individual patterns
  /^(mr|mrs|ms|dr|miss)\s/i,
];

/**
 * Detect signals that a customer may be corporate gifting rather than true B2B wholesale.
 *
 * @param customer - Must have at least: taxable, company_name, is_corporate_gifting
 * @returns CorporateSignals with confidence and reasons
 *
 * @example
 * ```typescript
 * const signals = detectCorporateSignals(customer);
 * if (signals.confidence === 'high' && !customer.is_corporate_gifting) {
 *   // Show "Likely Corp" badge for manual review
 * }
 * ```
 */
export function detectCorporateSignals(customer: {
  taxable?: boolean | null;
  company_name?: string | null;
  is_corporate_gifting?: boolean | null;
}): CorporateSignals {
  const signals: CorporateSignals = {
    isTaxable: false,
    hasCompanyNamePattern: false,
    confidence: "none",
    reasons: [],
  };

  // Skip if already classified as corporate - no need to flag
  if (customer.is_corporate_gifting === true) {
    return signals;
  }

  // ========================================
  // PRIMARY SIGNAL: Taxable status (95% accurate)
  // ========================================
  // In NetSuite, `taxable = true` means the customer does NOT have a resale
  // certificate on file. True wholesale customers are tax-exempt (taxable = false)
  // because they resell the goods.
  //
  // If someone is buying at wholesale pricing but is taxable, they're likely
  // corporate gifting (buying for end-use, not resale).

  if (customer.taxable === true) {
    signals.isTaxable = true;
    signals.reasons.push("Not tax-exempt (no resale certificate)");
    signals.confidence = "high"; // This alone is 95% certainty
  }

  // ========================================
  // SECONDARY SIGNAL: Company name patterns
  // ========================================
  // Useful for catching edge cases where tax status might not be set correctly,
  // or for visual flagging before tax data is available.

  const name = customer.company_name?.trim() || "";

  if (name.length > 0) {
    // Check if name looks like a corporate entity
    const matchesCorporate = CORPORATE_NAME_PATTERNS.some((p) => p.test(name));
    const matchesConsumer = CONSUMER_NAME_PATTERNS.some((p) => p.test(name));

    if (matchesCorporate && !matchesConsumer) {
      signals.hasCompanyNamePattern = true;
      signals.reasons.push("Company name pattern");
    }
  }

  // ========================================
  // CONFIDENCE CALCULATION
  // ========================================
  // Priority: taxable status > name patterns

  if (signals.isTaxable) {
    // Taxable status is definitive
    signals.confidence = "high";
  } else if (signals.hasCompanyNamePattern) {
    // Name pattern alone is weaker - could be a legitimate B2B with corporate-sounding name
    signals.confidence = "medium";
  }
  // If neither signal, confidence stays "none"

  return signals;
}

/**
 * Get a display color for the confidence level.
 * Used for badges and visual indicators.
 */
export function getConfidenceColor(
  confidence: CorporateSignals["confidence"]
): {
  bg: string;
  text: string;
  border: string;
} {
  switch (confidence) {
    case "high":
      return {
        bg: "bg-amber-500/20",
        text: "text-amber-400",
        border: "border-amber-500/30",
      };
    case "medium":
      return {
        bg: "bg-yellow-500/15",
        text: "text-yellow-400",
        border: "border-yellow-500/20",
      };
    case "low":
      return {
        bg: "bg-gray-500/10",
        text: "text-gray-400",
        border: "border-gray-500/20",
      };
    default:
      return {
        bg: "",
        text: "",
        border: "",
      };
  }
}

/**
 * Format the reasons array into a tooltip-friendly string.
 */
export function formatCorporateReasons(reasons: string[]): string {
  if (reasons.length === 0) return "";
  return reasons.join(" • ");
}
