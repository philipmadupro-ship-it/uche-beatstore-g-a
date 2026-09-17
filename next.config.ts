import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { allowedImageHostnames } from "./src/lib/images/remote-hosts";

const projectRoot = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

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
    // Multipart body limit for server actions. Raised for the buyer
    // beat-match upload, which has since been removed; kept because the
    // default 10MB is low for any audio-bearing action.
    serverActions: { bodySizeLimit: '25mb' },
  },
  // Cover art lives in Cloudflare R2's public bucket. Allowlist it so
  // next/image can optimize (resize + AVIF/WebP) the storefront covers —
  // the single biggest LCP win on the public store.
  //
  // Built from the shared list rather than written out here, because
  // CoverImage has to make the same judgement at render time: next/image
  // THROWS for an unlisted hostname instead of firing onError, so a mismatch
  // between these two lists is a crashed page, not a slow image. The custom
  // CDN domain (NEXT_PUBLIC_R2_CDN_URL) is folded in automatically — it was
  // missing here, so enabling that documented option would have broken every
  // optimized cover.
  images: {
    remotePatterns: allowedImageHostnames().map((hostname) => ({
      protocol: 'https' as const,
      hostname,
    })),
  },
  serverExternalPackages: [
    // exceljs pulls in graceful-fs, which patches `fs` at load. Bundled, it
    // gets the empty `fs` stub from resolveAlias below and throws while the
    // build collects route config. Loaded from node_modules it sees real fs.
    'exceljs',
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
    // Keep the native ffmpeg binary external (required at runtime, not bundled).
    'ffmpeg-static',
  ],
  // Next's tracer can't see the ffmpeg-static binary (it's spawned via a path
  // string, not imported), so include it explicitly for the routes that
  // generate audio previews. Without this the binary is missing on Vercel and
  // MP3 preview generation silently falls back to byte-truncation.
  outputFileTracingIncludes: {
    '/api/tracks/[id]/analyze': ['./node_modules/ffmpeg-static/ffmpeg'],
    '/api/cron/backfill-previews': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
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
  turbopack: {
    // Pin the workspace root to THIS project. Without it, Turbopack walks up
    // and finds a stray ~/package-lock.json, rooting at the home directory —
    // which breaks .env.local resolution and the fs alias below.
    root: projectRoot,
    // essentia.js UMD build has `require('fs')` inline; alias to empty stub
    // so the client bundle doesn't crash. upload-sessions.ts previously used
    // fs too, but has been rewritten to use in-memory storage so it no longer
    // needs the real fs module on the server side.
    resolveAlias: {
      fs: './src/lib/audio/mocks/empty.ts',
    },
  },
};





export default nextConfig;
