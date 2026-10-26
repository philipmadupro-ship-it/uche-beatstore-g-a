/**
 * Which upload API a tray row talks to (LABEL-14). A producer upload uses
 * `/api/upload/*` exactly as before; an org upload carries an
 * `OrgUploadTarget` — the org and what the file becomes — and uses
 * `/api/org/<org>/upload/*`, whose init and complete take that intent. Pure,
 * so the manager's only change is to ask here.
 */
import { OrgUploadIntentSchema } from '@/lib/contracts';
import type { OrgUploadIntent } from '@/lib/labelos/org-upload';
import { isUUID } from '@/lib/validate';

export interface OrgUploadTarget {
  orgId: string;
  as: OrgUploadIntent;
}

/** The API root for a row: the producer's, or the org's. */
export function uploadApiBase(org: OrgUploadTarget | null | undefined): string {
  return org ? `/api/org/${encodeURIComponent(org.orgId)}/upload` : '/api/upload';
}

/** The `/init` body: unchanged for a producer upload; the intent (and nothing the server decides) for an org one. */
export function uploadInitBody(item: {
  fileName: string;
  fileSize: number;
  contentType: string;
  type: string;
  projectId: string | null;
  replaceTrackId: string | null;
  org: OrgUploadTarget | null;
}): Record<string, unknown> {
  if (item.org) return { fileName: item.fileName, fileSize: item.fileSize, fileType: item.contentType, as: item.org.as };
  return {
    fileName: item.fileName,
    fileSize: item.fileSize,
    fileType: item.contentType,
    trackType: item.type,
    projectId: item.projectId,
    replaceTrackId: item.replaceTrackId,
  };
}

/** The `/complete` body. */
export function uploadCompleteBody(sessionId: string, analysis: unknown, org: OrgUploadTarget | null | undefined): Record<string, unknown> {
  return org ? { sessionId, analysis, as: org.as } : { sessionId, analysis };
}

/** A target restored from localStorage (untrusted), or null. Same schema the server checks. */
export function parseOrgUploadTarget(raw: unknown): OrgUploadTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { orgId?: unknown; as?: unknown };
  if (!isUUID(r.orgId)) return null;
  const as = OrgUploadIntentSchema.safeParse(r.as);
  return as.success ? { orgId: r.orgId, as: as.data } : null;
}

/** Same destination? A file queued twice for the same target is one upload; for two targets it is two. */
export function sameUploadTarget(a: OrgUploadTarget | null | undefined, b: OrgUploadTarget | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.orgId === b.orgId && JSON.stringify(a.as) === JSON.stringify(b.as);
}
