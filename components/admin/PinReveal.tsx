"use client";

/**
 * PinReveal Component
 *
 * Secure PIN display with reveal-on-click and copy-to-clipboard.
 * Features smooth animations, visual feedback, and auto-hide for security.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { Eye, EyeOff, Copy, Check } from "lucide-react";

interface PinRevealProps {
  pin: string;
}

export default function PinReveal({ pin }: PinRevealProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Refs for timer cleanup to prevent memory leaks
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
      }
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const toggleReveal = useCallback(() => {
    // Clear any existing auto-hide timer
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }

    setIsRevealed((prev) => {
      const newValue = !prev;

      // Auto-hide after 5 seconds for security (only when revealing)
      if (newValue) {
        autoHideTimerRef.current = setTimeout(() => {
          setIsRevealed(false);
          autoHideTimerRef.current = null;
        }, 5000);
      }

      return newValue;
    });
  }, []);

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);

      // Clear any existing copy timer
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }

      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy PIN:", err);
    }
  }, [pin]);

  return (
    <div className="flex items-center gap-2">
      {/* PIN display */}
      <div
        className={`
          relative overflow-hidden
          px-2.5 py-1 rounded-md
          bg-bg-tertiary/50 border border-border
          transition-all duration-300
          ${isRevealed ? "border-accent-blue/30 bg-accent-blue/5" : ""}
        `}
      >
        <span
          className={`
            font-mono text-sm tracking-widest
            transition-all duration-300
            ${isRevealed ? "text-text-primary" : "text-text-tertiary"}
          `}
        >
          {isRevealed ? pin : "••••"}
        </span>

        {/* Reveal animation overlay */}
        {isRevealed && (
          <div
            className="absolute inset-0 bg-gradient-to-r from-accent-blue/10 to-transparent pointer-events-none animate-pulse"
            style={{ animationDuration: "2s" }}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        {/* Reveal button */}
        <button
          onClick={toggleReveal}
          className={`
            p-1.5 rounded-md transition-all duration-200
            ${isRevealed
              ? "text-accent-blue bg-accent-blue/10"
              : "text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
            }
          `}
          title={isRevealed ? "Hide PIN" : "Reveal PIN"}
        >
          {isRevealed ? (
            <EyeOff className="w-3.5 h-3.5" />
          ) : (
            <Eye className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Copy button */}
        <button
          onClick={copyToClipboard}
          className={`
            p-1.5 rounded-md transition-all duration-200
            ${copied
              ? "text-status-good bg-status-good/10"
              : "text-text-tertiary hover:text-text-secondary hover:bg-bg-tertiary"
            }
          `}
          title={copied ? "Copied!" : "Copy PIN"}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
