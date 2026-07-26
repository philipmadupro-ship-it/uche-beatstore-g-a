'use client';

/**
 * /settings/licenses — kept for backward-compat links.
 * The canonical location for the license builder is now /store-editor.
 * This page still renders the full LicenseBuilder component so direct
 * nav links continue to work, but it shows a banner pointing to the
 * store editor.
 */

import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { LicenseBuilder } from '@/components/store/LicenseBuilder';

export default function LicensesSettingsPage() {
  const router = useRouter();
  return (
    <DashboardLayout>
      <PageContainer className="max-w-[780px] pb-32">
        <PageHeader
          eyebrow="Settings / Store"
          title="License Builder"
          description="Define the tiers buyers see across checkout, shares, and the storefront."
          actions={
          <button
            onClick={() => router.push('/settings')}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] font-medium text-white/80 transition-colors hover:border-white/20 hover:text-white"
          >
            <ArrowLeft size={14} />
            Settings
          </button>
          }
        />

        {/* Redirect notice */}
        <div className="rounded-xl border border-white/ bg-white/5 p-4 mb-6 flex items-start gap-3">
          <ExternalLink size={13} className="text-white shrink-0 mt-0.5" />
          <div className="text-[11px] text-white/80 leading-relaxed">
            <p className="font-medium text-white mb-1">This section has moved</p>
            <p>
              License tiers are now managed in the{' '}
              <button
                onClick={() => router.push('/store-editor')}
                className="underline underline-offset-2 hover:text-white transition-colors"
              >
                Store Editor →
              </button>{' '}
              (License Tiers section). Changes made here are reflected there and vice versa.
            </p>
          </div>
        </div>

        <LicenseBuilder />
      </PageContainer>
    </DashboardLayout>
  );
}
