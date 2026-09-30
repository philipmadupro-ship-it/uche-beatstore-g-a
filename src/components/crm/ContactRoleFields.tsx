'use client';

/**
 * A contact's role: the main one (`category`) and one extra
 * (`secondary_category`, mig 134). Together they decide which tabs of
 * /contacts the contact appears in (lib/contacts/roles) — an artist who also
 * produces is under Artists and Producers.
 */

import { Dropdown } from '@/components/ui/Dropdown';
import { CONTACT_CATEGORIES, ROLE_GROUP_LABEL, contactGroups } from '@/lib/contacts/roles';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

function label(c: string): string {
  return c === 'a&r' ? 'A&R' : `${c[0].toUpperCase()}${c.slice(1)}`;
}

function options(current: string | null | undefined, exclude: string | null | undefined, none: string) {
  const list: string[] = [...CONTACT_CATEGORIES];
  // Keep a free-text value from an import or an older form selectable.
  if (current && !list.includes(current)) list.push(current);
  return [{ value: '', label: none }, ...list.filter((c) => c !== exclude).map((c) => ({ value: c, label: label(c) }))];
}

export function ContactRoleFields({ category, secondaryCategory, onSave }: {
  category: string | null | undefined;
  secondaryCategory: string | null | undefined;
  onSave: (field: 'category' | 'secondary_category', value: string | null) => void;
}) {
  const tabs = contactGroups({ category, secondary_category: secondaryCategory });
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 sm:col-span-2" data-testid="contact-roles">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className={LABEL}>Role</span>
          <div className="w-36">
            <Dropdown
              value={category ?? ''}
              onChange={(v) => {
                onSave('category', v || null);
                if (v && v === secondaryCategory) onSave('secondary_category', null);
              }}
              options={options(category, null, 'Not set')}
              aria-label="Main role"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={LABEL}>Also</span>
          <div className="w-36">
            <Dropdown
              value={secondaryCategory ?? ''}
              onChange={(v) => onSave('secondary_category', v || null)}
              options={options(secondaryCategory, category, 'Nothing else')}
              disabled={!category}
              aria-label="Extra role"
            />
          </div>
        </div>
        <span className="text-[11px] text-white/40">
          Shows under {tabs.map((t) => ROLE_GROUP_LABEL[t]).join(' and ')}
        </span>
      </div>
    </div>
  );
}
