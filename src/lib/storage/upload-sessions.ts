/**
 * Per-session metadata for in-flight chunked uploads.
 *
 * In-memory store keyed by sessionId. Sessions are short-lived (typically
 * minutes), so in-memory is sufficient and avoids filesystem dependencies
 * that break under Turbopack (which aliases 'fs' for client bundles) and
 * on Vercel (read-only filesystem, no persistent state between invocations).
 *
 * Trade-off: sessions don't survive a process restart. In practice this
 * is rare during an active upload, and the upload manager client-side
 * handles the case by marking status='interrupted' and prompting the user
 * to re-pick the file.
 */

import type { PartRef } from './multipart';

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

function prune() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    const age = now - s.updatedAt;
    if (s.status === 'in_progress' ? age > TTL_ACTIVE_MS : age > TTL_DONE_MS) {
      sessions.delete(id);
    }
  }
}

export function getSession(sessionId: string): UploadSession | null {
  prune();
  return sessions.get(sessionId) ?? null;
}

export function createSession(
  s: Omit<UploadSession, 'createdAt' | 'updatedAt' | 'status' | 'parts'> & { parts?: PartRef[] },
): UploadSession {
  prune();
  const now = Date.now();
  const session: UploadSession = { ...s, parts: s.parts ?? [], createdAt: now, updatedAt: now, status: 'in_progress' };
  sessions.set(session.sessionId, session);
  return session;
}

export function recordPart(sessionId: string, part: PartRef): UploadSession | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  s.parts = [...s.parts.filter((p) => p.PartNumber !== part.PartNumber), part];
  s.updatedAt = Date.now();
  return s;
}

export function markStatus(sessionId: string, status: UploadSession['status']): UploadSession | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  s.status = status;
  s.updatedAt = Date.now();
  return s;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
}
