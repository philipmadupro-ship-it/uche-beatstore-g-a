/**
 * LABEL-19: every mutating handler under src/app/api/org/** records an
 * activity event (`recordEvent`, an audit RPC, or the accept function), or
 * is on the reasoned NO_EVENT_HANDLERS list. The rule is
 * lib/labelos/event-coverage.ts; its own tests prove it fails a handler
 * without an event. This one applies it to the real routes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_EVENT_HANDLERS, coverageGaps, mutatingHandlers, staleAllowances, type CoverageFile } from '@/lib/labelos/event-coverage';

const ROOT = __dirname;

function routeFiles(dir: string): CoverageFile[] {
  const out: CoverageFile[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === 'route.ts') out.push({ path: relative(ROOT, full), source: readFileSync(full, 'utf8') });
  }
  return out;
}

const files = routeFiles(ROOT);

describe('activity coverage of /api/org', () => {
  it('scans the real routes', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap((f) => mutatingHandlers(f.source)).length).toBeGreaterThan(20);
  });

  it('every mutating handler records an event or is on the reasoned list', () => {
    expect(coverageGaps(files, NO_EVENT_HANDLERS)).toEqual([]);
  });

  it('the exemption list holds only handlers that exist and still record nothing', () => {
    expect(staleAllowances(files, NO_EVENT_HANDLERS)).toEqual([]);
  });

  it('gives every exemption a reason', () => {
    for (const [key, reason] of Object.entries(NO_EVENT_HANDLERS)) expect(reason.length, key).toBeGreaterThan(20);
  });
});
