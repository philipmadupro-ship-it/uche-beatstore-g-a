/**
 * /api/org/[orgId]/upload/part (LABEL-14) — sign (POST), confirm (PATCH) and
 * proxy (PUT) the parts of an org upload. The same handlers as the producer's
 * `/api/upload/part` (lib/upload/part-route); only the session gate differs:
 * the session must be this org's (`orgs/<org>/tracks/…` key), started by the
 * caller, who still holds `catalog.write` here (../access).
 */
import { NextRequest } from 'next/server';
import { handlePartConfirm, handlePartProxy, handlePartSign, type AuthorizeUploadSession } from '@/lib/upload/part-route';
import { requireUploadActor } from '@/lib/auth/org-access';
import { orgSessionAuthorizer } from '../access';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: Promise<{ orgId: string }> };

async function withGate(
  { params }: Params,
  handle: (authorize: AuthorizeUploadSession) => Promise<Response>,
): Promise<Response> {
  const access = await requireUploadActor((await params).orgId);
  if (!access.ok) return access.res;
  return handle(orgSessionAuthorizer(access));
}

export async function POST(req: NextRequest, ctx: Params) {
  return withGate(ctx, (authorize) => handlePartSign(req, authorize));
}

export async function PATCH(req: NextRequest, ctx: Params) {
  return withGate(ctx, (authorize) => handlePartConfirm(req, authorize));
}

export async function PUT(req: NextRequest, ctx: Params) {
  return withGate(ctx, (authorize) => handlePartProxy(req, authorize));
}
