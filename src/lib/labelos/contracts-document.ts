/**
 * Makes and files a contract's PDF (LABEL-58). The file is a RESTRICTED
 * `project_assets` row of kind `contract` (migration 143 forces it) in the
 * private bucket, under `orgs/<org>/projects/<project>/…` like every other
 * org project file, so it is opened through the existing download route:
 * `contracts.read`, and every download is a `file.restricted_downloaded`
 * audit event.
 *
 * A contract with no release and no song in a project has no project to file
 * it in; it is not stored (nothing is invented outside a project) and the PDF
 * is made on request instead.
 */
import { nanoid } from 'nanoid';
import type { AdminClient } from '@/lib/auth/ownership';
import { contractDocumentFileName, renderContractDocumentPdf } from './contracts/document';
import type { ContractPartyLink, ContractRow, PartyIdentity } from './contracts/context';
import type { Rendered } from './contracts/render';
import { documentInputOf } from './contracts-route';
import { contractProjectId, findContractCopy, insertContractPdfRow, listContractCopies } from './contracts-store';
import { orgAssetObjectKey } from './org-assets';
import { deleteProjectAssetObject, storeProjectAsset } from '@/lib/storage/project-assets';

export type StoredCopy = { stored: true; reused: boolean; asset_id: string; project_id: string; file_name: string };
export type NotStored = { stored: false; reason: 'no_project' };

/** A signed or sent contract's copy is the one made at send: the name says `sent` whatever the later status. */
export const copyStatus = (status: string): 'draft' | 'sent' => (status === 'draft' ? 'draft' : 'sent');

/** The date line a PDF made AFTER sending carries: the people, addresses and titles are merged live, so it may differ from the sent text. */
export const rerenderNotice = (on: string) => `Re-rendered from current data on ${on}, not the copy that was sent.`;

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Make the PDF and file it. `atSend` = this IS the sent text (made in the same request that sent it); any other
 * PDF of a non-draft contract is a re-render from live data and says so on its first page.
 *
 * One file per version and status. A new DRAFT copy removes the contract's earlier draft copies (object and row), so
 * editing does not pile up restricted files; two concurrent requests are reconciled after the insert (the oldest
 * row wins, the loser deletes its own object and row).
 */
export async function storeContractPdf(
  admin: AdminClient,
  org: string,
  userId: string,
  row: ContractRow,
  links: readonly ContractPartyLink[],
  identities: ReadonlyMap<string, PartyIdentity>,
  rendered: Rendered,
  opts: { atSend?: boolean } = {},
): Promise<StoredCopy | NotStored> {
  const projectId = await contractProjectId(admin, org, row);
  if (!projectId) return { stored: false, reason: 'no_project' };
  const status = copyStatus(row.status);
  const fileName = contractDocumentFileName(row.id, row.version, status);
  const existing = await findContractCopy(admin, org, projectId, fileName);
  if (existing) return { stored: true, reused: true, asset_id: existing.asset_id, project_id: existing.project_id, file_name: fileName };

  const notice = status === 'sent' && !opts.atSend ? rerenderNotice(today()) : undefined;
  const pdf = await renderContractDocumentPdf({ ...documentInputOf(row, links, identities, rendered), ...(notice ? { notice } : {}) });
  const url = await storeProjectAsset(pdf, orgAssetObjectKey(org, projectId, nanoid(16), 'pdf'), 'application/pdf');
  let assetId: string;
  try {
    assetId = await insertContractPdfRow(admin, { org, projectId, createdBy: userId, url, fileName, size: pdf.length, label: `Contract · ${row.title} · v${row.version}` });
  } catch (err) {
    await deleteProjectAssetObject(url).catch(() => {});
    throw err;
  }

  // Two requests that both missed `existing`: the oldest row of this name stays.
  const same = await listContractCopies(admin, org, projectId, fileName);
  if (same.length > 1 && same[0].asset_id !== assetId) {
    await admin.from('project_assets').delete().eq('org_id', org).eq('id', assetId);
    await deleteProjectAssetObject(url).catch(() => {});
    return { stored: true, reused: true, asset_id: same[0].asset_id, project_id: projectId, file_name: fileName };
  }

  // A new draft copy replaces this contract's older draft copies.
  if (status === 'draft') {
    const stem = contractDocumentFileName(row.id, 0, 'draft').replace(/-v0-draft\.pdf$/, '-v');
    for (const old of await listContractCopies(admin, org, projectId, stem)) {
      if (old.asset_id === assetId || !old.file_name.endsWith('-draft.pdf')) continue;
      await admin.from('project_assets').delete().eq('org_id', org).eq('id', old.asset_id);
      await deleteProjectAssetObject(old.url).catch(() => {});
    }
  }
  return { stored: true, reused: false, asset_id: assetId, project_id: projectId, file_name: fileName };
}
