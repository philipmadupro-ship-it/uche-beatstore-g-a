import { notFound } from 'next/navigation';
import { IconGallery } from '@/components/system/IconGallery';
import { canAccessDesignSystemLab } from '@/design-system/dev-access';

export const metadata = {
  title: 'Beatstor Icon Map',
};

export default function IconGalleryPage() {
  if (!canAccessDesignSystemLab()) notFound();
  return <IconGallery />;
}
