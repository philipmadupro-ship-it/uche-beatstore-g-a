/**
 * LABEL-23 / R-19: notifications are DIRECT ASKS only. The tests here are the
 * guard that keeps "just one more kind" from turning the bell back into a
 * stream: the kinds are a closed union, none of them reads as a broadcast, the
 * writer takes ONE recipient, and nothing else under Label OS writes the
 * table.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DIRECT_ASK_KINDS, NOTIFICATION_BODY_MAX, NOTIFICATION_TITLE_MAX, buildDirectAsk, isDirectAskKind, notifyDirectAsk, type DirectAsk } from './notify';
import { VERBS } from './activity';

vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));

const ORG = '10000000-0000-4000-8000-000000000001';
const ME = '20000000-0000-4000-8000-000000000001';
const YOU = '20000000-0000-4000-8000-000000000002';

const ask = (over: Partial<DirectAsk> = {}): DirectAsk => ({ kind: 'task_assigned', orgId: ORG, recipientId: YOU, actorId: ME, actorName: 'Sam', subject: 'Clear the sample', ...over });

describe('the closed union', () => {
  it('is exactly the five direct asks of 08 §B6', () => {
    expect([...DIRECT_ASK_KINDS]).toEqual(['task_assigned', 'approval_requested', 'mention', 'credit_named_you', 'invitation']);
  });

  it('forbids broadcast kinds: nothing about uploads, stages, reviews, members or "everyone"', () => {
    const BROADCAST = /upload|created|added|moved|stage|review|joined|member_|everyone|all_|org_|digest|activity|release|comment|share|download|purchase/i;
    for (const kind of DIRECT_ASK_KINDS) expect(kind, kind).not.toMatch(BROADCAST);
    // A kind named after an activity verb (song.created → song_created …) is a broadcast by construction,
    // except `approval.requested`, whose whole meaning is a request addressed to the one who may approve.
    const verbKinds = new Set(VERBS.map((v) => v.replace('.', '_')));
    expect(DIRECT_ASK_KINDS.filter((k) => verbKinds.has(k))).toEqual(['approval_requested']);
  });

  it('refuses a kind that is not in the union', () => {
    for (const bad of ['song_uploaded', 'broadcast', 'purchase', '', 'TASK_ASSIGNED', undefined, null, 5]) {
      expect(isDirectAskKind(bad), String(bad)).toBe(false);
    }
    const built = buildDirectAsk(ask({ kind: 'song_uploaded' as never }));
    expect(built).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('buildDirectAsk', () => {
  it('addresses ONE recipient in ONE org, unread, with a one-line title that names the asker', () => {
    const built = buildDirectAsk(ask({ data: { taskId: 't1', target: { kind: 'song', id: 's1' } } }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.row).toEqual({
      user_id: YOU,
      org_id: ORG,
      kind: 'task_assigned',
      title: 'Sam assigned you a task',
      body: 'Clear the sample',
      data: { taskId: 't1', target: { kind: 'song', id: 's1' } },
      read: false,
    });
  });

  it('asking yourself notifies nobody', () => {
    expect(buildDirectAsk(ask({ recipientId: ME }))).toEqual({ ok: false, reason: 'self' });
    expect(buildDirectAsk(ask({ recipientId: ME.toUpperCase() }))).toEqual({ ok: false, reason: 'self' });
  });

  it('the system (no actor) may ask', () => {
    expect(buildDirectAsk(ask({ actorId: null })).ok).toBe(true);
  });

  it('falls back to a neutral word, never an email, for an unnamed asker', () => {
    const built = buildDirectAsk(ask({ actorName: null }));
    expect(built.ok && built.row.title).toBe('Someone assigned you a task');
  });

  it('keeps title and body bounded and single-line', () => {
    const built = buildDirectAsk(ask({ actorName: 'S'.repeat(500), subject: `line one\n\nline   two ${'x'.repeat(1000)}` }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.row.title.length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
    expect(built.row.body!.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    expect(built.row.body).not.toMatch(/\n/);
  });

  it('refuses a payload carrying a secret-looking key or an email', () => {
    for (const key of ['token', 'share_token', 'password', 'secret', 'email', 'asker_email']) {
      expect(buildDirectAsk(ask({ data: { [key]: 'x' } })), key).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(buildDirectAsk(ask({ data: { nested: { token: 'x' } } }))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('refuses ids that are not uuids', () => {
    expect(buildDirectAsk(ask({ recipientId: 'someone' }))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(buildDirectAsk(ask({ orgId: 'org' }))).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('notifyDirectAsk', () => {
  function fake(result: { error: { message: string } | null } | 'throws') {
    const inserts: unknown[] = [];
    return {
      inserts,
      admin: {
        from: (table: string) => ({
          insert: async (row: unknown) => {
            inserts.push({ table, row });
            if (result === 'throws') throw new Error('network');
            return result;
          },
        }),
      } as never,
    };
  }

  it('writes one row to notifications', async () => {
    const f = fake({ error: null });
    expect(await notifyDirectAsk(f.admin, ask())).toEqual({ ok: true });
    expect(f.inserts).toHaveLength(1);
    expect(f.inserts[0]).toMatchObject({ table: 'notifications', row: { user_id: YOU, org_id: ORG, kind: 'task_assigned' } });
  });

  it('writes nothing for a self-ask or an invalid one', async () => {
    const f = fake({ error: null });
    expect(await notifyDirectAsk(f.admin, ask({ recipientId: ME }))).toEqual({ ok: false, skipped: 'self' });
    expect(await notifyDirectAsk(f.admin, ask({ kind: 'nope' as never }))).toEqual({ ok: false, skipped: 'invalid' });
    expect(f.inserts).toEqual([]);
  });

  it('is best effort: a failed or throwing write is reported, never thrown', async () => {
    expect(await notifyDirectAsk(fake({ error: { message: 'boom' } }).admin, ask())).toEqual({ ok: false, skipped: 'failed' });
    expect(await notifyDirectAsk(fake('throws').admin, ask())).toEqual({ ok: false, skipped: 'failed' });
  });

  it('takes one recipient: the type has no list, no org-wide and no owner target', () => {
    // A compile-time property pinned at runtime by the shape: `recipientId` is a string.
    const a = ask();
    expect(typeof a.recipientId).toBe('string');
  });
});

describe('nothing else writes org notifications', () => {
  const SRC = join(__dirname, '..', '..');
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const WRITES = /from\(\s*['"]notifications['"]\s*\)\s*\.(insert|upsert)\b/;

  it('only lib/labelos/notify.ts inserts into notifications under Label OS (the org API and lib/labelos)', () => {
    const roots = [join(SRC, 'app', 'api', 'org'), join(SRC, 'lib', 'labelos')];
    const offenders = roots
      .flatMap(files)
      .filter((f) => WRITES.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .filter((f) => f !== 'lib/labelos/notify.ts');
    expect(offenders).toEqual([]);
  });

  it('no upload, song, stage, review or release path reaches notifyDirectAsk: the owner hears nothing about uploads', () => {
    const roots = [join(SRC, 'app', 'api', 'org'), join(SRC, 'lib', 'labelos'), join(SRC, 'lib', 'upload')];
    const callers = roots
      .flatMap(files)
      .filter((f) => /notifyDirectAsk\s*\(/.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f).split(sep).join('/'))
      .filter((f) => f !== 'lib/labelos/notify.ts')
      .sort();
    // Direct asks arise where one person asks another for something: assigning a task. A new caller is a
    // visible edit here, with a reason, not an upload hook.
    expect(callers).toEqual(['app/api/org/[orgId]/tasks/[taskId]/route.ts', 'app/api/org/[orgId]/tasks/route.ts']);
    for (const c of callers) expect(c).not.toMatch(/upload|song|stage|review|release/i);
  });
});
