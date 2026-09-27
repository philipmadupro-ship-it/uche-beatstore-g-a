import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * STORE-03: a beat uploaded and listed AFTER the producer has reordered the
 * storefront must be on the first page of `/store`.
 *
 * It was not. The Supabase path ordered "Newest first" by
 * `store_sort_order ASC NULLS LAST` before `created_at`; reordering writes a
 * sort order to every listed beat, a fresh upload has none, so it sorted after
 * all of them and fell off an 80-beat first page. The local-store path never
 * had that rule, which is why `catalog-scale.test.ts` (local store) could not
 * see it — this test drives the Supabase branch through an in-memory
 * PostgREST fake that really applies filters, ordering and ranges.
 */

type Row = Record<string, unknown>;
type Order = { column: string; ascending: boolean; nullsFirst: boolean };

const SELLER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FRESH_ID = 'ffffffff-0000-4000-8000-000000000001';
const DRAFT_ID = 'ffffffff-0000-4000-8000-000000000002';
const FOREIGN_ID = 'ffffffff-0000-4000-8000-000000000003';
const REORDERED = 100;

const tracks: Row[] = [
  // A catalogue the producer has already arranged by hand: every listed beat
  // carries a sort order, as the Store Editor's reorder writes for all of them.
  ...Array.from({ length: REORDERED }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    user_id: SELLER,
    title: `Arranged ${i}`,
    type: 'beat',
    store_listed: true,
    store_sort_order: i,
    audio_url: `r2://private/${i}.wav`,
    preview_url: `https://cdn.example.test/previews/${i}.mp3`,
    cover_url: `https://cdn.example.test/covers/${i}.webp`,
    lease_price_usd: 30,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  })),
  // Uploaded and listed afterwards: no sort order yet.
  {
    id: FRESH_ID,
    user_id: SELLER,
    title: 'Fresh Upload',
    type: 'beat',
    store_listed: true,
    store_sort_order: null,
    audio_url: 'r2://private/fresh.wav',
    preview_url: 'https://cdn.example.test/previews/fresh.mp3',
    cover_url: 'https://cdn.example.test/covers/fresh.webp',
    lease_price_usd: 45,
    created_at: '2026-09-27T10:00:00.000Z',
  },
  // Uploaded but never listed — must stay off the storefront.
  {
    id: DRAFT_ID,
    user_id: SELLER,
    title: 'Unlisted Draft',
    type: 'beat',
    store_listed: false,
    store_sort_order: null,
    created_at: '2026-09-27T11:00:00.000Z',
  },
  // Listed, but another account's — the owner scope must still exclude it.
  {
    id: FOREIGN_ID,
    user_id: OTHER,
    title: 'Someone Else',
    type: 'beat',
    store_listed: true,
    store_sort_order: null,
    created_at: '2026-09-27T12:00:00.000Z',
  },
];

const tables: Record<string, Row[]> = {
  tracks,
  creator_profiles: [{ user_id: SELLER, display_name: 'Producer', license_lease_price_usd: 30 }],
};

function compareBy(orders: Order[]) {
  return (a: Row, b: Row) => {
    for (const { column, ascending, nullsFirst } of orders) {
      const av = a[column];
      const bv = b[column];
      if (av == null && bv == null) continue;
      if (av == null) return nullsFirst ? -1 : 1;
      if (bv == null) return nullsFirst ? 1 : -1;
      if (av === bv) continue;
      const cmp = (av as string | number) < (bv as string | number) ? -1 : 1;
      return ascending ? cmp : -cmp;
    }
    return 0;
  };
}

