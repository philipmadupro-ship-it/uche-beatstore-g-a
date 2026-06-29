import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/log';

const log = createLogger('security.csp');
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/csp-report
 *
 * Browser CSP violation sink (the `report-uri` target). Public by necessity —
 * the browser posts here directly. We sample + log violations so the team can
 * see what an *enforcing* CSP would block BEFORE flipping CSP_ENFORCE in
 * src/proxy.ts. Dev-mode HMR trips lots of false positives, so this is most
 * useful against production traffic.
 *
 * Always 204 and never throws — a report sink must not become a failure point.
 */
export async function POST(req: NextRequest) {
  try {
    // Sample to avoid log floods if a single bad asset spams reports.
    if (Math.random() < 0.1) {
      const body = await req.json().catch(() => null);
      const report = body?.['csp-report'] ?? body;
      if (report) {
        log.warn('csp violation', {
          directive: report['violated-directive'] ?? report.effectiveDirective ?? null,
          blocked: report['blocked-uri'] ?? report.blockedURL ?? null,
          document: report['document-uri'] ?? report.documentURL ?? null,
        });
      }
    }
  } catch {
    // never throw from a report sink
  }
  return new NextResponse(null, { status: 204 });
}
