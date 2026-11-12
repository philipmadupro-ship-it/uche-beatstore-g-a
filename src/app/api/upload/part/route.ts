import { NextRequest } from 'next/server';
import { requireUploadSessionOwner } from '@/lib/storage/upload-session-auth';
import { handlePartConfirm, handlePartProxy, handlePartSign } from '@/lib/upload/part-route';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Returns a short-lived R2 URL. Audio bytes then travel browser -> R2.
 * `partNumbers: number[]` signs a whole file's parts in ONE request.
 * The handlers live in lib/upload/part-route (shared with the org upload).
 */
export async function POST(req: NextRequest) {
  return handlePartSign(req, requireUploadSessionOwner);
}

/** Records the ETag returned by R2 after a direct browser upload. */
export async function PATCH(req: NextRequest) {
  return handlePartConfirm(req, requireUploadSessionOwner);
}

/** Receives a single part for an existing session. Body is the raw chunk bytes. */
export async function PUT(req: NextRequest) {
  return handlePartProxy(req, requireUploadSessionOwner);
}
