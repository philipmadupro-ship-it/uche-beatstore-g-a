/**
 * A chainable stand-in for the service-role supabase-js client, for Label OS
 * route tests. Every `.from(table)` chain records its operations; awaiting it
 * (or `.single()` / `.maybeSingle()`) asks `answer(table, ops)` for the
 * result. `.rpc(name, args)` asks `rpc(name, args)`.
 */
export type Op = { op: string; args: unknown[] };
export type Chain = { table: string; ops: Op[] };
export type Answer = { data: unknown; error: { message: string; code?: string } | null };

export function fakeAdmin(handlers: {
  answer: (chain: Chain) => Answer;
  rpc?: (name: string, args: Record<string, unknown>) => Answer;
}) {
  const chains: Chain[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];

  function from(table: string) {
    const chain: Chain = { table, ops: [] };
    chains.push(chain);
    const settle = () => Promise.resolve(handlers.answer(chain));
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'is', 'gt', 'lt', 'in', 'limit', 'order']) {
      builder[op] = (...args: unknown[]) => {
        chain.ops.push({ op, args });
        return builder;
      };
    }
    builder.single = () => {
      chain.ops.push({ op: 'single', args: [] });
      return settle();
    };
    builder.maybeSingle = () => {
      chain.ops.push({ op: 'maybeSingle', args: [] });
      return settle();
    };
    builder.then = (resolve: (v: Answer) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
    return builder;
  }

  const client = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return handlers.rpc ? handlers.rpc(name, args) : { data: null, error: { message: 'no rpc' } };
    },
  };
  return { client, chains, rpcs };
}

/** The first op of a kind in a chain, e.g. `opOf(chain, 'insert')`. */
export function opOf(chain: Chain, op: string): Op | undefined {
  return chain.ops.find((o) => o.op === op);
}

/** `.eq(col, value)` filters of a chain, as an object. */
export function eqs(chain: Chain): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of chain.ops) if (o.op === 'eq') out[String(o.args[0])] = o.args[1];
  return out;
}
