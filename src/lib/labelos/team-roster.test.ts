import { describe, expect, it } from 'vitest';
import {
  COLLABORATOR_KINDS,
  availableAdds,
  collaboratorRequests,
  emptyArtist,
  emptyCollaborator,
  emptyPerson,
  entryProblems,
  hasEntries,
  personRequest,
  artistRequests,
  rosterWording,
  type TeamRosterEntries,
} from './team-roster';
import { groupOfCategory } from '@/lib/contacts/roles';
import { hasArtistRole } from './roster';

const none = (): TeamRosterEntries => ({ artists: [], people: [], collaborators: [] });
const ID = '11111111-1111-4111-8111-111111111111';

describe('rosterWording', () => {
  it('a label has a roster; the independent face has collaborators and no roster to add to', () => {
    expect(rosterWording('label')).toMatchObject({ title: 'Team and roster', artists: 'Roster artists', collaborators: 'Collaborators', canAddArtist: true });
    expect(rosterWording('artist')).toMatchObject({ title: 'Team and collaborators', collaborators: 'Your collaborators', canAddArtist: false });
    expect(JSON.stringify(rosterWording('artist'))).not.toMatch(/roster/i);
  });
});

describe('availableAdds', () => {
  const full = { members: true, catalog: true, wholeOrg: true, external: true };
  it('offers each add only to someone the route would let do it', () => {
    expect(availableAdds('label', full)).toEqual({ member: true, artist: true, collaborator: true, projectInvite: true });
    expect(availableAdds('label', { ...full, members: false })).toMatchObject({ member: false, artist: true });
    expect(availableAdds('label', { ...full, catalog: false })).toMatchObject({ artist: false, collaborator: false });
    // POST …/contacts refuses a member limited to some artists.
    expect(availableAdds('label', { ...full, wholeOrg: false })).toMatchObject({ artist: false, collaborator: false, member: true });
    expect(availableAdds('label', { ...full, external: false }).projectInvite).toBe(false);
  });
  it('an artist org has exactly one artist (D1): no add artist, ever', () => {
    expect(availableAdds('artist', full)).toMatchObject({ artist: false, member: true, collaborator: true });
  });
  it('the studio org can add members only: its people live in the producer CRM', () => {
    expect(availableAdds('producer', full)).toEqual({ member: true, artist: false, collaborator: false, projectInvite: false });
    expect(availableAdds('producer', { ...full, members: false }).member).toBe(false);
  });
});

describe('collaborator kinds', () => {
  it('never put a collaborator on the roster (a rapper feature is not a signed artist)', () => {
    for (const k of COLLABORATOR_KINDS) {
      expect(hasArtistRole({ category: k.category }), k.id).toBe(false);
    }
  });
  it('a beatmaker lands in the producers tab', () => {
    const beat = COLLABORATOR_KINDS.find((k) => k.id === 'beatmaker')!;
    expect(groupOfCategory(beat.category)).toBe('producer');
  });
});

describe('entryProblems', () => {
  const ctx = { orgKind: 'label' as const, existingArtists: [] as string[] };

  it('nothing entered is no problem', () => {
    expect(entryProblems(none(), ctx)).toEqual([]);
  });

  it('keeps the wizard sentences', () => {
    const e = none();
    e.artists = [{ name: '', email: 'x@y.test' }, { name: 'Nova', email: 'nope' }];
    e.people = [
      { ...emptyPerson(), email: 'bad' },
      { ...emptyPerson(), email: 'l@x.test', fn: 'legal', mode: 'login', name: '', password: 'short' },
      { ...emptyPerson(), email: 'm@x.test' },
    ];
    const p = entryProblems(e, ctx).join('\n');
    expect(p).toMatch(/Artist 1: give them a name/);
    expect(p).toMatch(/Artist 2: that email/);
    expect(p).toMatch(/Person 1: enter a valid email/);
    expect(p).toMatch(/Person 2: enter their name/);
    expect(p).toMatch(/Person 2: Use at least/);
    expect(p).toMatch(/Person 3: choose their function/);
  });

  it('an artist login needs an address to send it to', () => {
    const e = none();
    e.artists = [{ name: 'Nova', email: '', invite: true }];
    expect(entryProblems(e, ctx).join()).toMatch(/Artist 1: add an email address to invite them/);
  });

  it('one address is one person across all three lists', () => {
    const e = none();
    e.artists = [{ name: 'Nova', email: 'Same@x.test' }];
    e.people = [{ ...emptyPerson(), email: 'same@x.test', fn: 'legal' }];
    e.collaborators = [{ ...emptyCollaborator(), name: 'Kai', email: 'SAME@x.test' }];
    expect(entryProblems(e, ctx).join()).toMatch(/same email address/);
  });

  it('a member limited to artists must name at least one, or the server would make them see everything', () => {
    const e = none();
    e.people = [{ ...emptyPerson(), email: 'a@x.test', fn: 'a_and_r', scope: 'artists', artists: [] }];
    expect(entryProblems(e, ctx).join()).toMatch(/Person 1: choose at least one artist/);
    e.people[0].artists = ['ghost'];
    expect(entryProblems(e, ctx).join()).toMatch(/Person 1: choose at least one artist/);
    e.artists = [{ name: 'ghost', email: '' }];
    expect(entryProblems(e, ctx)).toEqual([]);
    e.artists = [];
    expect(entryProblems(e, { ...ctx, existingArtists: ['ghost'] })).toEqual([]);
  });

  it('an admin is never limited to artists', () => {
    const e = none();
    e.people = [{ ...emptyPerson(), email: 'a@x.test', role: 'admin', scope: 'artists', artists: [] }];
    expect(entryProblems(e, ctx)).toEqual([]);
  });

  it('a collaborator needs a name; a project invite needs an address and a real role', () => {
    const e = none();
    e.collaborators = [{ ...emptyCollaborator(), name: '', email: '' }];
    expect(entryProblems(e, ctx).join()).toMatch(/Collaborator 1: give them a name/);
    e.collaborators = [{ ...emptyCollaborator(), name: 'Kai', email: '', projectId: ID }];
    expect(entryProblems(e, ctx).join()).toMatch(/Collaborator 1: add an email address to invite them to the project/);
    e.collaborators = [{ ...emptyCollaborator(), name: 'Kai', email: 'k@x.test', projectId: ID, projectRole: 'boss' as never }];
    expect(entryProblems(e, ctx).join()).toMatch(/Collaborator 1: choose what they may do/);
    e.collaborators = [{ ...emptyCollaborator(), name: 'Kai', email: 'k@x.test', projectId: ID }];
    expect(entryProblems(e, ctx)).toEqual([]);
  });

  it('caps each list so one request cannot be a flood', () => {
    const e = none();
    e.artists = Array.from({ length: 21 }, (_, i) => ({ name: `A${i}`, email: '' }));
    expect(entryProblems(e, ctx).join()).toMatch(/at most 20 artists/);
  });

  it('an independent artist has no roster to add to', () => {
    const e = none();
    e.artists = [{ name: 'Me', email: '' }];
    expect(entryProblems(e, { orgKind: 'artist', existingArtists: [] }).join()).toMatch(/no roster/i);
  });
});

