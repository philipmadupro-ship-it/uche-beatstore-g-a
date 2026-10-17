/**
 * Account faces (LABEL-47, doc 22 §8 answer 1, doc 23 "Owner decisions" 1).
 *
 * The owner licenses Label OS to one of two faces. They are NOT new org
 * kinds: each face is an existing `organizations.kind`, and the face is
 * derived from it so nothing that reads `kind` changes.
 *
 *   independent = kind `artist` — one person who is both the artist and the
 *                 producer (functions `producer` / `engineer` allowed, no
 *                 roster beyond the artist themselves, D1).
 *   label       = kind `label`  — an organisation with artists, beatmakers,
 *                 producers, rappers, collaborators and staff.
 *
 * The `producer`-kind org is the studio's personal org behind the producer
 * dashboard (137). It is not a licensee, so it has no face (null) and the
 * platform console never creates, lists or edits one.
 */
export const ACCOUNT_FACES = ['independent', 'label'] as const;
export type AccountFace = (typeof ACCOUNT_FACES)[number];

/** The org kind each face is stored as. */
export const FACE_KIND: Readonly<Record<AccountFace, 'artist' | 'label'>> = {
  independent: 'artist',
  label: 'label',
};

/** The face of an org, from its kind. Null for the producer's personal org and anything unknown. */
export function accountFace(org: { kind: string | null | undefined }): AccountFace | null {
  for (const face of ACCOUNT_FACES) if (FACE_KIND[face] === org.kind) return face;
  return null;
}

export function isAccountFace(value: unknown): value is AccountFace {
  return typeof value === 'string' && (ACCOUNT_FACES as readonly string[]).includes(value);
}

/** What the console calls each face. */
export const FACE_LABELS: Readonly<Record<AccountFace, string>> = {
  independent: 'Independent artist / producer',
  label: 'Label',
};
