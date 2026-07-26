import type { NextConfig } from "next";

const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const apiUrl = new URL(apiOrigin);

const nextConfig: NextConfig = {
  // The shared contract package ships TypeScript source, so it must be compiled
  // with the app rather than consumed as pre-built JS.
  transpilePackages: ["@course-lms/shared"],

  images: {
    // `images.domains` was removed in Next 16 — remotePatterns is the only option.
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
      // Course images uploaded through the admin panel are served by the API.
      {
        protocol: apiUrl.protocol === "https:" ? "https" : "http",
        hostname: apiUrl.hostname,
        port: apiUrl.port || undefined,
        pathname: "/uploads/**",
      },
    ],
  },

  async headers() {
    return [
      {
        // The service worker must never be cached, or kiosks pin an old build.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
