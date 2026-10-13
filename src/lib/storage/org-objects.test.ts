import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteLocalOrgObjects,
  deletePrefix,
  listLocalOrgObjects,
  listPrefix,
  localOrgDir,
  orgPrefix,
} from './org-objects';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** A bucket as a Map: List honours Prefix, MaxKeys and continuation; Delete removes. */
function fakeS3(initial: string[], opts: { failDelete?: boolean; pageSize?: number } = {}) {
  const keys = new Set(initial);
  const calls: string[] = [];
  const client = {
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = cmd.constructor.name;
      calls.push(name);
      if (name === 'ListObjectsV2Command') {
        const prefix = String(cmd.input.Prefix ?? '');
        const all = [...keys].filter((k) => k.startsWith(prefix)).sort();
        const size = Math.min(Number(cmd.input.MaxKeys ?? opts.pageSize ?? 1000), opts.pageSize ?? 1000);
        const start = cmd.input.ContinuationToken ? Number(cmd.input.ContinuationToken) : 0;
        const slice = all.slice(start, start + size);
        const more = start + size < all.length;
        return {
          Contents: slice.map((Key) => ({ Key, Size: 3, LastModified: new Date('2026-10-01T00:00:00Z') })),
          IsTruncated: more,
          NextContinuationToken: more ? String(start + size) : undefined,
        };
      }
      if (name === 'DeleteObjectsCommand') {
        if (opts.failDelete) return { Errors: [{ Key: 'x', Message: 'AccessDenied' }] };
        for (const o of (cmd.input.Delete as { Objects: { Key: string }[] }).Objects) keys.delete(o.Key);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  return { client, keys, calls };
}

describe('orgPrefix', () => {
  it('is orgs/<id>/ with a trailing slash, lowercased', () => {
    expect(orgPrefix(ORG.toUpperCase())).toBe(`orgs/${ORG}/`);
  });
  it('refuses anything that is not a UUID', () => {
    for (const bad of ['', '../x', 'orgs', `${ORG}/..`, '*']) expect(() => orgPrefix(bad)).toThrow();
  });
});

describe('listPrefix / deletePrefix', () => {
  const seed = [
    `orgs/${ORG}/tracks/a.wav`,
    `orgs/${ORG}/previews/a.mp3`,
    `orgs/${ORG}/assets/p/x.png`,
    `orgs/${ORG}2/tracks/b.wav`, // look-alike id, no slash boundary
    `orgs/${OTHER}/tracks/c.wav`,
    'uploads/producer-master.wav',
  ];

  it('lists only the org’s keys, across pages', async () => {
    const { client } = fakeS3(seed, { pageSize: 2 });
    const objects = await listPrefix(client, 'priv', orgPrefix(ORG));
    expect(objects.map((o) => o.key)).toEqual([`orgs/${ORG}/assets/p/x.png`, `orgs/${ORG}/previews/a.mp3`, `orgs/${ORG}/tracks/a.wav`]);
  });

  it('deletes the org’s objects, and no one else’s', async () => {
    const { client, keys } = fakeS3(seed, { pageSize: 2 });
    const removed = await deletePrefix(client, 'priv', orgPrefix(ORG));
    expect(removed).toBe(3);
    expect([...keys].sort()).toEqual([`orgs/${ORG}2/tracks/b.wav`, `orgs/${OTHER}/tracks/c.wav`, 'uploads/producer-master.wav'].sort());
  });

  it('is a no-op for a prefix that is already empty', async () => {
    const { client, calls } = fakeS3(['uploads/a.wav']);
    expect(await deletePrefix(client, 'priv', orgPrefix(ORG))).toBe(0);
    expect(calls).toEqual(['ListObjectsV2Command']);
  });

  it('throws when the store refuses a delete, so the caller keeps the rows', async () => {
    const { client, keys } = fakeS3(seed, { failDelete: true });
    await expect(deletePrefix(client, 'priv', orgPrefix(ORG))).rejects.toThrow(/AccessDenied/);
    expect(keys.size).toBe(seed.length);
  });
});

describe('local fallback', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });
  function root() {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'org-objects-'));
    roots.push(r);
    return r;
  }
  const put = (r: string, key: string) => {
    fs.mkdirSync(path.dirname(path.join(r, key)), { recursive: true });
    fs.writeFileSync(path.join(r, key), 'abc');
  };

  it('lists and removes data/orgs/<id>/ and leaves everything else', () => {
    const r = root();
    put(r, `orgs/${ORG}/assets/p/a.png`);
    put(r, `orgs/${ORG}/tracks/b.wav`);
    put(r, `orgs/${OTHER}/assets/p/c.png`);
    put(r, 'project-assets/producer.pdf');
    expect(listLocalOrgObjects(ORG, r).map((o) => o.key)).toEqual([`orgs/${ORG}/assets/p/a.png`, `orgs/${ORG}/tracks/b.wav`]);
    expect(deleteLocalOrgObjects(ORG, r)).toBe(2);
    expect(fs.existsSync(path.join(r, 'orgs', ORG))).toBe(false);
    expect(fs.existsSync(path.join(r, 'orgs', OTHER, 'assets/p/c.png'))).toBe(true);
    expect(fs.existsSync(path.join(r, 'project-assets/producer.pdf'))).toBe(true);
  });

  it('nothing to remove is fine', () => {
    expect(deleteLocalOrgObjects(ORG, root())).toBe(0);
  });

  it('refuses a path that escapes', () => {
    expect(() => localOrgDir('../../etc', root())).toThrow();
  });
});
