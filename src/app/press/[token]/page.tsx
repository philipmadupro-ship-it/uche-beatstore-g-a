import { PressKitPage } from '@/components/labelos/PressKitPage';

/**
 * /press/[token] — a shared press kit (LABEL-66, no account). Everything is
 * decided by /api/press/[token]; this page only renders it. Behind
 * LABEL_OS_ENABLED (src/proxy.ts), like the rest of Label OS.
 */
export default async function PressPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PressKitPage token={token} />;
}
