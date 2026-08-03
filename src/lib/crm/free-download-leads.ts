/**
 * Turn raw free-download rows into leads.
 *
 * `store_free_downloads` gets a row per download — same person grabbing three
 * beats is three rows. That table has been collecting addresses since migration
 * 037 and, until now, was read by nothing: the single most valuable asset a
 * producer accumulates was write-only.
 *
 * A lead is a PERSON, not a download. Aggregating by email is what makes the
 * list usable: "who are my 40 warmest contacts" rather than "here are 200 rows".
 *
 * Deliberately NOT auto-promoted into `contacts`. Someone who grabbed a free
 * beat has not opted into outreach, and silently mixing them with people the
 * producer chose to contact would corrupt the CRM's meaning and its pipeline
 * stats. Promotion is an explicit action; this module just makes the list
 * legible enough to decide on.
 */

export interface FreeDownloadRow {
  email: string;
  track_id: string;
  downloaded_at: string;
  /** Joined title where available; falls back to the id. */
  track_title?: string | null;
}

export interface FreeDownloadLead {
  email: string;
  /** Total downloads by this address. Repeat downloaders are the warm ones. */
  downloads: number;
  /** Distinct tracks taken, most recent first. */
  tracks: string[];
  firstDownloadAt: string;
  lastDownloadAt: string;
}

/** Case- and whitespace-insensitive identity. `A@x.com ` and `a@x.com` are one person. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Aggregate rows into leads, newest activity first.
 *
 * Sorted by most recent download rather than download count: a producer
 * following up wants who is warm *now*, not who was busiest six months ago.
 */
export function aggregateFreeDownloadLeads(rows: FreeDownloadRow[]): FreeDownloadLead[] {
  const byEmail = new Map<string, FreeDownloadLead & { trackSet: Set<string> }>();

  for (const row of rows) {
    if (!row?.email || typeof row.email !== 'string') continue;
    const email = normaliseEmail(row.email);
    if (!email) continue;

    const at = typeof row.downloaded_at === 'string' ? row.downloaded_at : '';
    const title = (row.track_title || row.track_id || '').trim();

    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, {
        email,
        downloads: 1,
        tracks: [],
        trackSet: new Set(title ? [title] : []),
        firstDownloadAt: at,
        lastDownloadAt: at,
      });
      continue;
    }

    existing.downloads += 1;
    if (title) existing.trackSet.add(title);
    // String compare is safe and cheap here: these are ISO-8601 UTC timestamps
    // from Postgres, which sort lexicographically.
    if (at && (!existing.firstDownloadAt || at < existing.firstDownloadAt)) existing.firstDownloadAt = at;
    if (at && at > existing.lastDownloadAt) existing.lastDownloadAt = at;
  }

  return [...byEmail.values()]
    .map(({ trackSet, ...lead }) => ({ ...lead, tracks: [...trackSet] }))
    .sort((a, b) => b.lastDownloadAt.localeCompare(a.lastDownloadAt));
}

/**
 * Which leads are not yet contacts.
 *
 * Compared on normalised email so a contact saved as `Someone@Label.com` is
 * correctly recognised and not duplicated.
 */
export function leadsNotYetContacts(
  leads: FreeDownloadLead[],
  contactEmails: Array<string | null | undefined>,
): FreeDownloadLead[] {
  const known = new Set(
    contactEmails
      .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      .map(normaliseEmail),
  );
  return leads.filter((lead) => !known.has(lead.email));
}

/**
 * Build the contact row for a promoted lead.
 *
 * `name` is required by the contacts API but a free download only captures an
 * address, so the local part is used as a placeholder the producer can edit —
 * better than "Unknown" repeated forty times in a list.
 */
export function contactFromLead(lead: FreeDownloadLead): {
  name: string;
  email: string;
  role: string;
  notes: string;
} {
  const localPart = lead.email.split('@')[0] || lead.email;
  return {
    name: localPart,
    email: lead.email,
    role: 'artist',
    notes: `Free download lead — ${lead.downloads} download${lead.downloads === 1 ? '' : 's'}`
      + `${lead.tracks.length ? ` (${lead.tracks.slice(0, 3).join(', ')})` : ''}.`,
  };
}
