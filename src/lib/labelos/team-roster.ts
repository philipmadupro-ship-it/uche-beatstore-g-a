/**
 * The "Team and roster" window (LABEL-50): ONE set of rules for adding people
 * to an organization, whether that happens in the setup wizard (before the
 * org exists; the entries are held in the draft and sent at the end) or on
 * the Team page (live; the entries are sent when the person presses Add).
 *
 * Three kinds of entry, each sent through the route that already owns its
 * rule — nothing here writes, and no rule is copied:
 *
 *  - an ARTIST is a roster contact (POST …/contacts, category `artist`;
 *    `max_artists` and the one-artist rule of an artist org are the route's),
 *    optionally followed by a login invitation with role `artist` limited to
 *    that contact (POST …/invitations);
 *  - a PERSON is a member: an invitation (they join with their own account) or
 *    a team login (doc 25: the creator chooses the first password, shown
 *    once), with a role, one function for a member and an artist scope;
 *  - a COLLABORATOR is a directory contact with a role (beatmaker, producer,
 *    engineer, rapper, feature) who is NOT on the roster, optionally followed
 *    by an invitation to one project as an external member (LABEL-21).
 *
 * The two faces: a label has a roster ("Roster artists", "Collaborators"); an
 * independent artist is the artist, so there is nobody to add to a roster and
 * the people they make music with are "Your collaborators" (D1, doc 22).
 *
 * Pure: no I/O. Runner: ./team-roster-client.ts. Editor:
 * src/components/labelos/TeamRosterEditor.tsx.
 */
import { ROLE_USES_FUNCTIONS, EXTERNAL_PROJECT_ROLES, type ExternalProjectRole, type OrgFunction, type OrgKind } from './capabilities';
import { passwordProblem } from './team-accounts';

// ── Entries ─────────────────────────────────────────────────────────────

export type ArtistEntry = {
  name: string;
  email: string;
  /** Also send them a login invitation (role `artist`, limited to this artist). Needs an email. */
  invite?: boolean;
};

export type PersonEntry = {
  email: string;
  role: 'admin' | 'member';
  /** The one function a `member` has; null for an admin. */
  fn: OrgFunction | null;
  /** `invite` sends the usual invitation; `login` creates the account directly (doc 25). */
  mode: 'invite' | 'login';
  /** Login only. */
  name: string;
  /** Login only. Held in memory, never saved with a wizard draft. */
  password: string;
  /** `artists` limits a member to the artists in `artists`. An admin always sees the whole org. */
  scope?: 'org' | 'artists';
  /** The artists a limited member sees: contact ids, or (in the wizard, before they exist) the names of artists being added. */
  artists?: string[];
};

export const COLLABORATOR_KINDS = [
  { id: 'beatmaker', label: 'Beatmaker', category: 'producer', role: 'Beatmaker' },
  { id: 'producer', label: 'Producer', category: 'producer', role: 'Producer' },
  { id: 'engineer', label: 'Engineer', category: 'engineer', role: 'Engineer' },
  // A rapper or feature who is a guest is not a signed artist, so neither is given an artist category
  // (that is what puts a contact on the roster, lib/labelos/roster): the role is a label on a directory contact.
  { id: 'rapper', label: 'Rapper', category: 'other', role: 'Rapper' },
  { id: 'feature', label: 'Featured artist', category: 'other', role: 'Featured artist' },
] as const;
export type CollaboratorKind = (typeof COLLABORATOR_KINDS)[number]['id'];

export type CollaboratorEntry = {
  name: string;
  /** Optional, unless they are invited to a project. */
  email: string;
  kind: CollaboratorKind;
  /** Also invite them to this one project as an external member. '' = no. */
  projectId: string;
  projectRole: ExternalProjectRole;
};

export type TeamRosterEntries = {
  artists: ArtistEntry[];
  people: PersonEntry[];
  collaborators: CollaboratorEntry[];
};

export const ENTRY_MAX = 20;

export function emptyArtist(): ArtistEntry {
  return { name: '', email: '', invite: false };
}

export function emptyPerson(): PersonEntry {
  return { email: '', role: 'member', fn: null, mode: 'invite', name: '', password: '', scope: 'org', artists: [] };
}

export function emptyCollaborator(): CollaboratorEntry {
  return { name: '', email: '', kind: 'beatmaker', projectId: '', projectRole: 'viewer' };
}

