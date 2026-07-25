import { notFound } from 'next/navigation';
import { CoverArtStudioClient } from '@/components/cover-art/CoverArtStudioClient';
import { canAccessDesignSystemLab } from '@/design-system/dev-access';

export const metadata = {
  title: 'Beatstor Design System Lab',
};

export default function DesignSystemLabPage() {
  if (!canAccessDesignSystemLab()) notFound();
  return <CoverArtStudioClient />;
}
