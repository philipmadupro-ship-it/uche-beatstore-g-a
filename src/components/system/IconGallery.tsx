import { ICONS, ICON_SIZE, ICON_STROKE, type IconConcept } from '@/lib/ui/icons';

/**
 * The icon map made visible: every concept in `lib/ui/icons.ts` with its one
 * lucide icon, then the size and stroke scales. Dev surface only (see the
 * page). Server component: nothing here is interactive.
 */
const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

export function IconGallery() {
  const concepts = Object.keys(ICONS) as IconConcept[];
  return (
    <div className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      <header className="space-y-2">
        <h1 className="font-heading text-4xl text-white/80">Icons</h1>
        <p className="text-[11px] text-white/60">
          One concept, one lucide icon. Import from <code className="font-mono">@/lib/ui/icons</code> instead of picking inline.
        </p>
      </header>

      <section aria-labelledby="icon-map" className="space-y-4">
        <h2 id="icon-map" className={LABEL}>Concept map</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {concepts.map((concept) => {
            const Icon = ICONS[concept];
            return (
              <li key={concept} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3">
                <Icon size={ICON_SIZE.lg} aria-hidden className="shrink-0 text-white/80" />
                <div className="min-w-0">
                  <p className="truncate text-[11px] text-white/80">{concept}</p>
                  <p className="truncate font-mono text-[10px] text-white/40">{Icon.displayName ?? ''}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="icon-sizes" className="space-y-4">
        <h2 id="icon-sizes" className={LABEL}>Sizes by role</h2>
        <ul className="flex flex-wrap gap-3">
          {(Object.keys(ICON_SIZE) as (keyof typeof ICON_SIZE)[]).map((role) => {
            const Icon = ICONS.store;
            return (
              <li key={role} className="flex w-32 flex-col items-center gap-2 rounded-xl border border-white/10 bg-[#0D0D0A] p-3">
                <Icon size={ICON_SIZE[role]} aria-hidden className="text-white/80" />
                <p className="text-[11px] text-white/80">{role}</p>
                <p className="font-mono text-[10px] text-white/40">{ICON_SIZE[role]}px</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="icon-strokes" className="space-y-4">
        <h2 id="icon-strokes" className={LABEL}>Stroke widths</h2>
        <ul className="flex flex-wrap gap-3">
          {(Object.keys(ICON_STROKE) as (keyof typeof ICON_STROKE)[]).map((name) => {
            const Icon = ICONS.success;
            return (
              <li key={name} className="flex w-32 flex-col items-center gap-2 rounded-xl border border-white/10 bg-[#0D0D0A] p-3">
                <Icon size={ICON_SIZE.xl} strokeWidth={ICON_STROKE[name]} aria-hidden className="text-white/80" />
                <p className="text-[11px] text-white/80">{name}</p>
                <p className="font-mono text-[10px] text-white/40">{ICON_STROKE[name]}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
