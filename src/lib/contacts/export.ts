import type { Contact } from '@/lib/types';

/**
 * CSV export for contacts. Mirrors the quote-escaping pattern used on the sales
 * page. Tags are joined with a pipe so the cell stays a single CSV field.
 */
type ContactCsvKey = Exclude<keyof Contact, 'tags'> | 'tags';

const COLUMNS: { key: ContactCsvKey; header: string }[] = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  { key: 'role', header: 'Role' },
  { key: 'category', header: 'Category' },
  { key: 'crm_status', header: 'Stage' },
  { key: 'city', header: 'City' },
  { key: 'country', header: 'Country' },
  { key: 'instagram', header: 'Instagram' },
  { key: 'tags', header: 'Tags' },
];

function cell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export function contactsToCsv(contacts: Contact[]): string {
  const head = COLUMNS.map((c) => cell(c.header)).join(',');
  const rows = contacts.map((c) =>
    COLUMNS.map((col) => {
      if (col.key === 'tags') return cell((c.tags ?? []).map((t) => t.tag).join(' | '));
      return cell(c[col.key]);
    }).join(','),
  );
  return [head, ...rows].join('\n');
}

/** Trigger a browser download of a CSV string. Client-only. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
