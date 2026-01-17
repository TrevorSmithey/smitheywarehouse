"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Fulfillment Index Page
 *
 * Redirects to /fulfillment/action (the default sub-page)
 */
export default function FulfillmentPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/fulfillment/action");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
