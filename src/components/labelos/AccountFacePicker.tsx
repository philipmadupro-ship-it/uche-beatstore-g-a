'use client';

/**
 * "What are you?" — the two account faces (lib/labelos/setup.ts) as a
 * radio group of two cards. Used on sign-up (/login) and on /setup.
 *
 * A native radio group (one Tab stop, arrows move the choice) styled with the
 * control language: rest bg-white/[0.06] + border-white/10, selected
 * bg-white/[0.14] + border-white/30 and a check mark (state, not colour,
 * carries the choice); 12px cards.
 */
import { Building2, CheckCircle2, User } from 'lucide-react';
import { FACE_COPY, SETUP_FACES, type SetupFace } from '@/lib/labelos/setup';

const ICONS: Record<SetupFace, typeof User> = { independent: User, label: Building2 };

export function AccountFacePicker({
  value,
  onChange,
  disabled = false,
  name = 'account-face',
  legend = 'I am',
}: {
  value: SetupFace | null;
  onChange: (face: SetupFace) => void;
  disabled?: boolean;
  name?: string;
  legend?: string;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {SETUP_FACES.map((face) => {
          const Icon = ICONS[face];
          const selected = value === face;
          return (
            <label
              key={face}
              data-testid={`face-${face}`}
              className={`relative flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/40 ${
                selected
                  ? 'border-white/30 bg-white/[0.14]'
                  : 'border-white/10 bg-white/[0.06] hover:border-white/20 hover:bg-white/[0.10]'
              } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <input
                type="radio"
                name={name}
                value={face}
                checked={selected}
                onChange={() => onChange(face)}
                className="sr-only"
              />
              <span className={`flex items-center gap-2 text-[13px] ${selected ? 'text-white' : 'text-white/80'}`}>
                <Icon className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                <span className="min-w-0 flex-1">{FACE_COPY[face].title}</span>
                {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-white" aria-hidden /> : null}
              </span>
              <span className="text-[11px] leading-snug text-white/60">{FACE_COPY[face].blurb}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
