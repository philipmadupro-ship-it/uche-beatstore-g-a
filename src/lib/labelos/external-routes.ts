/**
 * The ONLY `/api/org/**` handlers an external project member (LABEL-21) can
 * be served by, as paths relative to `src/app/api/org` → HTTP methods. Every
 * other org route answers an external member 403 or 404, by default: they
 * hold a `project_members` row and no `org_members` row, so each helper in
 * lib/auth/org-access answers "not a member" for them.
 *
 * This list is the route matrix's single source (src/app/api/org/
 * external-matrix.test.ts walks every route file and fails on a handler that
 * is neither here nor refuses an external member), so adding a route an
 * external member can reach is a visible edit here, with a reason, and a new
 * org route that forgets to refuse them fails a test instead of shipping.
 *
 * What each may do within is `externalCan` (lib/labelos/capabilities), per
 * request and per role; the entries below only say the handler is OPEN to
 * external members at all.
 */

export type ExternalRouteKind = 'session' | 'project';

export const EXTERNAL_ROUTES: Readonly<Record<string, { methods: readonly string[]; kind: ExternalRouteKind; why: string }>> = {
  'route.ts': {
    methods: ['GET'],
    kind: 'session',
    why: 'The switcher: the caller’s own orgs and, as "Shared with me", their own projects. Identity, not tenancy.',
  },
  'shared/route.ts': {
    methods: ['GET'],
    kind: 'session',
    why: '"Shared with me": the caller’s own live external memberships.',
  },
  'join/route.ts': {
    methods: ['POST'],
    kind: 'session',
    why: 'Accepting an invitation; the one route a non-member reaches, which checks the invitation itself.',
  },
  '[orgId]/projects/[id]/route.ts': {
    methods: ['GET'],
    kind: 'project',
    why: 'The project’s shared view (its songs and recordings, the artist’s name, the role’s controls) for a live member of THIS project.',
  },
  '[orgId]/projects/[id]/comments/route.ts': {
    methods: ['GET', 'POST'],
    kind: 'project',
    why: 'Read the project’s artist-visible comments, and (commenter and above) comment on its recordings. Never internal notes; never another project.',
  },
  '[orgId]/projects/[id]/comments/[commentId]/route.ts': {
    methods: ['PATCH', 'DELETE'],
    kind: 'project',
    why: 'Edit, resolve or delete a comment of THIS project: their own words, or resolving a thread (commenter and above). Never visibility, never an internal note.',
  },
  '[orgId]/tracks/[id]/credits/route.ts': {
    methods: ['GET', 'POST'],
    kind: 'project',
    why: 'D2: see their OWN credit lines on a song of their project, and (contributor / editor) propose a credit that names THEMSELVES. Never another person’s credit, party or legal data.',
  },
  '[orgId]/tracks/[id]/credits/[creditId]/route.ts': {
    methods: ['PATCH'],
    kind: 'project',
    why: 'D2: confirm or dispute their OWN credit (not one they proposed themselves). A credit that is not theirs is 404.',
  },
  '[orgId]/audio/[trackId]/route.ts': {
    methods: ['GET', 'HEAD'],
    kind: 'project',
    why: 'Listen to, and per role download, a recording in a project they are a member of; downloads are audited.',
  },
  '[orgId]/upload/init/route.ts': {
    methods: ['POST'],
    kind: 'project',
    why: 'A contributor / editor starts a NEW VERSION of a song in their own project.',
  },
  '[orgId]/upload/part/route.ts': { methods: ['POST', 'PATCH', 'PUT'], kind: 'project', why: 'The parts of that upload, for its starter only.' },
  '[orgId]/upload/complete/route.ts': {
    methods: ['POST'],
    kind: 'project',
    why: 'Finishing that upload: the version lands in the member’s project(s) only, credited to them (D3).',
  },
  '[orgId]/upload/abort/route.ts': { methods: ['POST'], kind: 'project', why: 'Dropping their own upload session.' },
  '[orgId]/upload/status/route.ts': { methods: ['GET'], kind: 'project', why: 'Resuming their own upload session.' },
};

/** Handlers an external member can reach: `<relative path>:<METHOD>`. */
export function externalRouteKeys(): string[] {
  return Object.entries(EXTERNAL_ROUTES)
    .flatMap(([path, r]) => r.methods.map((m) => `${path}:${m}`))
    .sort();
}
