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
import { contractProjectId, findContractCopy, insertContractPdfRow } from './contracts-store';
import { orgAssetObjectKey } from './org-assets';
import { deleteProjectAssetObject, storeProjectAsset } from '@/lib/storage/project-assets';

export type StoredCopy = { stored: true; reused: boolean; asset_id: string; project_id: string; file_name: string };
export type NotStored = { stored: false; reason: 'no_project' };

export async function storeContractPdf(
  admin: AdminClient,
  org: string,
  userId: string,
  row: ContractRow,
  links: readonly ContractPartyLink[],
  identities: ReadonlyMap<string, PartyIdentity>,
  rendered: Rendered,
): Promise<StoredCopy | NotStored> {
  const projectId = await contractProjectId(admin, org, row);
  if (!projectId) return { stored: false, reason: 'no_project' };
  const fileName = contractDocumentFileName(row.id, row.version, row.status);
  const existing = await findContractCopy(admin, org, projectId, fileName);
  if (existing) return { stored: true, reused: true, ...existing, file_name: fileName };

  const pdf = await renderContractDocumentPdf(documentInputOf(row, links, identities, rendered));
  const url = await storeProjectAsset(pdf, orgAssetObjectKey(org, projectId, nanoid(16), 'pdf'), 'application/pdf');
  try {
    const assetId = await insertContractPdfRow(admin, { org, projectId, createdBy: userId, url, fileName, size: pdf.length, label: `Contract · ${row.title} · v${row.version}` });
    return { stored: true, reused: false, asset_id: assetId, project_id: projectId, file_name: fileName };
  } catch (err) {
    await deleteProjectAssetObject(url).catch(() => {});
    throw err;
  }
}
