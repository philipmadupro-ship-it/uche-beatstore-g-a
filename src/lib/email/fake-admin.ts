/**
 * Test-only PostgREST stand-in for the email routes' parity tests: real `eq`
 * and `in` filtering over in-memory tables, `count`/`head`, thenable results.
 */
type Row = Record<string, unknown>;

export function fakeAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let head = false;
      let wantCount = false;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const q: Record<string, unknown> = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          head = !!opts?.head; wantCount = !!opts?.count; return q;
        },
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return q; },
        in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return q; },
        order: () => q,
        update: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: head ? null : rows(), count: wantCount ? rows().length : null, error: null }),
      };
      return q;
    },
  };
}
