/**
 * Route tests for /api/contacts/import.
 *
 * Contract: neither handler parses an uploaded file for a signed-out caller
 * (/api/* is outside the proxy's redirect list), and old binary .xls gets an
 * actionable message rather than a parser crash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockParseXlsx = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ auth: { getUser: () => mockGetUser() } }),
}));
vi.mock('@/lib/db', () => ({
  isSupabaseConfigured: () => true,
  insert: vi.fn(),
  getAll: vi.fn(() => []),
  createServiceClient: vi.fn(),
}));
vi.mock('@/lib/contacts/spreadsheet', () => ({ parseXlsx: (b: Buffer) => mockParseXlsx(b) }));

function upload(method: 'PUT' | 'POST', name: string, body = 'x') {
  const form = new FormData();
  form.append('file', new File([body], name));
  return new NextRequest('http://localhost/api/contacts/import', { method, body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'producer-1' } } });
  mockParseXlsx.mockResolvedValue({ headers: ['Name', 'Email'], rows: [['Ada', 'ada@example.test']] });
});

describe('/api/contacts/import', () => {
  it.each(['PUT', 'POST'] as const)('%s refuses a signed-out caller without parsing the file', async (method) => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const mod = await import('./route');
    const res = await mod[method](upload(method, 'contacts.xlsx'));
    expect(res.status).toBe(401);
    expect(mockParseXlsx).not.toHaveBeenCalled();
  });

  it('previews an .xlsx for the signed-in producer', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(upload('PUT', 'contacts.xlsx'));
    expect(res.status).toBe(200);
    expect(mockParseXlsx).toHaveBeenCalledTimes(1);
    expect((await res.json()).total).toBe(1);
  });

  it('explains how to convert a legacy .xls', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(upload('PUT', 'contacts.xls'));
    expect((await res.json()).error).toMatch(/Save As → \.xlsx/);
    expect(mockParseXlsx).not.toHaveBeenCalled();
  });
});
