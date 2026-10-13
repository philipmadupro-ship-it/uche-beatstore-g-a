/**
 * Everything an organization keeps in object storage lives under one prefix,
 * `orgs/<org_id>/` (LABEL-14/15: masters, previews, peaks, project files), in
 * the PRIVATE bucket — or, with no R2 configured, under `data/orgs/<org_id>/`
 * and the local upload staging. This module lists that prefix (the export's
 * manifest) and empties it (the purge cron).
 *
 * The prefix is built from a validated UUID and always ends in a slash, so
 * `orgs/<id>/` can never match `orgs/<id>2/…` or another tenant's keys, and a
 * producer's objects (which never start with `orgs/`) are out of reach by
 * construction.
 *
 * The S3 calls take the client as an argument so tests drive them with a
 * fake; the callers pass the shared `r2` client.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { isR2Configured } from '@/lib/local-store';
import { isUUID } from '@/lib/validate';
import { r2 } from './upload';

export type StoredObject = { key: string; size: number | null; lastModified: string | null };

type S3Like = { send: (command: never) => Promise<unknown> };

/** `orgs/<org_id>/`. Throws on anything that is not a UUID. */
export function orgPrefix(orgId: string): string {
  if (!isUUID(orgId)) throw new Error('Invalid organization id');
  return `orgs/${orgId.toLowerCase()}/`;
}

/** Buckets an org's objects may be in: the private bucket, plus the public one if configured (nothing should be there; D8). */
export function orgBuckets(): string[] {
  return [process.env.R2_PRIVATE_BUCKET_NAME, process.env.R2_BUCKET_NAME].filter(
    (b, i, all): b is string => !!b && all.indexOf(b) === i,
  );
}

type ListPage = { Contents?: { Key?: string; Size?: number; LastModified?: Date }[]; IsTruncated?: boolean; NextContinuationToken?: string };

/** Every object under `prefix` in `bucket`. */
export async function listPrefix(client: S3Like, bucket: string, prefix: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let token: string | undefined;
  do {
    const page = (await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }) as never,
    )) as ListPage;
    for (const o of page.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, size: o.Size ?? null, lastModified: o.LastModified ? o.LastModified.toISOString() : null });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/**
 * Delete every object under `prefix`, 1000 keys a request, then list again:
 * a prefix that still lists something is a failure the caller must see, not a
 * silent partial purge. Returns how many objects were removed.
 */
export async function deletePrefix(client: S3Like, bucket: string, prefix: string): Promise<number> {
  let removed = 0;
  for (let round = 0; round < 50; round += 1) {
    const page = (await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }) as never,
    )) as ListPage;
    const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
    if (keys.length === 0) return removed;
    const res = (await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }) as never,
    )) as { Errors?: { Key?: string; Message?: string }[] };
    if (res.Errors?.length) {
      throw new Error(`Could not delete ${res.Errors.length} object(s) under ${prefix}: ${res.Errors[0]?.Message ?? 'unknown error'}`);
    }
    removed += keys.length;
  }
  throw new Error(`Objects under ${prefix} kept reappearing`);
}

// ── Local fallback ──────────────────────────────────────────────────────

/** Where the local fallback keeps an org's files: `<root>/orgs/<org_id>/`. */
export function localOrgDir(orgId: string, root: string = path.join(process.cwd(), 'data')): string {
  const dir = path.resolve(root, 'orgs', orgId.toLowerCase());
  // orgPrefix validated the id; this keeps the resolved path inside `<root>/orgs/` regardless.
  if (!dir.startsWith(path.resolve(root, 'orgs') + path.sep)) throw new Error('Invalid organization id');
  return dir;
}

function walk(dir: string, base: string, out: StoredObject[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else {
      const st = fs.statSync(full);
      out.push({ key: path.relative(base, full).split(path.sep).join('/'), size: st.size, lastModified: st.mtime.toISOString() });
    }
  }
}

export function listLocalOrgObjects(orgId: string, root?: string): StoredObject[] {
  const base = root ?? path.join(process.cwd(), 'data');
  const out: StoredObject[] = [];
  walk(localOrgDir(orgId, root), base, out);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function deleteLocalOrgObjects(orgId: string, root?: string): number {
  const dir = localOrgDir(orgId, root);
  const count = listLocalOrgObjects(orgId, root).length;
  fs.rmSync(dir, { recursive: true, force: true });
  if (fs.existsSync(dir)) throw new Error('Could not remove the local files of the organization');
  return count;
}

// ── What the routes call ────────────────────────────────────────────────

/** The org's stored objects: every configured bucket, or the local directory without R2. */
export async function listOrgObjects(orgId: string): Promise<StoredObject[]> {
  const prefix = orgPrefix(orgId);
  if (!isR2Configured()) return listLocalOrgObjects(orgId);
  const lists = await Promise.all(orgBuckets().map((b) => listPrefix(r2, b, prefix)));
  return lists.flat().sort((a, b) => a.key.localeCompare(b.key));
}

/** Empty the org's prefix everywhere it can be. Throws if anything could not be removed. */
export async function deleteOrgObjects(orgId: string): Promise<number> {
  const prefix = orgPrefix(orgId);
  if (!isR2Configured()) return deleteLocalOrgObjects(orgId);
  let removed = 0;
  for (const bucket of orgBuckets()) removed += await deletePrefix(r2, bucket, prefix);
  return removed;
}
