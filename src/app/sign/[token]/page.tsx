import { SignWithLink } from '@/components/labelos/SignWithLink';

/**
 * /sign/[token] — an external signer's page (LABEL-60, no account). Everything
 * is decided by /api/sign/[token]; this page only renders it. Behind
 * LABEL_OS_ENABLED (src/proxy.ts), like the rest of Label OS.
 */
export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignWithLink token={token} />;
}