describe('request builders', () => {
  it('an artist is a roster contact with the artist category', () => {
    const [r, ...rest] = artistRequests({ name: ' Nova ', email: ' N@X.test ' });
    expect(rest).toEqual([]);
    expect(r).toMatchObject({ kind: 'roster', path: '/contacts', body: { name: 'Nova', category: 'artist', email: 'N@X.test' } });
  });

  it('an artist login is a second request, role artist, limited to that artist', () => {
    const [contact, invite] = artistRequests({ name: 'Nova', email: 'n@x.test', invite: true }, () => ID);
    expect(contact.kind).toBe('roster');
    expect(invite).toMatchObject({
      kind: 'invitation',
      path: '/invitations',
      body: { email: 'n@x.test', role: 'artist', functions: [], contact_ids: [ID] },
    });
  });

  it('an artist login is skipped, not sent unscoped, when the contact was not created', () => {
    const reqs = artistRequests({ name: 'Nova', email: 'n@x.test', invite: true }, () => null);
    expect(reqs.map((r) => r.kind)).toEqual(['roster']);
  });

  it('a person is an invitation or a team login with role, function and artist scope', () => {
    const inv = personRequest({ ...emptyPerson(), email: 'a@x.test', fn: 'a_and_r', scope: 'artists', artists: ['k1', 'k2'] }, (k) => (k === 'k1' ? ID : null));
    expect(inv).toMatchObject({ kind: 'invitation', path: '/invitations', body: { email: 'a@x.test', role: 'member', functions: ['a_and_r'], contact_ids: [ID] } });
    const login = personRequest({ ...emptyPerson(), email: 'l@x.test', fn: 'legal', mode: 'login', name: 'Lee', password: 'a-good-password-1' }, () => null);
    expect(login).toMatchObject({ kind: 'login', path: '/team-accounts', body: { email: 'l@x.test', name: 'Lee', role: 'member', functions: ['legal'] } });
    expect(login!.body).not.toHaveProperty('contact_ids');
  });

  it('an admin carries no function and no artist list', () => {
    const r = personRequest({ ...emptyPerson(), email: 'a@x.test', role: 'admin', fn: 'legal', scope: 'artists', artists: ['k1'] }, () => ID)!;
    expect(r.body).toMatchObject({ role: 'admin', functions: [] });
    expect(r.body).not.toHaveProperty('contact_ids');
  });

  it('a person limited to artists whose artists did not resolve is NOT sent (it would become whole-org)', () => {
    expect(personRequest({ ...emptyPerson(), email: 'a@x.test', fn: 'legal', scope: 'artists', artists: ['k1'] }, () => null)).toBeNull();
  });

  it('a collaborator is a non-roster contact; with an address and a project, also a project invitation', () => {
    const [c] = collaboratorRequests({ ...emptyCollaborator(), name: 'Kai', kind: 'rapper' });
    expect(c).toMatchObject({ kind: 'collaborator', path: '/contacts', body: { name: 'Kai', category: 'other', role: 'Rapper' } });
    expect(c.body).not.toHaveProperty('email');
    const reqs = collaboratorRequests({ ...emptyCollaborator(), name: 'Kai', email: 'k@x.test', kind: 'beatmaker', projectId: ID, projectRole: 'contributor' });
    expect(reqs[0].body).toMatchObject({ category: 'producer', role: 'Beatmaker', email: 'k@x.test' });
    expect(reqs[1]).toMatchObject({ kind: 'project_invite', path: `/projects/${ID}/members`, body: { email: 'k@x.test', role: 'contributor', allow_downloads: false } });
  });
});

describe('hasEntries', () => {
  it('knows when there is anything to add', () => {
    expect(hasEntries(none())).toBe(false);
    expect(hasEntries({ ...none(), artists: [emptyArtist()] })).toBe(false);
    expect(hasEntries({ ...none(), artists: [{ ...emptyArtist(), name: 'Nova' }] })).toBe(true);
    expect(hasEntries({ ...none(), people: [{ ...emptyPerson(), email: 'a@x.test' }] })).toBe(true);
  });
});
