/**
 * Per-session metadata for in-flight chunked uploads.
 *
 * Supabase is the durable production store so sessions survive independent
 * serverless invocations and deploys. The in-memory map remains only for
 * local development when Supabase is not configured.
 */

import type { PartRef } from './multipart';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/local-store';

export interface UploadSession {
  sessionId: string;
  uploadId: string;
  key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  partSize: number;
  totalParts: number;
  parts: PartRef[];
  type: string;
  projectId: string | null;
  replaceTrackId: string | null;
  userId: string | null;
  createdAt: number;
  updatedAt: number;
  status: 'in_progress' | 'completed' | 'aborted';
}

// Module-level Map — survives the lifetime of the Node.js process.
const sessions = new Map<string, UploadSession>();

const TTL_DONE_MS    = 24 * 60 * 60 * 1000; // completed/aborted: evict after 24h
const TTL_ACTIVE_MS  =  2 * 60 * 60 * 1000; // in-progress: evict after 2h of no updates

function pruneLocal() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const age = now - s.updatedAt;
    if (s.status === 'in_progress' ? age > TTL_ACTIVE_MS : age > TTL_DONE_MS) {
      sessions.delete(id);
    }
  }
}

type UploadSessionRow = {
  session_id: string;
  upload_id: string;
  object_key: string;
  file_name: string;
  file_size: number;
  content_type: string;
  part_size: number;
  total_parts: number;
  parts: PartRef[] | null;
  track_type: string;
  project_id: string | null;
  replace_track_id: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
  status: UploadSession['status'];
};

function fromRow(row: UploadSessionRow): UploadSession {
  return {
    sessionId: row.session_id,
    uploadId: row.upload_id,
    key: row.object_key,
    fileName: row.file_name,
    fileSize: Number(row.file_size),
    contentType: row.content_type,
    partSize: row.part_size,
    totalParts: row.total_parts,
    parts: Array.isArray(row.parts) ? row.parts : [],
    type: row.track_type,
    projectId: row.project_id,
    replaceTrackId: row.replace_track_id,
    userId: row.user_id,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    status: row.status,
  };
}

export async function getSession(sessionId: string): Promise<UploadSession | null> {
  if (!isSupabaseConfigured()) {
    pruneLocal();
    return sessions.get(sessionId) ?? null;
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from('upload_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`Upload session lookup failed: ${error.message}`);
  return data ? fromRow(data as UploadSessionRow) : null;
}

export async function createSession(
  s: Omit<UploadSession, 'createdAt' | 'updatedAt' | 'status' | 'parts'> & { parts?: PartRef[] },
): Promise<UploadSession> {
  const now = Date.now();
  const session: UploadSession = { ...s, parts: s.parts ?? [], createdAt: now, updatedAt: now, status: 'in_progress' };
  if (isSupabaseConfigured()) {
    if (!session.userId) throw new Error('Authenticated owner required for upload session');
    const admin = createServiceClient();
    const { error } = await admin.from('upload_sessions').insert({
      session_id: session.sessionId,
      user_id: session.userId,
      upload_id: session.uploadId,
      object_key: session.key,
      file_name: session.fileName,
      file_size: session.fileSize,
      content_type: session.contentType,
      part_size: session.partSize,
      total_parts: session.totalParts,
      parts: session.parts,
      track_type: session.type,
      project_id: session.projectId,
      replace_track_id: session.replaceTrackId,
      status: session.status,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    });
    if (error) throw new Error(`Upload session create failed: ${error.message}`);
    return session;
  }

  pruneLocal();
  sessions.set(session.sessionId, session);
  return session;
}

export async function recordPart(sessionId: string, part: PartRef): Promise<UploadSession | null> {
  if (isSupabaseConfigured()) {
    const admin = createServiceClient();
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = await getSession(sessionId);
      if (!s) return null;
      const previousUpdatedAt = new Date(s.updatedAt).toISOString();
      s.parts = [...s.parts.filter((p) => p.PartNumber !== part.PartNumber), part];
      s.updatedAt = Math.max(Date.now(), s.updatedAt + 1);
      const { data, error } = await admin
        .from('upload_sessions')
        .update({ parts: s.parts, updated_at: new Date(s.updatedAt).toISOString() })
        .eq('session_id', sessionId)
        .eq('user_id', s.userId)
        .eq('updated_at', previousUpdatedAt)
        .select('*')
        .maybeSingle();
      if (error) throw new Error(`Upload session part update failed: ${error.message}`);
      if (data) return fromRow(data as UploadSessionRow);
    }
    throw new Error('Upload session part update conflicted too many times');
  }

  const s = await getSession(sessionId);
  if (!s) return null;
  s.parts = [...s.parts.filter((p) => p.PartNumber !== part.PartNumber), part];
  s.updatedAt = Date.now();
  sessions.set(sessionId, s);
  return s;
}

export async function markStatus(sessionId: string, status: UploadSession['status']): Promise<UploadSession | null> {
  const s = await getSession(sessionId);
  if (!s) return null;
  s.status = status;
  s.updatedAt = Date.now();
  if (isSupabaseConfigured()) {
    const admin = createServiceClient();
    const { error } = await admin
      .from('upload_sessions')
      .update({ status, updated_at: new Date(s.updatedAt).toISOString() })
      .eq('session_id', sessionId)
      .eq('user_id', s.userId);
    if (error) throw new Error(`Upload session status update failed: ${error.message}`);
    return s;
  }
  sessions.set(sessionId, s);
  return s;
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const admin = createServiceClient();
    const { error } = await admin.from('upload_sessions').delete().eq('session_id', sessionId);
    if (error) throw new Error(`Upload session delete failed: ${error.message}`);
    return;
  }
  sessions.delete(sessionId);
}
