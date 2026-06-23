import { NextRequest } from 'next/server';
import { getStoredObject, parseR2ObjectRef } from '@/lib/storage/upload';

function isAllowedRelativeSource(src: string): boolean {
  return src.startsWith('/uploads/') && !src.includes('..');
}

export async function streamAudioSource(
  req: NextRequest,
  src: string,
  filename: string,
): Promise<Response> {
  return streamSource(req, src, filename, true);
}

export async function streamAudioPreviewSource(
  req: NextRequest,
  src: string,
): Promise<Response> {
  return streamSource(req, src, null, false);
}

async function streamSource(
  req: NextRequest,
  src: string,
  filename: string | null,
  attachment: boolean,
): Promise<Response> {
  const headers: Record<string, string> = {};
  const range = req.headers.get('range');
  if (range) headers.Range = range;

  if (parseR2ObjectRef(src)) {
    const ref = parseR2ObjectRef(src)!;
    const allowedBuckets = new Set(
      [process.env.R2_PRIVATE_BUCKET_NAME, process.env.R2_BUCKET_NAME].filter(Boolean),
    );
    if (!allowedBuckets.has(ref.bucket)) {
      return new Response('Source not allowed', { status: 403 });
    }
    const object = await getStoredObject(src, range);
    if (!object?.Body) return new Response('Source unavailable', { status: 404 });

    const out = new Headers();
    out.set('content-type', object.ContentType || 'audio/mpeg');
    out.set('accept-ranges', object.AcceptRanges || 'bytes');
    if (object.ContentLength != null) out.set('content-length', String(object.ContentLength));
    if (object.ContentRange) out.set('content-range', object.ContentRange);
    if (object.ETag) out.set('etag', object.ETag);
    if (object.LastModified) out.set('last-modified', object.LastModified.toUTCString());
    if (attachment && filename) {
      const safe = filename.replace(/[\r\n"\\]/g, '_');
      out.set('content-disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    }
    out.set('cache-control', 'private, no-store');
    out.set('x-content-type-options', 'nosniff');

    return new Response(object.Body.transformToWebStream(), {
      status: range ? 206 : 200,
      headers: out,
    });
  }

  let target: string;
  if (src.startsWith('/')) {
    if (!isAllowedRelativeSource(src)) {
      return new Response('Source not allowed', { status: 403 });
    }
    const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    target = new URL(src, origin).toString();
  } else {
    const parsed = new URL(src);
    const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    const allowedHost = publicBase ? new URL(publicBase).host : null;
    if (parsed.protocol !== 'https:' || (allowedHost && parsed.host !== allowedHost)) {
      return new Response('Source not allowed', { status: 403 });
    }
    target = parsed.toString();
  }

  const upstream = await fetch(target, { headers, cache: 'no-store' });
  const out = new Headers();
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(key);
    if (value) out.set(key, value);
  }
  if (!out.get('content-type')) out.set('content-type', 'audio/mpeg');
  if (!out.get('accept-ranges')) out.set('accept-ranges', 'bytes');
  if (attachment && filename) {
    const safe = filename.replace(/[\r\n"\\]/g, '_');
    out.set('content-disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }
  out.set('cache-control', 'private, no-store');
  out.set('x-content-type-options', 'nosniff');

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
