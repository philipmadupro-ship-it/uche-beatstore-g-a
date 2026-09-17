'use client';

/**
 * Settings for the selected section, at the current breakpoint.
 *
 * The thing this panel has to get right is making inheritance legible. Every
 * control shows the value in force here, and a control whose value comes from
 * an override is badged and offers a reset — otherwise "why is mobile different"
 * becomes an archaeology exercise, which is the usual failure of responsive
 * editors that let you change anything anywhere.
 *
 * Editing on desktop writes the base and therefore flows down to every
 * breakpoint that has not deliberately diverged. Editing on tablet or mobile
 * writes an override for that breakpoint only. The header says which of those
 * is happening rather than leaving it to be inferred.
 */

import { Bookmark, ClipboardPaste, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import {
  overriddenKeys, resolveSection, supportsSetting,
  type SectionSettings, type StoreBreakpoint, type StoreSection,
} from '@/lib/store-editor/layout';
import { cn } from '@/lib/utils';
import {
  canvasBlockKinds, createCanvasBlock, removeCanvasBlock, resizeCanvasBlock,
  updateCanvasBlock, type CanvasBlockKind,
} from '@/lib/store-editor/canvas-blocks';
import type { CanvasBlock } from '@/lib/store-editor/layout';
import type { SectionStyle } from '@/lib/store-editor/section-style';

const VARIANTS: Partial<Record<StoreSection['kind'], { value: string; label: string }[]>> = {
  hero: [
    { value: 'default', label: 'Particle name' },
    { value: 'plain', label: 'Plain name' },
  ],
  catalog: [
    { value: 'list', label: 'List' },
    { value: 'grid', label: 'Grid' },
  ],
};

function Label({ children, overridden, onReset }: {
  children: React.ReactNode;
  overridden?: boolean;
  onReset?: () => void;
}) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{children}</span>
      {overridden ? (
        <button
          type="button"
          onClick={onReset}
          title="Reset to the desktop value"
          className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[#c8a47a] transition-colors hover:text-white/90"
        >
          <RotateCcw size={9} /> Override
        </button>
      ) : null}
    </span>
  );
}

