"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import PinPad from "@/components/auth/PinPad";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const { login, session, isLoading } = useAuth();

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length === 4 && !verifying) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function handleSubmit() {
    if (pin.length !== 4) return;

    setError(null);
    setVerifying(true);

    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Invalid PIN");
        setPin("");
        return;
      }

      // Success - store session and redirect
      login(data.user);
    } catch {
      setError("Failed to verify PIN. Please try again.");
      setPin("");
    } finally {
      setVerifying(false);
    }
  }

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If already authenticated, AuthContext will redirect
  if (session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <p className="text-text-secondary">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="mb-6 flex justify-center">
              <Image
                src="/smithey-logo-white.png"
                alt="Smithey Ironware"
                width={140}
                height={140}
                className="object-contain"
                priority
              />
            </div>
            <p className="text-sm text-text-tertiary uppercase tracking-[0.2em]">
              Operations Dashboard
            </p>
          </div>

          {/* PIN Entry Card */}
          <div className="bg-bg-secondary rounded-xl border border-border p-8">
            <h1 className="text-xl font-light text-text-primary text-center mb-2">
              Enter Your PIN
            </h1>
            <p className="text-sm text-text-tertiary text-center mb-8">
              4-digit access code
            </p>

            {/* Error message */}
            {error && (
              <div className="mb-6 p-4 rounded-lg bg-status-bad/10 border border-status-bad/30">
                <p className="text-status-bad font-medium text-center text-sm">
                  {error}
                </p>
              </div>
            )}

            {/* PIN Pad */}
            <PinPad
              pin={pin}
              onPinChange={setPin}
              onSubmit={handleSubmit}
              hideSubmit={true}
              disabled={verifying}
            />

            {verifying && (
              <div className="flex items-center justify-center gap-2 mt-6 text-text-tertiary">
                <div className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Verifying...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