/** Minimal PostgREST builder: the operators /api/store uses, applied for real. */
class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private filters: Array<(row: Row) => boolean> = [];
  private orders: Order[] = [];
  private from = 0;
  private to = Infinity;
  private head = false;
  private single = false;

  constructor(private readonly table: string) {}

  select(_columns?: string, options?: { head?: boolean }) {
    this.head = Boolean(options?.head);
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  or(expression: string) {
    const clauses = expression.split(',').map((clause) => {
      const [column, op, ...rest] = clause.split('.');
      const value = rest.join('.');
      if (op === 'eq') return (row: Row) => String(row[column]) === value;
      if (op === 'is' && value === 'null') return (row: Row) => row[column] == null;
      throw new Error(`FakeQuery: unsupported or() clause ${clause}`);
    });
    this.filters.push((row) => clauses.some((match) => match(row)));
    return this;
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const ascending = options.ascending ?? true;
    // PostgREST default: NULLS LAST ascending, NULLS FIRST descending.
    this.orders.push({ column, ascending, nullsFirst: options.nullsFirst ?? !ascending });
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  limit(n: number) {
    this.to = this.from + n - 1;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private run() {
    const rows = (tables[this.table] ?? [])
      .filter((row) => this.filters.every((match) => match(row)))
      .sort(compareBy(this.orders));
    const page = rows.slice(this.from, this.to + 1);
    if (this.single) return { data: page[0] ?? null, error: null };
    if (this.head) return { data: null, error: null, count: rows.length };
    return { data: page, error: null };
  }

  then<A = { data: unknown; error: null }, B = never>(
    onFulfilled?: ((value: { data: unknown; error: null; count?: number }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

const fakeAdmin = { from: (table: string) => new FakeQuery(table) };

vi.mock('@/lib/local-store', () => ({
  isSupabaseConfigured: () => true,
  getAll: () => [],
}));
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => fakeAdmin,
  safeSellerId: (id?: string) => id ?? '',
}));

let storeGet: (request: NextRequest) => Promise<Response>;
beforeAll(async () => {
  storeGet = (await import('./route')).GET;
});

type PublicTrack = {
  id: string;
  title: string;
  cover_url: string | null;
  audio_url: string | null;
  preview_url: string | null;
  lease_price_usd: number | null;
};

async function page(cursor?: number) {
  const url = `http://localhost/api/store?limit=80${cursor ? `&cursor=${cursor}` : ''}`;
  const res = await storeGet(new NextRequest(url));
  expect(res.status).toBe(200);
  return (await res.json()) as { tracks: PublicTrack[]; pageInfo: { hasMore: boolean; nextCursor: string | null } };
}

describe('newly listed beat on /store (Supabase path)', () => {
  it('is on the first page after the producer has reordered the catalogue', async () => {
    const first = await page();
    const ids = first.tracks.map((t) => t.id);

    expect(ids[0]).toBe(FRESH_ID);
    expect(ids.filter((id) => id === FRESH_ID)).toHaveLength(1);
  });

  it('carries its own cover, a public audio source and its price', async () => {
    const first = await page();
    const fresh = first.tracks.find((t) => t.id === FRESH_ID)!;

    expect(fresh.title).toBe('Fresh Upload');
    expect(fresh.cover_url).toBe('https://cdn.example.test/covers/fresh.webp');
    expect(fresh.lease_price_usd).toBe(45);
    // Redacted to the public preview derivative — never the private master.
    expect(fresh.audio_url).toBeTruthy();
    expect(fresh.audio_url).not.toContain('r2://');
    expect(fresh.preview_url).toBeNull();
  });

  it('pages the whole listed catalogue exactly once, without drafts or other owners', async () => {
    const seen: string[] = [];
    let cursor: number | undefined;
    for (;;) {
      const next = await page(cursor);
      seen.push(...next.tracks.map((t) => t.id));
      if (!next.pageInfo.hasMore) break;
      cursor = Number(next.pageInfo.nextCursor);
    }

    expect(seen).toHaveLength(REORDERED + 1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toContain(FRESH_ID);
    expect(seen).not.toContain(DRAFT_ID);
    expect(seen).not.toContain(FOREIGN_ID);
  });
});
