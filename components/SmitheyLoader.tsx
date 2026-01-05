"use client";

/**
 * SmitheyLoader - Branded loading component with animated quail
 *
 * Features:
 * - Animated quail matching Smithey logo style
 * - Rotating cast-iron themed loading messages
 * - Optional custom message override
 */

import { useEffect, useState } from "react";

const LOADING_MESSAGES = [
  "Seasoning the data...",
  "Firing up the forge...",
  "Heating the iron...",
  "Opening the vault...",
  "Tempering the numbers...",
  "Polishing the pans...",
  "Stoking the coals...",
  "Forging ahead...",
  "Hammering out the details...",
  "Preheating the numbers...",
];

interface SmitheyLoaderProps {
  /** Optional custom message (otherwise random from list) */
  message?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

interface AnimatedQuailProps {
  size?: "sm" | "md" | "lg";
  /** Animation state for login interactions */
  state?: "idle" | "looking" | "happy" | "surprised";
}

/**
 * Animated Quail SVG - Matches Smithey logo silhouette
 * Elegant curved topknot, round body, clean lines
 */
export function AnimatedQuail({ size = "md", state = "idle" }: AnimatedQuailProps) {
  const sizes = {
    sm: { width: 40, height: 40 },
    md: { width: 56, height: 56 },
    lg: { width: 80, height: 80 },
  };

  const { width, height } = sizes[size];

  // Animation class based on state
  const animationClass = {
    idle: "animate-peck",
    looking: "",
    happy: "animate-bounce",
    surprised: "animate-shake",
  }[state];

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-text-secondary"
    >
      {/* Main body - round and plump like logo */}
      <ellipse
        cx="50"
        cy="58"
        rx="30"
        ry="26"
        fill="currentColor"
      />

      {/* Head/neck area with animation */}
      <g className={`${animationClass} origin-[45px_45px]`}>
        {/* Head */}
        <circle
          cx="38"
          cy="38"
          r="16"
          fill="currentColor"
        />

        {/* Elegant curved topknot - signature Smithey style */}
        <path
          d="M42 24 Q48 8 38 4 Q44 12 42 24"
          fill="currentColor"
          strokeLinecap="round"
        />
        {/* Topknot ball */}
        <circle cx="38" cy="6" r="4" fill="currentColor" />

        {/* Beak - small and elegant */}
        <path
          d="M24 40 L18 38 L24 36"
          fill="currentColor"
          className="opacity-80"
        />

        {/* Eye - friendly */}
        <circle cx="32" cy="36" r="3" className="fill-bg-primary opacity-80" />
        <circle cx="31" cy="35" r="1.5" fill="currentColor" />
      </g>

      {/* Tail feathers - elegant fan */}
      <path
        d="M78 48 Q92 40 88 28"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M80 54 Q96 50 94 36"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
        className="opacity-80"
      />
      <path
        d="M80 60 Q98 60 96 44"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        className="opacity-60"
      />

      {/* Legs - simple and clean */}
      <line x1="40" y1="82" x2="36" y2="96" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <line x1="54" y1="82" x2="58" y2="96" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function SmitheyLoader({ message, size = "md" }: SmitheyLoaderProps) {
  const [displayMessage, setDisplayMessage] = useState(
    message || LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]
  );

  // Rotate messages every 3 seconds if no custom message
  useEffect(() => {
    if (message) return;

    const interval = setInterval(() => {
      setDisplayMessage(
        LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]
      );
    }, 3000);

    return () => clearInterval(interval);
  }, [message]);

  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {/* Subtle glow effect */}
        <div className="absolute inset-0 blur-xl opacity-20 bg-accent-blue rounded-full scale-150" />

        {/* Animated quail */}
        <AnimatedQuail size={size} />
      </div>

      {/* Loading message with fade transition */}
      <span
        className={`${textSizes[size]} text-text-tertiary tracking-widest uppercase transition-opacity duration-300`}
        key={displayMessage}
      >
        {displayMessage}
      </span>
    </div>
  );
}

/**
 * Full-page loader variant
 */
export function SmitheyPageLoader({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-96">
      <SmitheyLoader message={message} size="lg" />
    </div>
  );
}
