import { headers } from 'next/headers';
import { ShaderPreviewClient, type ShaderPreviewPayload } from './ShaderPreviewClient';

export const dynamic = 'force-dynamic';

async function loadStorePayload(): Promise<ShaderPreviewPayload> {
  const headerList = await headers();
  const host = headerList.get('host') ?? '127.0.0.1:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';

  try {
    const res = await fetch(`${protocol}://${host}/api/store`, { cache: 'no-store' });
    if (!res.ok) return { tracks: [] };
    return (await res.json()) as ShaderPreviewPayload;
  } catch {
    return { tracks: [] };
  }
}

export default async function ShaderPreviewPage() {
  const payload = await loadStorePayload();
  return <ShaderPreviewClient payload={payload} />;
}
