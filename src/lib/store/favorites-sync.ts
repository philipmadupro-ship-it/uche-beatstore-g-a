/**
 * Reconciling this browser's wishlist with a signed-in buyer's account
 * favourites (`buyer_favorites`, mig 060).
 *
 * The wishlist is local-first so a guest can heart beats without an account.
 * Once the device has a buyer identity, the account is the copy that
 * survives a refresh, a sign-out/in and a second device — but nothing ever
 * read it back, so a heart saved on the laptop showed empty on the phone, and
 * tapping it there "favorited" a beat the account already held.
 *
 * Merge, never replace: the account's hearts appear locally, and hearts
 * made on this device before signing in are pushed up rather than dropped.
 * Pure so the rule is tested without a browser.
 */
export interface FavoritesReconciliation {
  /** What the local wishlist should hold after the merge. */
  ids: string[];
  /** Local-only hearts the account does not have yet. */
  toPush: string[];
}

export function reconcileFavorites(
  localIds: readonly string[],
  accountIds: readonly string[],
): FavoritesReconciliation {
  const account = new Set(accountIds);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of [...localIds, ...accountIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const toPush = [...new Set(localIds)].filter((id) => !account.has(id));
  return { ids, toPush };
}
