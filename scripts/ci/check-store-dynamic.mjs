// Fails the build if any /store route was prerendered.
//
// src/lib/security/csp.ts ENFORCES a nonce-based CSP on /store and /store/*.
// A prerendered page's inline bootstrap script carries no per-request nonce,
// so an enforced policy blocks it and the page renders blank. Every /store
// route is dynamic today; this keeps it that way, or makes someone decide.
//
// Run after `next build`.
import fs from 'node:fs';

const manifestPath = '.next/prerender-manifest.json';
if (!fs.existsSync(manifestPath)) {
  console.error(`${manifestPath} not found; run next build first.`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const routes = [
  ...Object.keys(manifest.routes ?? {}),
  ...Object.keys(manifest.dynamicRoutes ?? {}),
];
const staticStore = routes.filter((r) => r === '/store' || r.startsWith('/store/'));
if (staticStore.length) {
  console.error('These /store routes were prerendered, and the enforced CSP will blank them:');
  for (const r of staticStore) console.error(`  ${r}`);
  console.error('Make them dynamic, or narrow isCspEnforcedPath in src/lib/security/csp.ts.');
  process.exit(1);
}
console.log('OK: no /store route is prerendered.');
