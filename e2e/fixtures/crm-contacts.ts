/** Synthetic CRM data shared by the CRM e2e specs: n contacts across every role, and their sends. */
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day).toISOString();

const CATS = ['artist', 'rapper', 'producer', 'engineer', 'a&r', 'label', 'manager', 'friend', 'buyer', 'press', 'other'];
const STAGES = ['prospect', 'active', 'engaged', 'customer', 'cold', null];
const SENDS = ['sent', 'opened', 'interested', 'negotiating', 'placed', 'pass'];
const FIRST = ['Nova', 'Kai', 'Rio', 'Sage', 'Wren', 'Ade', 'Zuri', 'Milo', 'Ines', 'Tobi', 'Lena', 'Omar', 'Yuki', 'Bex', 'Dara'];
const LAST = ['Vale', 'Okoro', 'Hart', 'Lind', 'Mora', 'Stone', 'Ray', 'Quinn', 'Park', 'Cruz'];

export function makeContacts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${String(i).padStart(4, '0')}`,
    name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}${i >= 150 ? ` ${i}` : ''}`,
    email: `contact${i}@example.com`,
    category: CATS[i % CATS.length],
    secondary_category: i % 9 === 0 ? 'producer' : null,
    role: null, label: null,
    crm_status: STAGES[i % STAGES.length],
    buyer_pipeline_status: null,
    tags: i % 3 === 0 ? [{ tag: 'trap', category: 'custom' }] : i % 5 === 0 ? [{ tag: 'drill', category: 'custom' }, { tag: 'uk', category: 'custom' }] : [],
    created_at: ago(200 - (i % 190)),
  }));
}
export function makeSends(contacts: ReturnType<typeof makeContacts>) {
  return contacts.flatMap((c, i) => (i % 4 === 3 ? [] : Array.from({ length: 1 + (i % 3) }, (_, k) => ({
    id: `s${i}-${k}`, contact_id: c.id, track_ids: ['t1', 't2'], share_token: `tok${i}${k}`, message: 'Have a listen',
    status: SENDS[(i + k) % SENDS.length], sent_at: ago((i % 40) + k * 6 + 1),
    opened_at: (i + k) % 2 ? ago((i % 40) + k * 6) : null, link_clicked_at: null,
  }))));
}

