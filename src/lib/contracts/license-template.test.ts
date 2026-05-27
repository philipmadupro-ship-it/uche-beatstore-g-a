import { describe, it, expect } from 'vitest';
import { fillTemplate, DEFAULT_TEMPLATE_MD, VARIABLE_LIST, type ContractVariables } from './license-template';

const sample: ContractVariables = {
  buyer_name: 'Jordan Reese',
  buyer_email: 'jordan@example.com',
  track_titles: 'Yeat Synth · 808 Bloom',
  license_type: 'Lease',
  purchase_date: 'May 27, 2026',
  purchase_id: '7f80b367',
  producer_name: 'Uche2crazyyyy',
  producer_email: 'uche2crazyyy@gmail.com',
  price: '$135.00',
};

describe('license template', () => {
  it('substitutes every known variable', () => {
    const filled = fillTemplate(DEFAULT_TEMPLATE_MD, sample);
    expect(filled).toContain('Jordan Reese');
    expect(filled).toContain('jordan@example.com');
    expect(filled).toContain('Yeat Synth · 808 Bloom');
    expect(filled).toContain('Lease');
    expect(filled).toContain('May 27, 2026');
    expect(filled).toContain('7f80b367');
    expect(filled).toContain('Uche2crazyyyy');
    expect(filled).toContain('uche2crazyyy@gmail.com');
    expect(filled).toContain('$135.00');
    expect(filled).not.toMatch(/\{\{[a-z_]+\}\}/);
  });

  it('leaves unknown variables untouched so a typo is visible', () => {
    const tpl = 'Hello {{buyer_name}}, your code is {{nonexistent_var}}.';
    const out = fillTemplate(tpl, sample);
    expect(out).toBe('Hello Jordan Reese, your code is {{nonexistent_var}}.');
  });

  it('VARIABLE_LIST keys all appear in the default template', () => {
    for (const v of VARIABLE_LIST) {
      expect(DEFAULT_TEMPLATE_MD).toContain(`{{${v.key}}}`);
    }
  });

  it('handles empty / missing template input safely', () => {
    expect(fillTemplate('', sample)).toBe('');
    expect(fillTemplate('no variables here', sample)).toBe('no variables here');
  });
});
