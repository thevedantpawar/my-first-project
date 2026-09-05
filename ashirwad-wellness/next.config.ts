import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle, so the production image does not ship
  // node_modules (or the Playwright/Chromium dev dependencies with it).
  output: "standalone",

  // Prescription images are served as bytes through /api/private-file after the
  // caller has been re-authorised. They must never be cached by a CDN or a
  // shared proxy, and no other header set can be allowed to relax that.
  async headers() {
    return [
      {
        source: "/api/private-file",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A prescription image must not be embeddable by another origin.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Nothing here needs a camera, a microphone or a location.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Only meaningful over https, which the readiness gate requires.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
