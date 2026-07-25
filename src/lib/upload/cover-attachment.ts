export type CoverAttachTarget =
  | { kind: 'track'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'profile' };

function targetEndpoint(target: CoverAttachTarget) {
  if (target.kind === 'profile') {
    return { url: '/api/profile', method: 'POST', body: { hero_image_url: '' } };
  }

  if (!target.id.trim()) {
    throw new Error('Choose a target before attaching the cover.');
  }

  return {
    url: `/api/${target.kind === 'track' ? 'tracks' : `${target.kind}s`}/${encodeURIComponent(target.id.trim())}`,
    method: 'PATCH',
    body: { cover_url: '' },
  };
}

export async function attachCoverUrl(target: CoverAttachTarget, coverUrl: string) {
  if (!coverUrl.trim()) {
    throw new Error('Upload a generated cover before attaching it.');
  }

  const endpoint = targetEndpoint(target);
  const body = Object.fromEntries(
    Object.keys(endpoint.body).map((key) => [key, coverUrl]),
  );

  const response = await fetch(endpoint.url, {
    method: endpoint.method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  }

  return data;
}
