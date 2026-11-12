/**
 * The checks both portal upload routes run before anything is stored
 * (PORTAL-UP): the portal gate (404 / 410 / 401 password / 401 sign-in),
 * then membership — a project outside this portal is 404, one inside with
 * uploads off is 403 — then a per-portal hourly cap.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { gatePortal, type GatedPortal } from './gate';
import { portalProjectLinks } from './membership';
import { loadUploadableProjects, portalUploadDecision, PORTAL_UPLOADS_PER_HOUR } from './uploads';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type UploadGate = { ok: true; portal: GatedPortal } | { ok: false; res: NextResponse };

/** `step` keeps presigning and storing on separate budgets, so one large file costs one upload. */
export async function gatePortalUpload(admin: Admin, token: string, req: NextRequest, projectId: string, step: 'store' | 'presign' = 'store'): Promise<UploadGate> {
  const gate = await gatePortal(admin, token, req);
  if (!gate.ok) return gate;
  const portal = gate.portal;
  const links = await portalProjectLinks(admin, portal);
  const uploadable = await loadUploadableProjects(admin, portal, links.map((l) => l.project_id));
  const decision = portalUploadDecision(links, uploadable, projectId);
  if (decision === 'not-found') return { ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (decision === 'uploads-off') {
    return { ok: false, res: NextResponse.json({ error: 'Uploads are not switched on for this project.' }, { status: 403 }) };
  }
  if (!(await rateLimitDurable(`portal${step}:${portal.id}`, PORTAL_UPLOADS_PER_HOUR, 60 * 60_000))) {
    return { ok: false, res: NextResponse.json({ error: 'That is a lot of files for one hour. Try again later.' }, { status: 429 }) };
  }
  return { ok: true, portal };
}
