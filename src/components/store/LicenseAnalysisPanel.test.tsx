// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LicenseAnalysisPanel } from './LicenseAnalysisPanel';
import { analyzeLicenseTiers, type TierDraft } from '@/lib/license/analysis';

const base: TierDraft = {
  id: 'a', name: 'Exclusive', price_usd: 400, is_free: false, file_types: ['MP3'], stems_included: false,
  is_exclusive: true, streaming_limit: null, distribution_limit: null,
  commercial_rights: true, sync_rights: false, broadcast_rights: false, credit_required: false,
};

describe('LicenseAnalysisPanel', () => {
  it('is collapsed by default, with the count in the header', () => {
    render(<LicenseAnalysisPanel tierId="a" analysis={analyzeLicenseTiers({ tiers: [base] })} />);
    expect(screen.getByText('1 to look at')).toBeTruthy();
    expect(screen.queryByText('Automatic check — not legal advice.')).toBeNull();
  });
  it('opens to the disclaimer, finding and suggestion', () => {
    render(<LicenseAnalysisPanel tierId="a" analysis={analyzeLicenseTiers({ tiers: [base] })} />);
    fireEvent.click(screen.getByRole('button', { name: /check this tier/i }));
    expect(screen.getByText('Automatic check — not legal advice.')).toBeTruthy();
    expect(screen.getByTestId('license-finding').getAttribute('data-code')).toBe('EXCLUSIVE_NO_WAV');
    expect(screen.getByText('Risk')).toBeTruthy();
  });
  it('a clean tier says so, and the count follows the edit', () => {
    const clean = { ...base, file_types: ['MP3', 'WAV'], stems_included: true };
    const { rerender } = render(<LicenseAnalysisPanel tierId="a" analysis={analyzeLicenseTiers({ tiers: [{ ...clean, file_types: ['MP3', 'WAV', 'STEMS'] }] })} />);
    expect(screen.getByText('Nothing to flag')).toBeTruthy();
    rerender(<LicenseAnalysisPanel tierId="a" analysis={analyzeLicenseTiers({ tiers: [{ ...clean, file_types: [] }] })} />);
    expect(screen.queryByText('Nothing to flag')).toBeNull();
  });
});
