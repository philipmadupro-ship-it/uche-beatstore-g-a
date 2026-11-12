'use client';

/**
 * `/o/<slug>/settings/members`: the "Team and roster" window (LABEL-50).
 * Everything lives in `components/labelos/TeamRosterWindow`, so the page and
 * any other host render one component.
 */
import { TeamRosterWindow } from '@/components/labelos/TeamRosterWindow';

export default function OrgMembersPage() {
  return <TeamRosterWindow />;
}
