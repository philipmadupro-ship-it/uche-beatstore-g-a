# Contact uploads through the portal link (PORTAL-UP)

Owner request from the LABEL-47 / PR #132 decision round: a contact linked to
a project gets access through a link only — no account — optionally behind a
password the producer sets, sees the project, and can upload their own
material (files, recordings) to it.

## Decision: extend the artist portal, not project shares

| | Artist portal (`/artist/[token]`) | Project share (`/projects/share/[token]`) |
|---|---|---|
| Who it is for | ONE contact (`artist_portals.contact_id`) | anyone holding the token (`contact_id` optional) |
| Project link | `project_contacts` (`in_portal`, `allow_downloads`, `can_comment`) | one share row per project |
| Files | already lists and streams `project_assets` (mig 127) | none |
| Password | `password_hash` + the shared gate (401) | yes |
| Attribution | every action is the contact's (timeline, notifications) | a typed guest name |

Uploads need an author the producer knows. A project share is anonymous by
design and has no files at all; the portal already is "a contact's link to
their projects", already has the files tab, the password gate, revocation,
reissue and optional email sign-in. So uploads are one more per-link switch
next to Downloads and Comments, and an uploaded file is an ordinary
`project_assets` row with the contact as its author.

## Schema — migration 190

162–188 are reserved by the phase-2 backlog (`docs/bstudio-label-os/23-…`) and
189 is PR #130's, so this takes **190** (the first number nothing claims).

- `project_contacts.can_upload boolean NOT NULL DEFAULT false` — off for every
  existing link.
- `project_assets.uploaded_by_contact_id uuid NULL REFERENCES contacts(id)
  ON DELETE SET NULL` + index. NULL = the producer's own file.
- A same-owner trigger: the contact must belong to the asset's owner
  (`user_id`), as every #44 table does.
- Local check `supabase/local/checks/190_portal_contact_uploads.sql`;
  rollback file. Not part of `supabase/apply/pending.sql` until the owner says.

Before 190: the portal never offers uploads (the column reads as false), the
upload routes answer 404, and the producer's switch answers 503 naming 190.

## Routes

- `POST /api/portal/[token]/files` — multipart `file` + `project_id` (≤ 4 MB),
  or JSON `{ project_id, upload_id, file_name }` after a presign (an opaque
  id; the server rebuilds the storage reference, never takes one). Gate first
  (`gatePortal`: 404 / 410 / 401 password / 401 sign-in), then membership: a
  project not in this portal is **404**; in the portal with uploads off is
  **403**. Same extension allowlist as producer project files
  (`validateAssetFile`, never `{ org: true }`; `.html`/`.svg` refused), stored
  MIME from the allowlist, private bucket only (`storeProjectAsset`). The row
  is written by the service role: `user_id` = the portal's owner,
  `uploaded_by_contact_id` = the portal's contact, `in_portal = true` (the
  artist sees what they sent), kind guessed from the name. Rate-limited per IP
  and per portal. Writes a `file_uploaded` timeline row and a `portal_upload`
  notification.
- `POST /api/portal/[token]/files/presign` — same gate + membership, mints a
  key in the project's own folder and returns the PUT URL plus the opaque
  `upload_id`; the register step rebuilds the key, checks the object exists
  and its size, and refuses an object already registered.
- `PATCH /api/projects/[id]/contacts/[contactId] { can_upload }` (Zod).
- `/api/portal/` is already on the api-gate allowlist; nothing new there.

## UI

- Workspace Projects tab: an **Uploads** switch beside Downloads.
- Workspace header portal menu: **Set password… / Remove password** (the API
  has supported it since 122; no UI did).
- Portal Files: an upload control on each project that allows it, "Sent by
  you" on the artist's own files.
- Project page files list and the workspace Files tab: "From <contact>" on a
  contact's upload.

## Erasure

`eraseArtistWorkspace` deletes the files the contact uploaded (rows and
objects): they are the person's material, like their comments.

## Tests

Pure rules (`lib/artist-portal/uploads.ts`), route tests for the gate /
membership / switch / allowlist / attribution, the local SQL check, and
`e2e/portal-uploads.spec.ts` against the real local database
(`npm run e2e:real-db`).
