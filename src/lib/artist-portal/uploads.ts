/**
 * Contact uploads through the portal link (PORTAL-UP, mig 190;
 * docs/portal-contact-uploads.md).
 *
 * A contact sends their own files into a project from their portal when the
 * producer switched `project_contacts.can_upload` on for that link. The file
 * becomes an ordinary project_assets row of the producer, credited to the
 * contact through `uploaded_by_contact_id`. Everything here degrades before
 * 190 is applied: no switch reads as on, no file reads as anyone's.
 */

import { selectIn } from '@/lib/db/chunked-in';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import type { PortalProjectLink, PortalRef } from './membership';
import type { PortalFileRow } from './new-items';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Files one portal may send per hour, across all its projects. */
export const PORTAL_UPLOADS_PER_HOUR = 30;

export type UploadDecision = 'ok' | 'not-found' | 'uploads-off';

/**
 * May this portal upload into `projectId`? A project that is not in the
 * portal (unlinked, not in_portal, archived) is NOT FOUND, as every portal
 * route answers it; one that is but has uploads off is refused openly, since
 * the artist can already see the project.
 */
export function portalUploadDecision(
  links: readonly Pick<PortalProjectLink, 'project_id'>[],
  uploadable: ReadonlySet<string>,
  projectId: string,
): UploadDecision {
  if (!links.some((l) => l.project_id === projectId)) return 'not-found';
  return uploadable.has(projectId) ? 'ok' : 'uploads-off';
}

/** The portal projects whose link has uploads on (empty before mig 190). */
export async function loadUploadableProjects(admin: Admin, portal: PortalRef, projectIds: readonly string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const { data, error } = await admin
    .from('project_contacts')
    .select('project_id, can_upload')
    .eq('contact_id', portal.contact_id)
    .eq('user_id', portal.user_id)
    .in('project_id', [...projectIds]);
  if (error) {
    if (isMissingSchema(error)) return new Set();
    throw error;
  }
  return new Set(((data ?? []) as Array<{ project_id: string; can_upload: boolean | null }>)
    .filter((r) => r.can_upload === true)
    .map((r) => r.project_id));
}

/**
 * Who sent each of `assetIds`, when a contact did (owner-filtered). Read on
 * its own so the main file queries keep working before mig 190.
 */
export async function loadAssetUploaders(admin: Admin, userId: string, assetIds: readonly string[]): Promise<Map<string, string>> {
  if (assetIds.length === 0) return new Map();
  try {
    const rows = await selectIn<{ id: string; uploaded_by_contact_id: string | null }>((ids) => admin
      .from('project_assets')
      .select('id, uploaded_by_contact_id')
      .in('id', ids)
      .eq('user_id', userId), [...assetIds]);
    return new Map(rows.filter((r) => r.uploaded_by_contact_id).map((r) => [r.id, r.uploaded_by_contact_id!]));
  } catch (err) {
    if (isMissingSchema(err)) return new Map();
    throw err;
  }
}

/** The names of the contacts in `uploaders` (owner-filtered), for "From Nova". */
export async function loadUploaderNames(admin: Admin, userId: string, uploaders: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const contactIds = [...new Set(uploaders.values())];
  if (contactIds.length === 0) return new Map();
  const rows = await selectIn<{ id: string; name: string | null }>((ids) => admin
    .from('contacts').select('id, name').in('id', ids).eq('user_id', userId), contactIds);
  return new Map(rows.map((r) => [r.id, r.name?.trim() || 'Contact']));
}

/**
 * The files that are news to `contactId`: everything except what they sent
 * themselves. Notify and NEW markers never announce a contact's own upload
 * back to them; the same file is still news to every other artist on the
 * project.
 */
export function filesForContact<T extends Pick<PortalFileRow, 'uploadedBy'>>(rows: readonly T[], contactId: string): T[] {
  return rows.filter((r) => r.uploadedBy !== contactId);
}

export const PORTAL_UPLOAD_NOTIFICATION = 'portal_upload';

/** The producer's bell row for a contact's upload. Never carries the portal token. */
export function buildPortalUploadNotification(input: {
  ownerId: string;
  contactId: string;
  contactName: string;
  projectId: string;
  projectName: string | null;
  assetId: string;
  label: string;
}) {
  const who = input.contactName.trim() || 'A contact';
  const project = input.projectName?.trim() || 'a project';
  return {
    user_id: input.ownerId,
    kind: PORTAL_UPLOAD_NOTIFICATION,
    title: `${who} uploaded a file to ${project}`,
    body: input.label.slice(0, 140),
    data: { contact_id: input.contactId, project_id: input.projectId, asset_id: input.assetId },
  };
}
