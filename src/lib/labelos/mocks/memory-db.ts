/**
 * A small in-memory stand-in for the service-role supabase-js client that
 * actually EVALUATES filters, for route tests that run the real
 * `lib/auth/org-access` (membership, capabilities, artist scope) against
 * several orgs at once. Unlike `fake-admin`, which records a chain and lets
 * the test answer it, a wrong or missing filter here returns the wrong rows,
 * so cross-org and out-of-scope leaks show up as failing assertions.
 *
 * Supports what the Label OS routes use: select (column lists, one
 * `table!inner(cols)` embed resolved through `org_id` for organizations,
 * else `<table singular>_id`), eq, in,
 * is, gt / gte / lt / lte (string order, which is ISO-timestamp order), `or` (the
 * PostgREST string: eq, in, is, not.is and and(…) groups), not(col, 'in', '(…)'), order, limit, range, maybeSingle, single, insert,
 * update, delete, upsert (ignoreDuplicates; `onConflict` merges into the row it names), rpc (functions the test
 * declares in `rpc`, run against the same tables). Unique keys per table are
 * declared by the test and answered with Postgres' 23505. `order` compares
 * numbers as numbers.
 */
import { randomUUID } from 'node:crypto';

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Err = { message: string; code?: string };

export type MemoryDb = {
  tables: Record<string, Row[]>;
  /** PostgREST's `max-rows`: a select never returns more than this, silently (the cap a paging read must survive). */
  maxRows?: number;
  /** column lists that must be unique per table, e.g. { contacts: [['org_id', 'email']] } */
  unique?: Record<string, string[][]>;
  /** Database functions for `.rpc(name, args)`: answer like PostgREST would. */
  rpc?: Record<string, (args: Record<string, unknown>, tables: Record<string, Row[]>) => { data: unknown; error: Err | null }>;
};

const EMBED = /^(\w+)!inner\(([^)]*)\)$/;

function splitColumns(columns: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of columns) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function pick(row: Row, cols: string[]): Row {
  if (cols.length === 1 && cols[0] === '*') return { ...row };
  const out: Row = {};
  for (const c of cols) out[c] = row[c] ?? null;
  return out;
}

type OrTest = (row: Row, lower: (v: unknown) => unknown) => boolean;

