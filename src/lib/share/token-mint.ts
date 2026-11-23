import { newShareToken } from '@/lib/share/token-access';

/**
 * Collision-safe writes of a public token.
 *
 * `share_links.token`, `project_shares.token` and `artist_portals.token` are
 * each UNIQUE, but one URL token is looked up across all three
 * (`resolveShareToken`), so migration 202 also refuses a token that exists in
 * a sibling table. Either refusal is Postgres 23505. Before this, a same-table
 * clash was a raw 500; now the write is retried with a fresh token.
 *
 * supabase-js RESOLVES with `{ error }` instead of throwing, so the check reads
 * the result. Only a 23505 on a TOKEN constraint is retried: a 23505 on any
 * other constraint (e.g. artist_portals' unique contact_id) is a different
 * problem and goes back to the caller untouched.
 */

/** The constraints whose 23505 means "this token is taken". Exact names, no substring guess. */
export const TOKEN_CONSTRAINTS: readonly string[] = [
  'share_links_token_key',
  'project_shares_token_key',
  'artist_portals_token_key',
  // Raised by migration 202's cross-table trigger.
  'share_token_cross_table_unique',
];

export const TOKEN_MINT_ATTEMPTS = 3;
export const TOKEN_MINT_FAILED_MESSAGE = 'Could not create a link, try again';

interface PgErrorLike {
  code?: string;
  message?: string;
  details?: string;
  constraint?: string;
}

/** The constraint a unique violation names: node-pg's field, else the quoted name PostgREST puts in `message`. */
function constraintOf(error: PgErrorLike): string | null {
  if (typeof error.constraint === 'string' && error.constraint) return error.constraint;
  for (const text of [error.message, error.details]) {
    const m = typeof text === 'string' ? /constraint "([^"]+)"/.exec(text) : null;
    if (m) return m[1];
  }
  return null;
}

/** True only for a unique violation on one of the token constraints. */
export function isTokenCollision(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as PgErrorLike;
  if (e.code !== '23505') return false;
  const name = constraintOf(e);
  return name !== null && TOKEN_CONSTRAINTS.includes(name);
}

export class TokenMintError extends Error {
  constructor() {
    super(TOKEN_MINT_FAILED_MESSAGE);
    this.name = 'TokenMintError';
  }
}

/**
 * Run `write(token)` with a freshly minted token, minting again while it fails
 * with a token collision. Returns the write's own result plus the token that
 * went in (the caller builds its URL from THAT, not from a token minted
 * earlier). Any other error is returned as is. After `attempts` collisions it
 * throws `TokenMintError` ("Could not create a link, try again").
 *
 * Works for an insert and for an update that rotates the token.
 */
export async function withFreshToken<R extends { error: unknown }>(
  write: (token: string) => PromiseLike<R>,
  opts: { attempts?: number; mint?: () => string } = {},
): Promise<R & { token: string }> {
  const attempts = opts.attempts ?? TOKEN_MINT_ATTEMPTS;
  const mint = opts.mint ?? newShareToken;
  for (let i = 0; i < attempts; i++) {
    const token = mint();
    const result = await write(token);
    if (!isTokenCollision(result.error)) return { ...result, token };
  }
  throw new TokenMintError();
}

/** Same thing, named for the token-rotating UPDATE (`reissue`). */
export const updateWithFreshToken = withFreshToken;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Insert `buildRow(token)` into `table`, retrying on a token collision. For a
 * route that also needs the playback-column fallback, use `withFreshToken`
 * around its `writeWithPlayback` call instead.
 */
export function insertWithFreshToken(
  admin: Admin,
  table: 'share_links' | 'project_shares' | 'artist_portals',
  buildRow: (token: string) => Record<string, unknown>,
  opts: { attempts?: number; select?: string; mint?: () => string } = {},
) {
  return withFreshToken(
    (token) => admin.from(table).insert(buildRow(token)).select(opts.select ?? '*').single() as PromiseLike<{ data: unknown; error: unknown }>,
    opts,
  );
}
