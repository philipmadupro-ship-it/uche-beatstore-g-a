'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { autosizeHeight } from '@/lib/ui/textarea-autosize';
import {
  ALL_VARIABLE_KEYS, DEFAULT_TEMPLATE_MD, TIER_AWARE_TEMPLATE_MD, VARIABLE_LIST, previewTemplate,
} from '@/lib/contracts/license-template';
import {
  CLAUSE_FLAG_LIST, TERM_VARIABLE_LIST, legacyTierTerms, lintTemplate, tierTermsFromRow, wrapInClause,
  type ClauseFlag, type TierTerms,
} from '@/lib/contracts/license-terms';

/** A tier the producer built in the License Builder (a `licenses` row, possibly partial). */
export type TemplateTier = Record<string, unknown> & { id: string; name: string };

const textareaCls = 'w-full bg-white/[0.02] border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/40 transition-colors resize-none leading-relaxed';
const chipCls = 'px-2 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/10 text-white/80 hover:bg-white/[0.10] hover:border-white/20 hover:text-white transition-colors';
const groupLabelCls = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

/**
 * Markdown editor for the producer's license-contract template.
 *
 * Three groups of controls insert into the text at the caret: purchase details
 * ({{buyer_name}}…), tier terms ({{streaming_limit}}… filled from the tier the
 * buyer actually bought) and optional clauses (a line block that appears only
 * when the tier grants that right). Preview fills the template through the same
 * code the purchase uses, as a sample Lease, a sample Exclusive or one of the
 * producer's own tiers.
 */
export function LicenseTemplateEditor({
  value,
  onChange,
  tiers = [],
}: { value: string; onChange: (v: string) => void; tiers?: TemplateTier[] }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewAs, setPreviewAs] = useState<string>('sample-lease');

  // Grow with the content (min 160px, max 480px, scroll past it). Runs on every
  // value change (typing, a chip, a clause wrap, either default) and when leaving
  // Preview, because that remounts the textarea.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const { height, scroll } = autosizeHeight(el.scrollHeight);
    el.style.height = `${height}px`;
    el.style.overflowY = scroll ? 'auto' : 'hidden';
  }, [value, preview]);

  const insertVar = (key: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange((value ?? '') + ` {{${key}}}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const token = `{{${key}}}`;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const insertClause = (flag: ClauseFlag) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = wrapInClause(value, start, end, flag);
    onChange(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const previewOptions = useMemo(() => ([
    { id: 'sample-lease', label: 'Sample lease', terms: legacyTierTerms('lease') },
    { id: 'sample-exclusive', label: 'Sample exclusive', terms: legacyTierTerms('exclusive') },
    ...tiers.map((t) => ({
      id: `tier-${t.id}`,
      label: t.name,
      terms: tierTermsFromRow(t, t.is_exclusive === true ? 'exclusive' : 'lease'),
    })),
  ] as Array<{ id: string; label: string; terms: TierTerms }>), [tiers]);
  const selected = previewOptions.find((o) => o.id === previewAs) ?? previewOptions[0];

  const filledPreview = useMemo(
    () => previewTemplate(value ?? '', [selected.terms]),
    [value, selected],
  );
  const problems = useMemo(() => lintTemplate(value ?? '', ALL_VARIABLE_KEYS), [value]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/40">
        Filled in at every purchase and attached as a PDF to the delivery email. Markdown supported (# heading, ** bold **, - bullet). Leave empty to use the default template.
      </p>

      <div className="space-y-2">
        <p className={groupLabelCls}>Purchase details</p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLE_LIST.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVar(v.key)}
              title={`Insert {{${v.key}}} — sample: ${v.sample}`}
              className={chipCls}
            >
              +{v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className={groupLabelCls}>Tier terms</p>
        <p className="text-[10px] text-white/40">Filled from the license tier the buyer bought, as set in the License Builder.</p>
        <div className="flex flex-wrap gap-1.5">
          {TERM_VARIABLE_LIST.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVar(v.key)}
              title={`Insert {{${v.key}}} — sample: ${v.sample}`}
              className={chipCls}
            >
              +{v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className={groupLabelCls}>Optional clauses</p>
        <p className="text-[10px] text-white/40">Wraps the selected lines (or adds a starter line) so they appear only when the tier grants it.</p>
        <div className="flex flex-wrap gap-1.5">
          {CLAUSE_FLAG_LIST.map((f) => (
            <button
              key={f.flag}
              type="button"
              onClick={() => insertClause(f.flag)}
              title={`Show a block only when the tier has: ${f.label}`}
              className={chipCls}
            >
              If {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(DEFAULT_TEMPLATE_MD)}
          className="px-3 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/10 text-white/80 hover:bg-white/[0.10] hover:border-white/20 hover:text-white transition-colors"
        >
          Use default
        </button>
        <button
          type="button"
          onClick={() => onChange(TIER_AWARE_TEMPLATE_MD)}
          title="A starting point that states each tier's own limits and rights"
          className="px-3 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/10 text-white/80 hover:bg-white/[0.10] hover:border-white/20 hover:text-white transition-colors"
        >
          Use tier-aware default
        </button>
        <button
          type="button"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
          className={`ml-auto px-3 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-colors ${
            preview ? 'bg-white text-black border-white/30' : 'bg-transparent text-white/80 border-white/20 hover:bg-white/[0.06]'
          }`}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {problems.length > 0 && (
        <ul data-testid="license-template-problems" className="space-y-0.5 text-[10px] text-[#c8a47a]">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      {preview ? (
        <div className="space-y-2">
          <div role="radiogroup" aria-label="Preview as" className="flex flex-wrap items-center gap-1.5">
            <span className={groupLabelCls}>Preview as</span>
            {previewOptions.map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={o.id === selected.id}
                onClick={() => setPreviewAs(o.id)}
                className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider border transition-colors ${
                  o.id === selected.id
                    ? 'bg-white/[0.14] border-white/30 text-white'
                    : 'bg-white/[0.06] border-white/10 text-white/80 hover:bg-white/[0.10] hover:border-white/20'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <pre
            data-testid="license-template-preview"
            className="bg-[#090907] border border-white/10 rounded-lg p-4 text-[11px] text-white leading-relaxed whitespace-pre-wrap font-sans max-h-[480px] overflow-auto"
          >
            {filledPreview}
          </pre>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Leave empty to use the default template."
          className={`${textareaCls} font-mono text-[11px] leading-relaxed`}
        />
      )}
    </div>
  );
}
