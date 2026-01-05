"use client";

import { useState, useEffect, useCallback } from "react";
import PinPad from "@/components/auth/PinPad";
import { useAuth } from "@/lib/auth";
import { AnimatedQuail } from "@/components/SmitheyLoader";

type QuailState = "idle" | "looking" | "happy" | "surprised";

export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [quailState, setQuailState] = useState<QuailState>("idle");
  const [loginSuccess, setLoginSuccess] = useState(false);
  const { login, session, isLoading } = useAuth();

  // Quail looks up when user starts typing
  useEffect(() => {
    if (pin.length > 0 && pin.length < 4 && quailState === "idle") {
      setQuailState("looking");
    } else if (pin.length === 0 && quailState === "looking") {
      setQuailState("idle");
    }
  }, [pin.length, quailState]);

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length === 4 && !verifying) {
      handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const handleSubmit = useCallback(async () => {
    if (pin.length !== 4) return;

    setError(null);
    setVerifying(true);
    setQuailState("looking");

    try {
      const res = await fetch("/api/auth/verify-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Wrong PIN - quail is surprised/shakes
        setQuailState("surprised");
        setError(data.error || "Invalid PIN");
        setPin("");

        // Return to idle after shake animation
        setTimeout(() => setQuailState("idle"), 600);
        return;
      }

      // Success - quail celebrates!
      setQuailState("happy");
      setLoginSuccess(true);

      // Prefetch common dashboard data while user enjoys the celebration
      // This warms the browser cache so the landing page loads instantly
      const prefetchEndpoints = [
        '/api/inventory',
        '/api/fulfillment/metrics',
      ];
      prefetchEndpoints.forEach(endpoint => {
        fetch(endpoint).catch(() => {}); // Fire and forget - errors don't matter
      });

      // Let the celebration breathe - 2 seconds for the full experience
      setTimeout(() => {
        login(data.user);
      }, 2000);
    } catch {
      setQuailState("surprised");
      setError("Failed to verify PIN. Please try again.");
      setPin("");
      setTimeout(() => setQuailState("idle"), 600);
    } finally {
      setVerifying(false);
    }
  }, [pin, login]);

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <AnimatedQuail size="lg" state="idle" />
      </div>
    );
  }

  // If already authenticated, AuthContext will redirect
  if (session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <AnimatedQuail size="lg" state="happy" />
          <p className="text-text-secondary text-sm">Redirecting...</p>
        </div>
      </div>
    );
  }

  // Success celebration - full screen takeover
  if (loginSuccess) {
    return (
      <div className="min-h-screen flex flex-col bg-bg-primary overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
          {/* Radial glow expanding from center */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[600px] h-[600px] bg-status-good/20 rounded-full blur-[100px] animate-pulse" />
          </div>

          {/* Celebration content */}
          <div className="relative z-10 flex flex-col items-center">
            {/* Larger bouncing quail */}
            <div className="mb-8 transform scale-150">
              <AnimatedQuail size="lg" state="happy" />
            </div>

            {/* Welcome message - big and bold */}
            <h1
              className="text-3xl md:text-4xl font-light text-status-good tracking-[0.2em] uppercase mb-3 animate-fade-in"
              style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
            >
              Welcome Back
            </h1>

            {/* Seasoning message - signature line */}
            <p
              className="text-lg md:text-xl text-text-secondary tracking-[0.15em] uppercase animate-fade-in"
              style={{ animationDelay: '0.4s', animationFillMode: 'both' }}
            >
              Seasoning the data...
            </p>

            {/* Subtle loading dots */}
            <div
              className="flex gap-1.5 mt-6 animate-fade-in"
              style={{ animationDelay: '0.7s', animationFillMode: 'both' }}
            >
              <span className="w-2 h-2 rounded-full bg-status-good/60 animate-bounce" style={{ animationDelay: '0s' }} />
              <span className="w-2 h-2 rounded-full bg-status-good/60 animate-bounce" style={{ animationDelay: '0.15s' }} />
              <span className="w-2 h-2 rounded-full bg-status-good/60 animate-bounce" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full">
          {/* Animated Quail */}
          <div className="text-center mb-10">
            <div className="mb-4 flex justify-center relative">
              {/* Subtle glow effect behind quail */}
              <div
                className={`absolute inset-0 blur-2xl rounded-full transition-all duration-500 ${
                  quailState === "surprised"
                    ? "bg-status-bad/20 scale-125"
                    : "bg-accent-blue/10 scale-100"
                }`}
              />
              <AnimatedQuail size="lg" state={quailState} />
            </div>

            {/* Brand text */}
            <h1 className="text-lg font-light text-text-primary tracking-[0.3em] uppercase mb-1">
              Smithey
            </h1>
            <p className="text-xs text-text-tertiary uppercase tracking-[0.2em]">
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
                <span className="text-sm tracking-wide uppercase">Opening the vault...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
