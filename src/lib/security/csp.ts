/**
 * Content-Security-Policy for src/proxy.ts.
 *
 * The policy is strict and nonce-based. It is ENFORCED only on the public
 * storefront (`/store` and `/store/*`) and REPORT-ONLY everywhere else.
 *
 * Why the split: an enforcing nonce policy blocks Next's build-time inline
 * bootstrap on any prerendered (static) page, because a static HTML file
 * cannot carry a per-request nonce. The whole dashboard and the auth pages
 * are prerendered, so enforcing there white-screens them. Every /store route
 * renders per request, and a production crawl on 2026-09-17 found no
 * violations on them. The storefront is also where the risk sits: it is
 * public, takes buyer emails and hosts Stripe checkout.
 *
 * If a /store route ever becomes static, enforcement would break it. The
 * `scripts/ci/check-store-dynamic.mjs` step in CI fails the build when that
 * happens.
 */

export function isCspEnforcedPath(pathname: string): boolean {
  return pathname === '/store' || pathname.startsWith('/store/');
}

/**
 * Production only. `next dev` serves HMR code that needs 'unsafe-eval', so
 * enforcing in development would break the store in `npm run dev` and in the
 * Playwright job, which runs the dev server.
 */
export function cspHeaderName(
  pathname: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return nodeEnv === 'production' && isCspEnforcedPath(pathname)
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';
}

export function buildCsp(nonce: string, framable = false): string {
  // /embed/* must be framable on any origin (it's a distribution widget), so
  // its frame-ancestors is wide-open; every other route stays locked to self.
  const frameAncestors = framable ? `frame-ancestors *` : `frame-ancestors 'self'`;
  return [
    `default-src 'self'`,
    // Next's inline bootstrap gets the nonce; bundled chunks are 'self'.
    // Stripe.js and its subdomains are required for embedded checkout.
    // 'wasm-unsafe-eval' permits WebAssembly compilation only
    // (Essentia/audio-decode), not arbitrary JS eval. Dev-mode HMR also trips
    // 'unsafe-eval'; that's a dev-only false positive, so don't add it.
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://js.stripe.com https://*.js.stripe.com`,
    // Inline styles + styled-jsx need 'unsafe-inline' (style injection is not
    // a meaningful XSS vector the way script injection is).
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https: wss:`,
    // Audio analysis runs in blob: workers (dashboard). Explicit so workers
    // don't fall back to script-src, which has no blob:.
    `worker-src 'self' blob:`,
    `frame-src https://js.stripe.com https://*.js.stripe.com https://*.stripe.com https://hooks.stripe.com`,
    frameAncestors,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    // /api/csp-report samples and logs violations from both modes.
    `report-uri /api/csp-report`,
  ].join('; ');
}