export function SectionInspector({
  section, breakpoint, onSet, onClear, onContent, onBlocks, selectedBlockId, onSelectBlock,
  clipboardStyle, onCopyStyle, onPasteStyle, canPasteStyle, pasteStyleLabel, onSaveToLibrary,
}: {
  section: StoreSection | null;
  breakpoint: StoreBreakpoint;
  onSet: <K extends keyof SectionSettings>(key: K, value: SectionSettings[K]) => void;
  onClear: (key: keyof SectionSettings) => void;
  onContent: (patch: Record<string, string>) => void;
  /** Free-form blocks, for `canvas` sections. */
  onBlocks?: (blocks: CanvasBlock[]) => void;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string | null) => void;
  /** Reuse actions. Supplied by the builder, which owns the clipboard. */
  clipboardStyle?: SectionStyle | null;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  canPasteStyle?: boolean;
  pasteStyleLabel?: string;
  onSaveToLibrary?: () => void;
}) {
  if (!section) {
    return (
      <div className="px-4 py-5">
        <p className="text-[11px] leading-relaxed text-white/40">
          No section selected. Pick one from the stack, or click a section on the canvas.
        </p>
      </div>
    );
  }

  const settings = resolveSection(section, breakpoint);
  const overrides = overriddenKeys(section, breakpoint);
  const isOverridden = (key: keyof SectionSettings) => breakpoint !== 'desktop' && overrides.includes(key);
  // Only show a control the storefront will actually honour for this kind.
  // A control the preview obeys and the live page ignores is a lie, and the
  // producer only finds out after publishing.
  const can = (key: keyof SectionSettings) => supportsSetting(section.kind, key);
  const variants = can('variant') ? VARIANTS[section.kind] : undefined;

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="truncate text-[13px] text-white/90">{section.name}</p>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">
          {breakpoint === 'desktop'
            ? 'Editing the base — applies to every device'
            : `Editing ${breakpoint} only — desktop is unchanged`}
        </p>
      </div>

      {/* Reuse. Kept at the top because these act on the section as a whole,
          before any of the per-field controls below. */}
      {onCopyStyle || onSaveToLibrary ? (
        <div className="flex items-center gap-1 border-b border-white/10 px-4 py-2.5">
          {onCopyStyle ? (
            <button
              type="button"
              onClick={onCopyStyle}
              title="Copy this section's spacing, width and alignment"
              className="flex items-center gap-1.5 border border-white/10 px-2 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
            >
              <Copy size={11} /> Copy style
            </button>
          ) : null}
          {onPasteStyle ? (
            <button
              type="button"
              onClick={onPasteStyle}
              disabled={!canPasteStyle}
              // Disabled rather than hidden when it does not apply: a button
              // that vanishes leaves you wondering whether the copy worked.
              title={
                !clipboardStyle ? 'Copy a style from another section first'
                  : canPasteStyle ? pasteStyleLabel
                    : 'This section does not use any of the copied settings'
              }
              className="flex items-center gap-1.5 border border-white/10 px-2 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:text-white/20"
            >
              <ClipboardPaste size={11} /> Paste
            </button>
          ) : null}
          {onSaveToLibrary ? (
            <button
              type="button"
              onClick={onSaveToLibrary}
              title="Save this section to reuse it later"
              className="ml-auto flex items-center gap-1.5 border border-white/10 px-2 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
            >
              <Bookmark size={11} /> Save
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4 px-4 py-4">
        <label className="grid gap-1.5">
          <Label overridden={isOverridden('visible')} onReset={() => onClear('visible')}>Visible</Label>
          <div className="grid grid-cols-2 gap-1">
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={settings.visible === value}
                onClick={() => onSet('visible', value)}
                className={cn(
                  'h-8 border text-[11px] transition-colors',
                  settings.visible === value
                    ? 'border-white/40 bg-white/[0.12] text-white/90'
                    : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
                )}
              >
                {value ? 'Shown' : 'Hidden'}
              </button>
            ))}
          </div>
        </label>

        {variants ? (
          <div className="grid gap-1.5">
            <Label overridden={isOverridden('variant')} onReset={() => onClear('variant')}>Layout</Label>
            <Dropdown
              aria-label="Section layout"
              value={settings.variant}
              options={variants}
              onChange={(variant) => onSet('variant', variant)}
            />
          </div>
        ) : null}

        {can('columns') ? (
        <div className="grid gap-1.5">
          <Label overridden={isOverridden('columns')} onReset={() => onClear('columns')}>Columns</Label>
          <div className="grid grid-cols-6 gap-1">
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={settings.columns === count}
                onClick={() => onSet('columns', count)}
                className={cn(
                  'h-8 border text-[11px] tabular-nums transition-colors',
                  settings.columns === count
                    ? 'border-white/40 bg-white/[0.12] text-white/90'
                    : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
                )}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
        ) : null}

        <label className="grid gap-1.5">
          <Label overridden={isOverridden('spacing')} onReset={() => onClear('spacing')}>Spacing</Label>
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={settings.spacing}
              aria-label="Section spacing"
              onChange={(event) => onSet('spacing', Number(event.target.value))}
              className="h-1 w-full cursor-pointer appearance-none bg-white/10 accent-white"
            />
            <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-white/60">
              {settings.spacing}
            </span>
          </span>
        </label>

        <div className="grid gap-1.5">
          <Label overridden={isOverridden('width')} onReset={() => onClear('width')}>Width</Label>
          <div className="grid grid-cols-3 gap-1">
            {(['narrow', 'wide', 'full'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.width === value}
                onClick={() => onSet('width', value)}
                className={cn(
                  'h-8 border text-[11px] capitalize transition-colors',
                  settings.width === value
                    ? 'border-white/40 bg-white/[0.12] text-white/90'
                    : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {can('align') ? (
        <div className="grid gap-1.5">
          <Label overridden={isOverridden('align')} onReset={() => onClear('align')}>Align</Label>
          <div className="grid grid-cols-3 gap-1">
            {(['left', 'center', 'right'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={settings.align === value}
                onClick={() => onSet('align', value)}
                className={cn(
                  'h-8 border text-[11px] capitalize transition-colors',
                  settings.align === value
                    ? 'border-white/40 bg-white/[0.12] text-white/90'
                    : 'border-white/10 text-white/60 hover:border-white/25 hover:text-white/90',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        ) : null}

        {/* Content fields, only for the sections that carry their own copy. */}
        {(section.kind === 'text' || section.kind === 'image' || section.kind === 'video') ? (
          <div className="space-y-3 border-t border-white/10 pt-4">
            <label className="grid gap-1.5">
              <Label>Heading</Label>
              <input
                value={section.content?.heading ?? ''}
                onChange={(event) => onContent({ heading: event.target.value })}
                className="h-9 border border-white/10 bg-[#090907] px-2 text-[12px] text-white/90 outline-none focus:border-white/40"
              />
            </label>
            {section.kind === 'text' ? (
              <>
                <label className="grid gap-1.5">
                  <Label>Body</Label>
                  <textarea
                    value={section.content?.body ?? ''}
                    onChange={(event) => onContent({ body: event.target.value })}
                    className="min-h-24 border border-white/10 bg-[#090907] p-2 text-[12px] leading-relaxed text-white/90 outline-none focus:border-white/40"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1.5">
                    <Label>Button</Label>
                    <input
                      value={section.content?.ctaLabel ?? ''}
                      onChange={(event) => onContent({ ctaLabel: event.target.value })}
                      className="h-9 border border-white/10 bg-[#090907] px-2 text-[12px] text-white/90 outline-none focus:border-white/40"
                    />
                  </label>
                  <label className="grid gap-1.5">
                    <Label>Link</Label>
                    <input
                      value={section.content?.ctaHref ?? ''}
                      onChange={(event) => onContent({ ctaHref: event.target.value })}
                      className="h-9 border border-white/10 bg-[#090907] px-2 text-[12px] text-white/90 outline-none focus:border-white/40"
                    />
                  </label>
                </div>
              </>
            ) : null}
            {section.kind === 'image' ? (
              <label className="grid gap-1.5">
                <Label>Image URL</Label>
                <input
                  value={section.content?.imageUrl ?? ''}
                  onChange={(event) => onContent({ imageUrl: event.target.value })}
                  className="h-9 border border-white/10 bg-[#090907] px-2 text-[12px] text-white/90 outline-none focus:border-white/40"
                />
              </label>
            ) : null}
            {section.kind === 'video' ? (
              <label className="grid gap-1.5">
                <Label>Embed URL</Label>
                <input
                  value={section.content?.videoUrl ?? ''}
                  onChange={(event) => onContent({ videoUrl: event.target.value })}
                  placeholder="https://www.youtube.com/embed/…"
                  className="h-9 border border-white/10 bg-[#090907] px-2 text-[12px] text-white/90 outline-none placeholder:text-white/25 focus:border-white/40"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        {/* Free-form blocks. Positions are percentages of the section frame, so
            a hand-composed panel still reflows across device widths — see
            `lib/store-editor/canvas-blocks.ts`. */}
        {section.kind === 'canvas' && onBlocks ? (
          <div className="space-y-3 border-t border-white/10 pt-4">
            <span className="flex items-center justify-between">
              <Label>Blocks</Label>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">
                {(section.content?.blocks ?? []).length}
              </span>
            </span>

            <div className="grid grid-cols-3 gap-1">
              {canvasBlockKinds.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    const block = createCanvasBlock(kind as CanvasBlockKind);
                    onBlocks([...(section.content?.blocks ?? []), block]);
                    onSelectBlock?.(block.id);
                  }}
                  className="flex h-8 items-center justify-center gap-1 border border-white/10 text-[11px] capitalize text-white/60 transition-colors hover:border-white/25 hover:text-white/90"
                >
                  <Plus size={10} /> {kind}
                </button>
              ))}
            </div>

            {(section.content?.blocks ?? []).length === 0 ? (
              <p className="text-[11px] leading-relaxed text-white/40">
                No blocks yet. Add one, then drag it on the canvas.
              </p>
            ) : null}

            {(section.content?.blocks ?? []).map((block) => {
              const blocks = section.content?.blocks ?? [];
              const isSelected = block.id === selectedBlockId;
              return (
                <div
                  key={block.id}
                  className={cn(
                    'border transition-colors',
                    isSelected ? 'border-white/30 bg-white/[0.04]' : 'border-white/10',
                  )}
                >
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectBlock?.(isSelected ? null : block.id)}
                      className="min-w-0 flex-1 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-white/60 transition-colors hover:text-white/90"
                    >
                      {block.kind}
                    </button>
                    <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/25">
                      {Math.round(block.x)},{Math.round(block.y)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete ${block.kind} block`}
                      title="Delete block"
                      onClick={() => {
                        onBlocks(removeCanvasBlock(blocks, block.id));
                        if (isSelected) onSelectBlock?.(null);
                      }}
                      className="grid size-5 shrink-0 place-items-center text-white/40 transition-colors hover:text-white/90"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {isSelected ? (
                    <div className="space-y-2.5 border-t border-white/10 px-2 py-2.5">
                      {block.kind === 'text' ? (
                        <>
                          <label className="grid gap-1.5">
                            <Label>Text</Label>
                            <textarea
                              value={block.text ?? ''}
                              onChange={(event) => onBlocks(updateCanvasBlock(blocks, block.id, { text: event.target.value }))}
                              className="min-h-16 border border-white/10 bg-[#090907] p-2 text-[12px] text-white/90 outline-none focus:border-white/40"
                            />
                          </label>
                          <label className="grid gap-1.5">
                            <Label>Size</Label>
                            <input
                              type="range"
                              min={10}
                              max={72}
                              value={block.fontSize ?? 18}
                              aria-label="Block font size"
                              onChange={(event) => onBlocks(updateCanvasBlock(blocks, block.id, { fontSize: Number(event.target.value) }))}
                              className="h-1 w-full cursor-pointer appearance-none bg-white/10 accent-white"
                            />
                          </label>
                        </>
                      ) : null}

                      {block.kind === 'image' ? (
                        <label className="grid gap-1.5">
                          <Label>Image URL</Label>
                          <input
                            value={block.imageUrl ?? ''}
                            onChange={(event) => onBlocks(updateCanvasBlock(blocks, block.id, { imageUrl: event.target.value }))}
                            className="h-9 border border-white/10 bg-[#090907] px-2 text-[12px] text-white/90 outline-none focus:border-white/40"
                          />
                        </label>
                      ) : null}

                      {block.kind !== 'image' ? (
                        <label className="grid gap-1.5">
                          <Label>Colour</Label>
                          <span className="flex items-center gap-2 border border-white/10 bg-[#090907] p-1 focus-within:border-white/40">
                            <input
                              type="color"
                              value={/^#[0-9a-f]{6}$/i.test(block.color ?? '') ? block.color : '#FFFFFF'}
                              aria-label="Block colour"
                              onChange={(event) => onBlocks(updateCanvasBlock(blocks, block.id, { color: event.target.value }))}
                              className="size-7 cursor-pointer border-0 bg-transparent p-0"
                            />
                            <span className="font-mono text-[11px] text-white/60">{block.color}</span>
                          </span>
                        </label>
                      ) : null}

                      <div className="grid grid-cols-2 gap-2">
                        <label className="grid gap-1.5">
                          <Label>Width</Label>
                          <input
                            type="range"
                            min={4}
                            max={100}
                            value={block.width}
                            aria-label="Block width"
                            onChange={(event) => onBlocks(resizeCanvasBlock(blocks, block.id, Number(event.target.value), block.height))}
                            className="h-1 w-full cursor-pointer appearance-none bg-white/10 accent-white"
                          />
                        </label>
                        <label className="grid gap-1.5">
                          <Label>Height</Label>
                          <input
                            type="range"
                            min={4}
                            max={100}
                            value={block.height}
                            aria-label="Block height"
                            onChange={(event) => onBlocks(resizeCanvasBlock(blocks, block.id, block.width, Number(event.target.value)))}
                            className="h-1 w-full cursor-pointer appearance-none bg-white/10 accent-white"
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
