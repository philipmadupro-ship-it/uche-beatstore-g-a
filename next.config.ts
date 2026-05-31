import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baseline security headers on every response. HSTS forces HTTPS;
  // nosniff blocks MIME-confusion; X-Frame-Options stops clickjacking;
  // Referrer-Policy trims referer leakage; Permissions-Policy disables
  // sensors we don't use. The nonce-based CSP is applied per-request in
  // src/proxy.ts (it needs a per-request nonce, which static headers can't do).
  async headers() {
    const baseHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      // CSP (incl. frame-ancestors) is set per-request with a nonce in
      // src/proxy.ts — not here, so the two don't conflict.
    ];
    return [
      {
        // Everything EXCEPT /embed gets X-Frame-Options: SAMEORIGIN
        // (clickjacking protection). /embed is intentionally framable
        // cross-origin so producers can embed the player anywhere.
        source: '/((?!embed/).*)',
        headers: [...baseHeaders, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      {
        source: '/embed/:path*',
        headers: baseHeaders, // no X-Frame-Options → embeddable anywhere
      },
    ];
  },
  // audio-decode + WASM decoder workers use `await import(<dynamic>)` patterns
  // that webpack/turbopack cannot trace. Mark them server-external so the
  // server bundle requires them at runtime; analyze.client.ts (browser) does
  // not import them, so client builds are unaffected.
  experimental: {
    // Bump multipart body limit so the buyer beat-match upload (vocal
    // clip up to ~25MB) makes it through Next's parser instead of being
    // truncated at the default 10MB.
    serverActions: { bodySizeLimit: '25mb' },
  },
  // App Router route handlers — same setting (Next 16+).
  // @ts-ignore  middlewareClientMaxBodySize is a Next 16+ option not yet
  // in the TS types.
  middlewareClientMaxBodySize: '25mb',
  // Cover art lives in Cloudflare R2's public bucket. Allowlist it so
  // next/image can optimize (resize + AVIF/WebP) the storefront covers —
  // the single biggest LCP win on the public store. r2.dev serves dev
  // buckets; a custom domain would be added here too once wired.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
  serverExternalPackages: [
    'audio-decode',
    '@wasm-audio-decoders/opus-ml',
    '@wasm-audio-decoders/common',
    '@eshaz/web-worker',
    '@audio/decode-opus',
    '@audio/decode-aac',
    '@audio/decode-amr',
    '@audio/decode-wma',
    'music-tempo',
    'music-metadata',
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
  // Silence turbopack/webpack conflict in Next 16
  // @ts-ignore
  turbopack: {
    resolveAlias: {
      fs: './src/lib/audio/mocks/empty.ts',
    },
  },
};





export default nextConfig;
