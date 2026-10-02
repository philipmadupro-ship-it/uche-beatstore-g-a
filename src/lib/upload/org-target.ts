/**
 * Which upload API a tray row talks to (LABEL-14). A producer upload uses
 * `/api/upload/*` exactly as before; an org upload carries an
 * `OrgUploadTarget` — the org and what the file becomes — and uses
 * `/api/org/<org>/upload/*`, whose init and complete take that intent. Pure,
 * so the manager's only change is to ask here.
 */
import { ORG_UPLOAD_RELATIONS, type OrgUploadIntent } from '@/lib/labelos/org-upload';

export interface OrgUploadTarget {
  orgId: string;
  as: OrgUploadIntent;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** A target restored from localStorage (untrusted), or null. */
export function parseOrgUploadTarget(raw: unknown): OrgUploadTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { orgId?: unknown; as?: unknown };
  if (typeof r.orgId !== 'string' || !UUID.test(r.orgId) || !r.as || typeof r.as !== 'object') return null;
  const as = r.as as Record<string, unknown>;
  if (as.kind === 'song' && typeof as.contactId === 'string' && UUID.test(as.contactId)) {
    return { orgId: r.orgId, as: { kind: 'song', contactId: as.contactId } };
  }
  if (
    as.kind === 'link' &&
    typeof as.songId === 'string' && UUID.test(as.songId) &&
    (ORG_UPLOAD_RELATIONS as readonly unknown[]).includes(as.relation)
  ) {
    return { orgId: r.orgId, as: { kind: 'link', songId: as.songId, relation: as.relation as (typeof ORG_UPLOAD_RELATIONS)[number] } };
  }
  return null;
}
