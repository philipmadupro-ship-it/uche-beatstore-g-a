/**
 * Producer reads of "my tracks" that still admit the pre-ownership arm
 * (`user_id IS NULL`) must not admit an ORGANIZATION's rows: Label OS rows are
 * ownerless too (mig 142: org_id set, user_id NULL), so that arm would hand
 * every producer every org's songs. Each such read is written as
 * `read(excludeOrg)` and run through here.
 *
 * Before migration 141 there is no `org_id` column and nothing to exclude, so
 * only a MISSING-schema error steps down to the plain read. Any other failure
 * is returned as is: the plain read is the one that lets org rows in.
 */
import { isMissingSchema } from '@/lib/artists/workspace-load';

export async function withoutOrgRows<T extends { error: unknown }>(read: (excludeOrg: boolean) => PromiseLike<T>): Promise<T> {
  const res = await read(true);
  if (res.error && isMissingSchema(res.error)) return read(false);
  return res;
}
