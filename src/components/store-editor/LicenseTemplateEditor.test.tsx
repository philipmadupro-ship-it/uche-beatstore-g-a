// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LicenseTemplateEditor, type TemplateTier } from './LicenseTemplateEditor';
import { DEFAULT_TEMPLATE_MD, TIER_AWARE_TEMPLATE_MD } from '@/lib/contracts/license-template';

afterEach(cleanup);

const tiers: TemplateTier[] = [{
  id: 't1', name: 'Gold', is_exclusive: false, file_types: ['MP3', 'WAV'], stems_included: false,
  streaming_limit: 250000, distribution_limit: null, commercial_rights: true, sync_rights: false,
  broadcast_rights: false, credit_required: false,
}];

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <LicenseTemplateEditor value={v} onChange={setV} tiers={tiers} />;
}
const area = () => screen.getByPlaceholderText(/default template/i) as HTMLTextAreaElement;

describe('LicenseTemplateEditor', () => {
  it('inserts a tier term at the caret', () => {
    render(<Harness initial="Limit: ." />);
    area().setSelectionRange(7, 7);
    fireEvent.click(screen.getByRole('button', { name: '+Streaming limit' }));
    expect(area().value).toBe('Limit: {{streaming_limit}}.');
  });

  it('wraps the selected line in a clause', () => {
    render(<Harness initial={'one\ntwo\nthree'} />);
    area().setSelectionRange(5, 6);
    fireEvent.click(screen.getByRole('button', { name: 'If Credit required' }));
    expect(area().value).toBe('one\n{{#if credit_required}}\ntwo\n{{/if}}\nthree');
  });

  it('adds a starter clause when nothing is selected', () => {
    render(<Harness initial="" />);
    fireEvent.click(screen.getByRole('button', { name: 'If Stems included' }));
    expect(area().value).toContain('{{#if stems_included}}');
    expect(area().value).toContain('{{/if}}');
  });

  it('Use default keeps the default byte-identical; tier-aware default is a second choice', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    expect(area().value).toBe(DEFAULT_TEMPLATE_MD);
    fireEvent.click(screen.getByRole('button', { name: 'Use tier-aware default' }));
    expect(area().value).toBe(TIER_AWARE_TEMPLATE_MD);
  });

  it('previews as a sample lease, a sample exclusive and a real tier', () => {
    render(<Harness initial={'Streams: {{streaming_limit}}\n{{#if credit_required}}\nCredit line\n{{/if}}'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const text = () => screen.getByTestId('license-template-preview').textContent;
    expect(text()).toBe('Streams: 5,000 streams\nCredit line');
    fireEvent.click(screen.getByRole('radio', { name: 'Sample exclusive' }));
    expect(text()).toBe('Streams: Unlimited');
    fireEvent.click(screen.getByRole('radio', { name: 'Gold' }));
    expect(text()).toBe('Streams: 250,000 streams');
  });

  it('flags unknown placeholders and unclosed clauses', () => {
    render(<Harness initial={'{{buyer_nme}}\n{{#if credit_required}}\nx'} />);
    const list = screen.getByTestId('license-template-problems').textContent;
    expect(list).toContain('Unknown placeholder {{buyer_nme}}');
    expect(list).toContain('Clause never closed');
  });

  it('shows no problem list for a clean template', () => {
    render(<Harness initial={DEFAULT_TEMPLATE_MD} />);
    expect(screen.queryByTestId('license-template-problems')).toBeNull();
  });
});
