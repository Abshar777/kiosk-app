import type { NextConfig } from "next";

/**
 * Where the API actually lives. Read at RUNTIME (next.config is evaluated when
 * the server boots), so the same build can be pointed at a different API by
 * restarting with a different API_URL — no rebuild.
 */
const apiOrigin =
  process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const apiUrl = new URL(apiOrigin);

/**
 * Set only when the browser should call the API directly on another origin.
 * Leaving it unset (the default) keeps requests same-origin and proxied below,
 * which avoids CORS entirely and keeps the API address out of the bundle.
 */
const directApiOrigin = process.env.NEXT_PUBLIC_API_URL?.trim();

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
      // Only needed when the browser calls the API directly; under the default
      // proxy, uploads are same-origin and need no pattern at all.
      ...(directApiOrigin
        ? [
            {
              protocol: (apiUrl.protocol === "https:" ? "https" : "http") as "http" | "https",
              hostname: apiUrl.hostname,
              port: apiUrl.port || undefined,
              pathname: "/uploads/**",
            },
          ]
        : []),
    ],
  },

  /**
   * Proxy API traffic through our own origin so the browser never needs the
   * API's address. Skipped when NEXT_PUBLIC_API_URL asks for direct calls.
   *
   * Returning an array means these are checked after the filesystem, so a real
   * page or public file always wins — safe because the app owns no /api routes.
   */
  async rewrites() {
    if (directApiOrigin) return [];
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      // Admin-uploaded course images are served by the API too.
      { source: "/uploads/:path*", destination: `${apiOrigin}/uploads/:path*` },
    ];
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
