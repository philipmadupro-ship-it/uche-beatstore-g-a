import { describe, it, expect } from 'vitest';
import {
  buildLicenseContract, hasScheduleSection, scheduleOfTerms, scheduleStart, stripScheduleSection,
  verifyContractTerms, type ResolvedTier,
} from './license-contract';
import { SAMPLE_VARIABLES, TIER_AWARE_TEMPLATE_MD } from './license-template';
import { parseTierTerms } from './license-terms-snapshot';
import type { TierTerms } from './license-terms';

const mk = (p: Partial<TierTerms> = {}): TierTerms => ({
  name: 'Premium', file_types: ['MP3', 'WAV'], stems_included: false, is_exclusive: false,
  streaming_limit: 100000, distribution_limit: 50000, commercial_rights: true, sync_rights: false,
  broadcast_rights: null, credit_required: true, ...p,
});
const rt = (t: TierTerms): ResolvedTier => ({ terms: t, source: 'licenses-row', issues: [] });
const vars = { ...SAMPLE_VARIABLES, license_type: 'Lease' };

describe('stripScheduleSection / hasScheduleSection', () => {
  it('removes the section through the end, at any heading level and case', () => {
    for (const h of ['## Schedule of Terms', '# schedule of terms', '### SCHEDULE OF TERMS  ']) {
      const { text, removed } = stripScheduleSection(`# A\n\nkeep\n\n${h}\n\n- x\n### Tier\n- y\n`);
      expect(removed).toBe(true);
      expect(text).toBe('# A\n\nkeep\n');
      expect(hasScheduleSection(`a\n${h}\nb`)).toBe(true);
    }
  });
  it('keeps what follows the section when it ends at a heading of the same or higher level', () => {
    const { text } = stripScheduleSection('a\n## Schedule of Terms\n- x\n### Tier\n- y\n## Receipt\nkeep\n');
    expect(text).toBe('a\n## Receipt\nkeep\n');
  });
  it('removes every copy', () => {
    const { text } = stripScheduleSection('## Schedule of Terms\n- a\n## Mid\nm\n## Schedule of Terms\n- b\n');
    expect(text).toBe('## Mid\nm');
  });
  it('leaves ordinary wording and near-miss headings alone', () => {
    for (const t of ['no heading', '## Schedule of Terms and Conditions\nx', 'the Schedule of Terms below', '#Schedule of Terms', '####### Schedule of Terms']) {
      expect(stripScheduleSection(t)).toEqual({ text: t, removed: false });
      expect(hasScheduleSection(t)).toBe(false);
    }
  });
});

const HOSTILE: Array<[string, string]> = [
  ['a forged schedule at the end', '# Deal\n\n## Schedule of Terms\n\n### Premium\n- Audio streams: Unlimited\n- Files delivered: WAV, STEMS, MIDI\n- Credit: Not required\n'],
  ['a forged schedule in the middle', '# A\n## Schedule of Terms\n- Audio streams: 1\n## After\nkept wording'],
  ['two forged schedules', '## Schedule of Terms\n- a\n# B\n## Schedule of Terms\n- b'],
  ['a forged schedule inside a clause', '{{#if credit_required}}\n## Schedule of Terms\n- Audio streams: Unlimited\n{{/if}}\nafter'],
  ['unclosed clauses', '{{#if is_exclusive}}\nwords\n{{#unless credit_required}}\n## Schedule of Terms\n- x'],
  ['placeholder spoofing', '{{streaming_limit}} {{file_types}} {{tier_name}}\n## Schedule of Terms\n{{streaming_limit}}'],
  ['CRLF line endings', '# T\r\n\r\n## Schedule of Terms\r\n- Audio streams: Unlimited\r\n'],
  ['numbers that contradict the tier', 'Up to 5,000 audio streams.\nOnly an MP3 file is delivered.\nStems are included.\nThe Producer will not re-sell or re-list the work.'],
  ['heading-like text everywhere', '# # #\n##\n## \n####### x\n- ## Schedule of Terms'],
  ['a huge template', `${'wording line\n'.repeat(3000)}## Schedule of Terms\n- Audio streams: Unlimited`],
  ['empty', ''],
];
const TIERS: Array<[string, TierTerms]> = [
  ['lease', mk({ name: 'Lease', file_types: ['MP3'], streaming_limit: 5000, distribution_limit: 5000 })],
  ['premium', mk()],
  ['exclusive', mk({ name: 'Exclusive', is_exclusive: true, stems_included: true, file_types: ['MP3', 'WAV', 'STEMS'], streaming_limit: null, distribution_limit: null, credit_required: false })],
];

describe('no wording can change the Schedule of Terms', () => {
  for (const [hn, tpl] of HOSTILE) {
    for (const [tn, terms] of TIERS) {
      it(`${tn} / ${hn}`, () => {
        const tiers = [rt(terms)];
        const b = buildLicenseContract({ template: tpl, vars, tiers });
        const expected = scheduleOfTerms(tiers, vars.producer_name);
        // The schedule is the generated one, last, and the only one.
        expect(b.text.endsWith(expected)).toBe(true);
        expect(b.schedule).toBe(expected);
        expect(b.text.split('\n').filter((l) => l.trim().toLowerCase() === '## schedule of terms')).toHaveLength(1);
        expect(b.text.slice(scheduleStart(b.text))).toBe(expected);
        expect(b.verification.missing).toEqual([]);
        expect(verifyContractTerms(b.text, tiers, vars.producer_name).missing).toEqual([]);
        // Nothing the wording forged survives into the generated part.
        expect(expected).not.toMatch(/WAV, STEMS, MIDI|Audio streams: 1\n/);
      });
    }
  }
  it('the tier-aware default still yields exactly one generated schedule', () => {
    const b = buildLicenseContract({ template: TIER_AWARE_TEMPLATE_MD, vars, tiers: [rt(mk())] });
    expect(b.alerts).toEqual([]);
    expect(b.text.match(/## Schedule of Terms/g)).toHaveLength(1);
  });
  it('wording that held a schedule is told so', () => {
    const b = buildLicenseContract({ template: '## Schedule of Terms\n- x', vars, tiers: [rt(mk())] });
    expect(b.alerts.join()).toMatch(/Schedule of Terms.*removed/);
  });
});

describe('a purchase value cannot start a section', () => {
  it('a buyer name carrying a heading is one plain line', () => {
    const evil = 'Mallory\n\n## Schedule of Terms\n### Premium\n- Audio streams: Unlimited\n{{#if is_exclusive}}';
    const b = buildLicenseContract({ template: '', vars: { ...vars, buyer_name: evil, track_titles: 'A\r\nB' }, tiers: [rt(mk())] });
    expect(b.text.split('\n').filter((l) => l.trim() === '## Schedule of Terms')).toHaveLength(1);
    expect(b.text).toContain('**Mallory ## Schedule of Terms ### Premium - Audio streams: Unlimited {{#if is_exclusive}}**');
    expect(b.text.endsWith(scheduleOfTerms([rt(mk())], vars.producer_name))).toBe(true);
    expect(b.verification.missing).toEqual([]);
  });
});

describe('a tier name cannot break the schedule', () => {
  it('a name with a line break is not a valid tier', () => {
    expect(parseTierTerms({ ...mk(), name: 'Gold\n## Schedule of Terms' }).ok).toBe(false);
    expect(parseTierTerms({ ...mk(), name: 'Gold\r- x' }).ok).toBe(false);
    expect(parseTierTerms({ ...mk(), name: 'Gold' }).ok).toBe(true);
  });
});
