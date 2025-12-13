import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Logging configuration for production debugging
  logging: {
    fetches: {
      fullUrl: true,
    },
  },

  // Optimize images for performance
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Enable gzip compression (reduces bundle size)
  compress: true,

  // Generate source maps in production for debugging
  productionBrowserSourceMaps: false,

  // Experimental features for better performance
  experimental: {
    // Enable optimistic client cache
    staleTimes: {
      dynamic: 30, // Cache dynamic pages for 30s
      static: 180, // Cache static pages for 3min
    },
  },

  // Headers for security and caching
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
        ],
      },
      {
        // Cache static assets aggressively
        source: "/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
