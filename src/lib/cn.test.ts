import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('shadcn cn', () => {
  it('lets the later class win a real conflict', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('bg-primary', 'bg-white/10')).toBe('bg-white/10');
  });

  it('never drops an app type utility for sitting next to a text colour', () => {
    // The failure this guards: default tailwind-merge reads `text-meta` as a
    // colour and discards it in favour of `text-white/40`.
    expect(cn('text-meta', 'text-white/40')).toBe('text-meta text-white/40');
    expect(cn('text-eyebrow text-white/60')).toBe('text-eyebrow text-white/60');
    expect(cn('text-row-title', 'text-[#c8a47a]')).toBe('text-row-title text-[#c8a47a]');
  });

  it('still lets one app type size replace another', () => {
    expect(cn('text-micro', 'text-meta')).toBe('text-meta');
  });

  it('accepts the clsx shapes shadcn components pass', () => {
    expect(cn('a', { b: true, c: false }, ['d', null, undefined])).toBe('a b d');
  });
});
