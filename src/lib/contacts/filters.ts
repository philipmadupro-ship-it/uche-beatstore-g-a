/**
 * Pure filter + sort for the contacts CRM. Extracted from ContactsView so the
 * logic is testable in isolation (CLAUDE.md: logic inside components gets
 * silently reverted). Adds tag-based filtering on top of the existing
 * category / engagement / search / sort behaviour.
 */

export interface ContactTag { tag: string; category?: string | null }
export interface ContactLike {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  label?: string | null;
  category?: string | null;
  created_at?: string;
  crm_status?: string | null;
  tags?: ContactTag[];
}

export type ContactCategoryFilter = 'all' | 'buyers' | 'rappers' | 'producers' | 'a&r' | 'friends' | 'nudge';
export type ContactStatusFilter = 'all' | 'active' | 'engaged' | 'cold';
export type ContactSortMode = 'recent' | 'name' | 'category' | 'lastSent' | 'sends' | 'lead' | 'stage' | 'revenue' | 'tags';

/** Pipeline order for the 'stage' sort — furthest along first when descending. */
const STAGE_RANK: Record<string, number> = { archived: 0, cold: 1, prospect: 2, active: 3, engaged: 4, customer: 5 };
export type SortDir = 'asc' | 'desc';

export interface ContactFilterState {
  search: string;
  category: ContactCategoryFilter;
  status: ContactStatusFilter;
  sort: ContactSortMode;
  /** Direction for the active sort column. Default 'desc'. */
  sortDir?: SortDir;
  tags: Set<string>;
}

export interface ContactFilterContext {
  /** Map contactId → ISO timestamp of most recent send (or undefined). */
  lastSentByContact: Map<string, string>;
  /** Set of contactIds whose most recent send needs a nudge. */
  needsNudgeIds: Set<string>;
  /** Map contactId → number of sends. Required for the 'sends' sort. */
  sendCountByContact?: Map<string, number>;
  /** Map contactId → lead score (0–100). Required for the 'lead' sort. */
  leadScoreByContact?: Map<string, number>;
  /** Map contactId → lifetime revenue (USD). Required for the 'revenue' sort. */
  revenueByContact?: Map<string, number>;
}

/** True when a contact matches the given category segment (role-aware). */
export function matchesCategory(c: ContactLike, category: ContactCategoryFilter, needsNudgeIds: Set<string>): boolean {
  if (category === 'all') return true;
  if (category === 'nudge') return needsNudgeIds.has(c.id);
  const cat = c.category?.toLowerCase() || '';
  const role = c.role?.toLowerCase() || '';
  switch (category) {
    case 'buyers': return cat === 'buyer';
    case 'producers': return cat === 'producer' || role.includes('producer');
    case 'rappers': return cat === 'rapper' || role.includes('rapper') || role.includes('artist') || role.includes('singer');
    case 'a&r': return cat === 'a&r' || cat === 'label' || role.includes('a&r') || role.includes('label');
    case 'friends': return cat === 'friend' || role.includes('friend');
    default: return true;
  }
}

export function filterAndSortContacts<T extends ContactLike>(
  contacts: T[],
  state: ContactFilterState,
  ctx: ContactFilterContext,
): T[] {
  const q = state.search.trim().toLowerCase();
  const selectedTags = [...state.tags];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const toneFor = (id: string): ContactStatusFilter => {
    const last = ctx.lastSentByContact.get(id);
    if (!last) return 'cold';
    return last >= thirtyDaysAgo ? 'active' : 'engaged';
  };

  const matched = contacts.filter((c) => {
    if (!matchesCategory(c, state.category, ctx.needsNudgeIds)) return false;
    if (state.status !== 'all' && toneFor(c.id) !== state.status) return false;
    if (selectedTags.length > 0) {
      const owned = (c.tags ?? []).map((t) => t.tag.toLowerCase());
      if (!selectedTags.every((sel) => owned.includes(sel.toLowerCase()))) return false;
    }
    if (q) {
      const inFields =
        c.name.toLowerCase().includes(q) ||
        (c.role ?? '').toLowerCase().includes(q) ||
        (c.label ?? '').toLowerCase().includes(q) ||
        (c.category ?? '').toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q);
      const inTags = (c.tags ?? []).some((t) => t.tag.toLowerCase().includes(q));
      if (!inFields && !inTags) return false;
    }
    return true;
  });

  const sorted = [...matched];
  const lastSent = ctx.lastSentByContact;
  const sendCount = ctx.sendCountByContact;
  const leadScore = ctx.leadScoreByContact;
  // Comparators return ascending order; we flip at the end for 'desc'.
  let cmp: (a: ContactLike, b: ContactLike) => number;
  switch (state.sort) {
    case 'name':
      cmp = (a, b) => a.name.localeCompare(b.name);
      break;
    case 'category':
      cmp = (a, b) => (a.category || '￿').localeCompare(b.category || '￿') || a.name.localeCompare(b.name);
      break;
    case 'lastSent':
      cmp = (a, b) => String(lastSent.get(a.id) ?? '').localeCompare(String(lastSent.get(b.id) ?? ''));
      break;
    case 'sends':
      cmp = (a, b) => (sendCount?.get(a.id) ?? 0) - (sendCount?.get(b.id) ?? 0);
      break;
    case 'lead':
      // Tie-break hottest leads by most-recent send so equal scores stay stable.
      cmp = (a, b) =>
        (leadScore?.get(a.id) ?? 0) - (leadScore?.get(b.id) ?? 0) ||
        String(lastSent.get(a.id) ?? '').localeCompare(String(lastSent.get(b.id) ?? ''));
      break;
    case 'stage':
      cmp = (a, b) =>
        (STAGE_RANK[a.crm_status ?? ''] ?? -1) - (STAGE_RANK[b.crm_status ?? ''] ?? -1) ||
        b.name.localeCompare(a.name);
      break;
    case 'revenue':
      cmp = (a, b) => (ctx.revenueByContact?.get(a.id) ?? 0) - (ctx.revenueByContact?.get(b.id) ?? 0);
      break;
    case 'tags':
      cmp = (a, b) => (a.tags?.length ?? 0) - (b.tags?.length ?? 0);
      break;
    case 'recent':
    default:
      cmp = (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
  }
  sorted.sort(cmp);
  // Default direction is 'desc' for recency/count columns, 'asc' for name —
  // but the caller's explicit sortDir always wins.
  const defaultDesc = state.sort !== 'name' && state.sort !== 'category';
  const dir = state.sortDir ?? (defaultDesc ? 'desc' : 'asc');
  if (dir === 'desc') sorted.reverse();
  return sorted;
}

/** Pure pagination slice. page is 1-indexed. */
export function paginate<T>(list: T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return list.slice(start, start + pageSize);
}

/** Total page count for a list (min 1). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function activeContactFilterCount(state: ContactFilterState): number {
  return [state.search.trim() !== '', state.category !== 'all', state.status !== 'all', state.tags.size > 0].filter(Boolean).length;
}
