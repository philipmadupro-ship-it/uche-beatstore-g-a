type TagRow = {
  tag?: unknown;
};

function isTagRow(row: unknown): row is TagRow {
  return typeof row === 'object' && row !== null;
}

export function tagNamesFromRows(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (isTagRow(row) && typeof row.tag === 'string' ? row.tag : null))
    .filter((tag): tag is string => Boolean(tag));
}
