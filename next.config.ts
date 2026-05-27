import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