/** Split on commas that are not inside parentheses. */
function splitTop(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function parseOr(expr: string): OrTest {
  const terms = splitTop(expr).map((t): OrTest => {
    const and = t.match(/^and\((.*)\)$/);
    if (and) {
      const parts = splitTop(and[1]).map(parseOr);
      return (r, l) => parts.every((p) => p(r, l));
    }
    const m = t.match(/^(\w+)\.(not\.)?(eq|in|is|lt|lte|gt|gte)\.(.*)$/);
    if (!m) throw new Error(`memory-db: or(${t}) unsupported`);
    const [, col, neg, op, arg] = m;
    let test: OrTest;
    if (op === 'eq') test = (r, l) => l(r[col]) === l(arg);
    else if (op === 'in') {
      const set = new Set(arg.replace(/^\(|\)$/g, '').split(',').map((v) => v.trim().toLowerCase()));
      test = (r, l) => set.has(String(l(r[col])));
    } else if (op === 'is') test = (r) => (r[col] ?? null) === (arg === 'null' ? null : arg);
    else {
      const cmp = (r: Row) => {
        const a = String(r[col] ?? '');
        return a < arg ? -1 : a > arg ? 1 : 0; // code-unit order, as Postgres compares ISO timestamps and lower-case uuids
      };
      test = op === 'lt' ? (r) => r[col] != null && cmp(r) < 0 : op === 'lte' ? (r) => r[col] != null && cmp(r) <= 0 : op === 'gt' ? (r) => r[col] != null && cmp(r) > 0 : (r) => r[col] != null && cmp(r) >= 0;
    }
    return neg ? (r, l) => !test(r, l) : test;
  });
  return (r, l) => terms.some((t) => t(r, l));
}

export function memoryAdmin(db: MemoryDb) {
  const writes: { table: string; op: string; rows: Row[] }[] = [];

  function violates(table: string, candidate: Row, ignore: Row | null): boolean {
    for (const key of db.unique?.[table] ?? []) {
      if (key.some((k) => candidate[k] === null || candidate[k] === undefined)) continue;
      if ((db.tables[table] ?? []).some((r) => r !== ignore && key.every((k) => r[k] === candidate[k]))) return true;
    }
    return false;
  }

  function from(table: string) {
    const filters: Filter[] = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let columns = '*';
    let payload: Row[] = [];
    let patch: Row = {};
    let ignoreDuplicates = false;
    let conflictCols: string[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let limit: number | null = null;
    let offset = 0;
    let returning = false;

    const rowsOf = () => (db.tables[table] ??= []);

    function project(rows: Row[]): Row[] {
      const cols = splitColumns(columns);
      const plain = cols.filter((c) => !EMBED.test(c));
      const embeds = cols.map((c) => c.match(EMBED)).filter((m): m is RegExpMatchArray => !!m);
      const out: Row[] = [];
      for (const row of rows) {
        const base = pick(row, plain.length ? plain : ['*']);
        let keep = true;
        for (const [, other, inner] of embeds) {
          // org_members.org_id → organizations; otherwise <singular>_id.
          const fk = other === 'organizations' ? 'org_id' : `${other.replace(/s$/, '')}_id`;
          const target = (db.tables[other] ?? []).find((r) => r.id === row[fk]);
          if (!target) keep = false;
          else base[other] = pick(target, splitColumns(inner));
        }
        if (keep) out.push(base);
      }
      return out;
    }

    function run(): { data: unknown; error: Err | null } {
      const matching = rowsOf().filter((r) => filters.every((f) => f(r)));
      if (mode === 'select') {
        let rows = [...matching];
        if (orders.length > 0) {
          const cmp = (x: unknown, y: unknown) =>
            typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
          // Chained `.order()` calls break ties in call order, as PostgREST does.
          rows.sort((a, b) => {
            for (const { col, asc } of orders) {
              const c = cmp(a[col], b[col]) * (asc ? 1 : -1);
              if (c !== 0) return c;
            }
            return 0;
          });
        }
        if (limit !== null || offset > 0) rows = rows.slice(offset, limit === null ? undefined : offset + limit);
        if (db.maxRows) rows = rows.slice(0, db.maxRows);
        return { data: project(rows), error: null };
      }
      if (mode === 'insert' || mode === 'upsert') {
        const added: Row[] = [];
        for (const raw of payload) {
          // `onConflict` + a row already holding those columns: DO UPDATE, as PostgREST's merge-duplicates does.
          if (mode === 'upsert' && !ignoreDuplicates && conflictCols.length > 0) {
            const existing = rowsOf().find((r) => conflictCols.every((c) => r[c] === raw[c]));
            if (existing) {
              Object.assign(existing, raw);
              writes.push({ table, op: 'upsert', rows: [existing] });
              added.push(existing);
              continue;
            }
          }
          const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), ...raw };
          if (violates(table, row, null)) {
            if (mode === 'upsert' && ignoreDuplicates) continue;
            return { data: null, error: { message: `duplicate key value violates unique constraint on ${table}`, code: '23505' } };
          }
          rowsOf().push(row);
          added.push(row);
        }
        writes.push({ table, op: mode, rows: added });
        return { data: returning ? project(added) : null, error: null };
      }
      if (mode === 'update') {
        for (const row of matching) {
          const next = { ...row, ...patch };
          if (violates(table, next, row)) {
            return { data: null, error: { message: `duplicate key value violates unique constraint on ${table}`, code: '23505' } };
          }
        }
        for (const row of matching) Object.assign(row, patch);
        writes.push({ table, op: 'update', rows: matching });
        return { data: returning ? project(matching) : null, error: null };
      }
      // delete
      db.tables[table] = rowsOf().filter((r) => !matching.includes(r));
      writes.push({ table, op: 'delete', rows: matching });
      return { data: returning ? project(matching) : null, error: null };
    }

    const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : v);
    const b = {
      select(cols = '*') {
        columns = cols;
        if (mode !== 'select') returning = true;
        return b;
      },
      insert(rows: Row | Row[]) {
        mode = 'insert';
        payload = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      upsert(rows: Row | Row[], opts?: { ignoreDuplicates?: boolean; onConflict?: string }) {
        mode = 'upsert';
        conflictCols = opts?.onConflict ? opts.onConflict.split(',').map((c) => c.trim()) : [];
        payload = Array.isArray(rows) ? rows : [rows];
        ignoreDuplicates = !!opts?.ignoreDuplicates;
        return b;
      },
      update(p: Row) {
        mode = 'update';
        patch = p;
        return b;
      },
      delete() {
        mode = 'delete';
        return b;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => lower(r[col]) === lower(v));
        return b;
      },
      in(col: string, values: unknown[]) {
        const set = new Set(values.map(lower));
        filters.push((r) => set.has(lower(r[col])));
        return b;
      },
      is(col: string, v: null) {
        filters.push((r) => (r[col] ?? null) === v);
        return b;
      },
      gt(col: string, v: unknown) {
        filters.push((r) => String(r[col] ?? '') > String(v));
        return b;
      },
      gte(col: string, v: unknown) {
        filters.push((r) => String(r[col] ?? '') >= String(v));
        return b;
      },
      lt(col: string, v: unknown) {
        filters.push((r) => String(r[col] ?? '') < String(v));
        return b;
      },
      lte(col: string, v: unknown) {
        filters.push((r) => String(r[col] ?? '') <= String(v));
        return b;
      },
      /** PostgREST's `or=(…)` string: `col.eq.v`, `col.in.(a,b)`, `col.is.null`, `col.not.is.null`, and `and(…)` groups. */
      or(expr: string) {
        // The real thing answers 42703 ("column … does not exist"); a mock that quietly accepted it hid that once (LABEL-20).
        if (mode === 'update') throw new Error('memory-db: PostgREST rejects or= on a PATCH — use plain filters');
        const f = parseOr(expr);
        filters.push((r) => f(r, lower));
        return b;
      },
      not(col: string, op: string, list: string) {
        if (op !== 'in') throw new Error(`memory-db: not.${op} unsupported`);
        const set = new Set(list.replace(/^\(|\)$/g, '').split(',').map((v) => v.trim().toLowerCase()));
        filters.push((r) => !set.has(String(lower(r[col]))));
        return b;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending !== false });
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      range(from: number, to: number) {
        offset = from;
        limit = to - from + 1;
        return b;
      },
      async maybeSingle() {
        const r = run();
        if (r.error) return r;
        const rows = r.data as Row[] | null;
        return { data: rows?.[0] ?? null, error: null };
      },
      async single() {
        const r = run();
        if (r.error) return r;
        const rows = r.data as Row[] | null;
        if (!rows || rows.length !== 1) return { data: null, error: { message: 'expected one row' } };
        return { data: rows[0], error: null };
      },
      then(resolve: (r: { data: unknown; error: Err | null }) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return b;
  }

  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const fn = db.rpc?.[name];
    if (!fn) return { data: null, error: { message: `Could not find the function public.${name} in the schema cache`, code: 'PGRST202' } };
    const result = fn(args, db.tables);
    writes.push({ table: `rpc:${name}`, op: 'rpc', rows: [args] });
    return result;
  }

  return { client: { from, rpc }, writes };
}