export function hasEntries(e: TeamRosterEntries): boolean {
  return e.artists.length + e.people.length + e.collaborators.length > 0;
}

// ── Wording and what may be added ───────────────────────────────────────

export function rosterWording(orgKind: OrgKind): { title: string; artists: string; collaborators: string; canAddArtist: boolean } {
  if (orgKind === 'artist') return { title: 'Team and collaborators', artists: 'You', collaborators: 'Your collaborators', canAddArtist: false };
  return { title: 'Team and roster', artists: 'Roster artists', collaborators: 'Collaborators', canAddArtist: orgKind === 'label' };
}

export type AddPermissions = {
  /** `members.manage`. */
  members: boolean;
  /** `catalog.write`. */
  catalog: boolean;
  /** The viewer sees the whole organization: POST …/contacts refuses a member limited to some artists. */
  wholeOrg: boolean;
  /** `share.external`. */
  external: boolean;
};

/** Which adds the viewer is offered: only what the routes would accept. */
export function availableAdds(
  orgKind: OrgKind,
  p: AddPermissions,
): { member: boolean; artist: boolean; collaborator: boolean; projectInvite: boolean } {
  // The studio's own org keeps its people directory in the producer's CRM, not here: only members can be added.
  if (orgKind === 'producer') return { member: p.members, artist: false, collaborator: false, projectInvite: false };
  const contacts = p.catalog && p.wholeOrg;
  return {
    member: p.members,
    artist: contacts && rosterWording(orgKind).canAddArtist,
    collaborator: contacts,
    projectInvite: contacts && p.external,
  };
}

// ── Validation ──────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 200 && EMAIL_RE.test(value.trim());
}

