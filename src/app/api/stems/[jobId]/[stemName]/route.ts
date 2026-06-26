import { NextRequest, NextResponse } from 'next/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.stems.jobId.stemName');

const DEMUCS_URL = process.env.DEMUCS_SERVICE_URL ?? 'http://localhost:8001';

/**
 * GET /api/stems/[jobId]/[stemName]
 *
 * Proxies the stem WAV file from the Demucs service.
 * The StemPlayer component hits this URL directly — it never talks to the service.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; stemName: string }> },
) {
  const { jobId, stemName } = await params;

  const serviceUrl = `${DEMUCS_URL}/api/v1/stems/${jobId}/${stemName}`;

  const upstream = await fetch(serviceUrl).catch((err) => {
    log.error(`Stem proxy fetch failed: ${err.message}`);
    return null;
  });

  if (!upstream) {
    return NextResponse.json(
      { error: 'Stem separation service is not reachable' },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Stem not available (${upstream.status})` },
      { status: upstream.status },
    );
  }

  // Stream the WAV bytes back to the client
  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': `attachment; filename="${stemName}.wav"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
