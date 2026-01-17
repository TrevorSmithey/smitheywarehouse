"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy Tracking Page
 *
 * Redirects to /fulfillment/analysis (new URL structure)
 * Keeping this redirect for backwards compatibility with bookmarks/links
 */
export default function TrackingPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/fulfillment/analysis");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
