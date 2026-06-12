import { describe, it, expect } from 'vitest';
import { emailShell, emailButton, emailFooter, emailItemTable, emailHeading } from './templates';

describe('email templates', () => {
  it('wraps body in the shell with an eyebrow', () => {
    const html = emailShell('New drop', '<p>hi</p>');
    expect(html).toContain('New drop');
    expect(html).toContain('<p>hi</p>');
    expect(html).toContain('#090907');
  });

  it('renders a button with the href', () => {
    const btn = emailButton('Listen', 'https://x.test/store/1');
    expect(btn).toContain('https://x.test/store/1');
    expect(btn).toContain('Listen');
  });

  it('renders an item table with right-aligned values', () => {
    const t = emailItemTable([{ label: 'Beat A', value: '$20.00' }, { label: 'Beat B' }]);
    expect(t).toContain('Beat A');
    expect(t).toContain('$20.00');
    expect(t).toContain('Beat B');
    expect(t.match(/<tr>/g)?.length).toBe(2);
  });

  it('footer includes a manage link', () => {
    const f = emailFooter('You follow Zeta', 'https://x.test/store/account');
    expect(f).toContain('Manage');
    expect(f).toContain('https://x.test/store/account');
  });

  it('heading honors a custom color', () => {
    expect(emailHeading('Hi', '#6DC6A4')).toContain('#6DC6A4');
  });
});
