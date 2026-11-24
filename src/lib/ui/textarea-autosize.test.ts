import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { autosizeHeight, TEMPLATE_TEXTAREA_MAX_PX, TEMPLATE_TEXTAREA_MIN_PX } from './textarea-autosize';

describe('autosizeHeight', () => {
  it('never goes below the minimum, so an empty field is a small box, not 20 rows', () => {
    expect(autosizeHeight(0)).toEqual({ height: TEMPLATE_TEXTAREA_MIN_PX, scroll: false });
    expect(autosizeHeight(48)).toEqual({ height: TEMPLATE_TEXTAREA_MIN_PX, scroll: false });
  });
  it('grows to fit content between min and max', () => {
    expect(autosizeHeight(300.2)).toEqual({ height: 301, scroll: false });
  });
  it('stops at the maximum and asks for a scrollbar past it', () => {
    expect(autosizeHeight(900)).toEqual({ height: TEMPLATE_TEXTAREA_MAX_PX, scroll: true });
    expect(autosizeHeight(TEMPLATE_TEXTAREA_MAX_PX)).toEqual({ height: TEMPLATE_TEXTAREA_MAX_PX, scroll: false });
  });
  it('tolerates bad measurements', () => {
    expect(autosizeHeight(NaN).height).toBe(TEMPLATE_TEXTAREA_MIN_PX);
    expect(autosizeHeight(-5).height).toBe(TEMPLATE_TEXTAREA_MIN_PX);
  });
});

describe('LicenseTemplateEditor source pin', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/components/store-editor/LicenseTemplateEditor.tsx'), 'utf8');
  const start = src.indexOf('export function LicenseTemplateEditor');
  const body = src.slice(start);
  it('does not reserve a fixed row count for the contract textarea', () => {
    expect(body).toContain('<textarea');
    expect(body).not.toMatch(/rows=\{\d+\}/);
  });
  it('sizes the textarea from its content', () => {
    expect(body).toContain('autosizeHeight');
  });
});
