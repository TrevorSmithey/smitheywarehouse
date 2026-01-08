import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function additionalAnalysis() {
  // Noise breakdown
  const { data: noiseConvs } = await supabase
    .from("wholesale_conversations")
    .select("noise_type")
    .eq("is_noise", true);

  console.log("## NOISE BREAKDOWN");
  console.log("");
  if (noiseConvs) {
    const noiseTypes: Record<string, number> = {};
    for (const n of noiseConvs) {
      const type = n.noise_type || "Unknown";
      noiseTypes[type] = (noiseTypes[type] || 0) + 1;
    }
    console.log("Total noise conversations: " + noiseConvs.length);
    console.log("");
    console.log("| Noise Type | Count | % |");
    console.log("|------------|-------|---|");
    for (const [type, count] of Object.entries(noiseTypes).sort((a, b) => b[1] - a[1])) {
      console.log("| " + type + " | " + count + " | " + ((count/noiseConvs.length)*100).toFixed(0) + "% |");
    }
  }

  // Real convs for more analysis
  const { data: convs } = await supabase
    .from("wholesale_conversations")
    .select("*")
    .eq("is_noise", false)
    .not("classified_at", "is", null);

  if (!convs) return;

  // Peak day analysis
  console.log("");
  console.log("## PEAK DAYS (Busiest Specific Dates)");
  console.log("");
  const byDate: Record<string, number> = {};
  for (const c of convs) {
    const date = new Date(c.created_at).toISOString().split("T")[0];
    byDate[date] = (byDate[date] || 0) + 1;
  }
  const peakDays = Object.entries(byDate).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("| Date | Inquiries | Day |");
  console.log("|------|-----------|-----|");
  for (const [date, count] of peakDays) {
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date).getDay()];
    console.log("| " + date + " | " + count + " | " + dayName + " |");
  }

  // Support-only workload if someone handled just support
  console.log("");
  console.log("## WORKLOAD PROJECTION");
  console.log("");
  const supportConvs = convs.filter(c => c.requires === "Support");
  const salesConvs = convs.filter(c => c.requires === "Sales");
  const eitherConvs = convs.filter(c => c.requires === "Either");

  // Calculate business days in dataset
  const firstDate = new Date(Math.min(...convs.map(c => new Date(c.created_at).getTime())));
  const lastDate = new Date(Math.max(...convs.map(c => new Date(c.created_at).getTime())));
  const totalDays = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
  const businessDays = totalDays * 5 / 7;

  console.log("Data range: " + firstDate.toISOString().split("T")[0] + " to " + lastDate.toISOString().split("T")[0]);
  console.log("Approx business days: " + businessDays.toFixed(0));
  console.log("");
  console.log("If roles were split:");
  console.log("");
  console.log("SUPPORT workload:");
  console.log("- Total inquiries: " + supportConvs.length);
  console.log("- Per business day: " + (supportConvs.length / businessDays).toFixed(1));
  console.log("- Per week: " + (supportConvs.length / businessDays * 5).toFixed(1));
  console.log("");
  console.log("SALES workload:");
  console.log("- Total inquiries: " + salesConvs.length);
  console.log("- Per business day: " + (salesConvs.length / businessDays).toFixed(1));
  console.log("- Per week: " + (salesConvs.length / businessDays * 5).toFixed(1));
  console.log("");
  console.log("EITHER (needs triage): " + eitherConvs.length + " total (" + (eitherConvs.length / businessDays).toFixed(2) + "/day)");

  // Products in defect claims
  console.log("");
  console.log("## PRODUCT ISSUES - SAMPLE CLAIMS");
  console.log("");
  const productIssues = convs.filter(c => c.known_category === "Product Issue");
  console.log("Total product issues: " + productIssues.length);
  console.log("");
  for (const c of productIssues.slice(0, 15)) {
    console.log("- [" + (c.customer_company || "Unknown") + "] " + c.what_they_want);
  }

  // Relationship management examples
  console.log("");
  console.log("## RELATIONSHIP MANAGEMENT - SAMPLE INQUIRIES");
  console.log("");
  const relConvs = convs.filter(c => c.known_category === "Relationship");
  console.log("Total relationship inquiries: " + relConvs.length);
  console.log("");
  for (const c of relConvs.slice(0, 15)) {
    console.log("- [" + (c.customer_company || "Unknown") + "] " + c.what_they_want);
  }

  // Pricing/Terms examples
  console.log("");
  console.log("## PRICING/TERMS - SAMPLE INQUIRIES");
  console.log("");
  const pricingConvs = convs.filter(c => c.known_category === "Pricing/Terms");
  console.log("Total pricing/terms inquiries: " + pricingConvs.length);
  console.log("");
  for (const c of pricingConvs.slice(0, 15)) {
    console.log("- [" + (c.customer_company || "Unknown") + "] " + c.what_they_want);
  }

  // Payment/Credit examples
  console.log("");
  console.log("## PAYMENT/CREDIT - SAMPLE INQUIRIES");
  console.log("");
  const paymentConvs = convs.filter(c => c.known_category === "Payment/Credit");
  console.log("Total payment/credit inquiries: " + paymentConvs.length);
  console.log("");
  for (const c of paymentConvs.slice(0, 15)) {
    console.log("- [" + (c.customer_company || "Unknown") + "] " + c.what_they_want);
  }
}

additionalAnalysis().catch(console.error);
