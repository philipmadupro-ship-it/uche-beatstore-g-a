'use client';

/**
 * The people a filter editor may offer: the roster artists the viewer can see
 * (the contacts route already applies their artist scope) and, for a member
 * who reads rights data, the parties they may see. Both lists come from the
 * same routes the artists page and the credits strip use — nothing is fetched
 * that the viewer could not open elsewhere.
 */
import { useEffect, useState } from 'react';
import type { Choice } from '@/components/labelos/FilterEditor';

export function useFilterChoices(orgId: string, canRights: boolean): { artists: Choice[]; people: Choice[] } {
  const [artists, setArtists] = useState<Choice[]>([]);
  const [people, setPeople] = useState<Choice[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/org/${orgId}/contacts?view=roster`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { contacts?: { id: string; name: string }[] } | null) => {
        if (!cancelled && body?.contacts) setArtists(body.contacts.map((c) => ({ id: c.id.toLowerCase(), name: c.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (!canRights) return;
    let cancelled = false;
    fetch(`/api/org/${orgId}/parties`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { parties?: { id: string; display_name: string }[] } | null) => {
        if (!cancelled && body?.parties) setPeople(body.parties.map((p) => ({ id: p.id.toLowerCase(), name: p.display_name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId, canRights]);

  return { artists, people };
}
