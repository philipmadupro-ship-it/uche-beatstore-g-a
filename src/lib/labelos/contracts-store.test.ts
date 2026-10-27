import { describe, expect, it } from 'vitest';
import type { AdminClient } from '@/lib/auth/ownership';
import { ContractsNotReadyError, identitiesOf, isMissingContractsSchema } from './contracts-store';

/** A chain that answers every builder call and resolves to `result` at `.range()`. */
function failing(code: string): AdminClient {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
  chain.range = async () => ({ data: null, error: { message: 'boom', code } });
  return { from: () => chain } as unknown as AdminClient;
}

describe('contracts-store schema detection', () => {
  it('only a missing relation or function means "not set up"', () => {
    for (const code of ['PGRST205', '42P01', 'PGRST202', '42883']) expect(isMissingContractsSchema({ message: 'x', code })).toBe(true);
    for (const code of ['42703', 'PGRST204', '23505', undefined]) expect(isMissingContractsSchema({ message: 'x', code })).toBe(false);
  });

  it('a database without migration 174 (parties.address) is "not set up" (503), not a 500', async () => {
    await expect(identitiesOf(failing('42703'), 'o', ['p1'])).rejects.toBeInstanceOf(ContractsNotReadyError);
  });

  it('any other read failure stays an error', async () => {
    await expect(identitiesOf(failing('XX000'), 'o', ['p1'])).rejects.not.toBeInstanceOf(ContractsNotReadyError);
  });
});