function dedupe(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export type ProblemContext = {
  orgKind: OrgKind;
  /** Keys a limited member may point at besides the artists being added now: the org's existing roster contact ids. */
  existingArtists: readonly string[];
};

/** What is wrong with the entries, as sentences. Empty = they can be sent. */
export function entryProblems(e: TeamRosterEntries, ctx: ProblemContext): string[] {
  const out: string[] = [];

  if (e.artists.length > 0 && !rosterWording(ctx.orgKind).canAddArtist) {
    out.push('An independent artist has no roster: you are the artist. Add the people you make music with as collaborators.');
  }
  const artistNames = e.artists.map((r) => r.name.trim()).filter(Boolean);
  e.artists.forEach((r, i) => {
    if (!r.name.trim() && (r.email.trim() || r.invite)) out.push(`Artist ${i + 1}: give them a name.`);
    if (r.email.trim() && !isEmail(r.email)) out.push(`Artist ${i + 1}: that email address does not look right.`);
    if (r.invite && !r.email.trim()) out.push(`Artist ${i + 1}: add an email address to invite them.`);
  });
  if (dedupe(artistNames.map((n) => n.toLowerCase()))) out.push('Two artists have the same name.');
  if (e.artists.length > ENTRY_MAX) out.push(`Add at most ${ENTRY_MAX} artists at a time; the rest can be added afterwards.`);
  if (e.people.length > ENTRY_MAX) out.push(`Add at most ${ENTRY_MAX} people at a time; the rest can be added afterwards.`);
  if (e.collaborators.length > ENTRY_MAX) out.push(`Add at most ${ENTRY_MAX} collaborators at a time; the rest can be added afterwards.`);

  const everyEmail = [
    ...e.artists.map((r) => r.email),
    ...e.people.map((t) => t.email),
    ...e.collaborators.map((c) => c.email),
  ]
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  if (dedupe(everyEmail)) out.push('Two people have the same email address.');

  const reachable = new Set<string>([...artistNames, ...ctx.existingArtists]);
  e.people.forEach((t, i) => {
    const who = `Person ${i + 1}`;
    if (!isEmail(t.email)) out.push(`${who}: enter a valid email address.`);
    if (t.role === 'member' && ROLE_USES_FUNCTIONS.member && !t.fn) out.push(`${who}: choose their function.`);
    if (t.role === 'member' && t.scope === 'artists' && !(t.artists ?? []).some((a) => reachable.has(a))) {
      out.push(`${who}: choose at least one artist, or let them see the whole organization.`);
    }
    if (t.mode === 'login') {
      if (!t.name.trim()) out.push(`${who}: enter their name.`);
      const problem = passwordProblem(t.password, t.email);
      if (problem) out.push(`${who}: ${problem}`);
    }
  });

  e.collaborators.forEach((c, i) => {
    const who = `Collaborator ${i + 1}`;
    if (!c.name.trim()) out.push(`${who}: give them a name.`);
    if (c.email.trim() && !isEmail(c.email)) out.push(`${who}: that email address does not look right.`);
    if (c.projectId) {
      if (!c.email.trim()) out.push(`${who}: add an email address to invite them to the project.`);
      if (!(EXTERNAL_PROJECT_ROLES as readonly string[]).includes(c.projectRole)) out.push(`${who}: choose what they may do on the project.`);
    }
  });

  return out;
}

// ── What is sent ────────────────────────────────────────────────────────

export type FollowUpKind = 'roster' | 'invitation' | 'login' | 'release' | 'collaborator' | 'project_invite';

export type FollowUp = {
  kind: FollowUpKind;
  /** What the result list calls it. */
  label: string;
  method: 'POST';
  /** Relative to `/api/org/<orgId>`. */
  path: string;
  body: Record<string, unknown>;
  /** Where the person fixes it by hand when the request fails. */
  fixIn: string;
};

/**
 * The roster artist as POST …/contacts takes it, then — when asked, and only
 * when the contact exists (`contactId` resolves) — the login invitation
 * limited to that contact. Called without a resolver it returns just the
 * contact request (the invitation needs the id the first one returns).
 */
export function artistRequests(entry: ArtistEntry, contactId?: () => string | null): FollowUp[] {
  const name = entry.name.trim();
  if (!name) return [];
  const email = entry.email.trim();
  const out: FollowUp[] = [
    {
      kind: 'roster',
      label: name,
      method: 'POST',
      path: '/contacts',
      body: { name, category: 'artist', ...(email ? { email } : {}) },
      fixIn: 'the roster',
    },
  ];
  const id = entry.invite && email && contactId ? contactId() : null;
  if (id) {
    out.push({
      kind: 'invitation',
      label: email,
      method: 'POST',
      path: '/invitations',
      body: { email, role: 'artist', functions: [], contact_ids: [id] },
      fixIn: 'Team → Add member',
    });
  }
  return out;
}

/**
 * An invitation or a team login for a person. `resolveArtist` turns an entry in
 * `artists` into a roster contact id (null = not there). A member limited to
 * artists none of which resolve is NOT sent: an empty list would make the
 * server read the grant as the whole organization (validateInvitationGrant).
 */
export function personRequest(entry: PersonEntry, resolveArtist: (key: string) => string | null): FollowUp | null {
  const email = entry.email.trim();
  if (!email) return null;
  const member = entry.role === 'member';
  const functions = member && entry.fn ? [entry.fn] : [];
  let contactIds: string[] = [];
  if (member && entry.scope === 'artists') {
    contactIds = [...new Set((entry.artists ?? []).map(resolveArtist).filter((id): id is string => !!id))];
    if (contactIds.length === 0) return null;
  }
  if (entry.mode === 'login') {
    return {
      kind: 'login',
      label: email,
      method: 'POST',
      path: '/team-accounts',
      body: { email, name: entry.name.trim(), password: entry.password, role: entry.role, functions, ...(contactIds.length ? { contact_ids: contactIds } : {}) },
      fixIn: 'Team → Add member',
    };
  }
  return {
    kind: 'invitation',
    label: email,
    method: 'POST',
    path: '/invitations',
    body: { email, role: entry.role, functions, ...(contactIds.length ? { contact_ids: contactIds } : {}) },
    fixIn: 'Team → Add member',
  };
}

/** The directory contact, then (with an address and a project) the external-project invitation. */
export function collaboratorRequests(entry: CollaboratorEntry): FollowUp[] {
  const name = entry.name.trim();
  if (!name) return [];
  const kind = COLLABORATOR_KINDS.find((k) => k.id === entry.kind) ?? COLLABORATOR_KINDS[0];
  const email = entry.email.trim();
  const out: FollowUp[] = [
    {
      kind: 'collaborator',
      label: name,
      method: 'POST',
      path: '/contacts',
      body: { name, category: kind.category, role: kind.role, ...(email ? { email } : {}) },
      fixIn: 'Team → Add collaborator',
    },
  ];
  if (entry.projectId && email) {
    out.push({
      kind: 'project_invite',
      label: email,
      method: 'POST',
      path: `/projects/${entry.projectId}/members`,
      body: { email, role: entry.projectRole, allow_downloads: false },
      fixIn: 'the project’s members',
    });
  }
  return out;
}
