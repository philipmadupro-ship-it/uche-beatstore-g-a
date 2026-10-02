/**
 * `/o/<slug>` — the org's Overview is LABEL-18's page. Until it exists, the
 * org's front door is its members page, so links that end on the org (the
 * join page's "Open <org>", the switcher) land somewhere real.
 */
import { redirect } from 'next/navigation';

export default async function OrgHome({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  redirect(`/o/${encodeURIComponent(orgSlug)}/settings/members`);
}
