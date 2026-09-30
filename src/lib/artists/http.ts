import { NextResponse } from 'next/server';
import { SchemaNotReadyError, isMissingSchema } from './workspace-load';

/**
 * The one response for "the workspace migrations are not applied": 503 with
 * the migration range, so the UI can say what is missing instead of failing
 * as a generic 500.
 */
export function schemaNotReadyResponse(): NextResponse {
  return NextResponse.json(
    { error: 'The artist workspace needs migrations 122–129 applied on Supabase.', migration: '122-129', schemaReady: false },
    { status: 503 },
  );
}

export function isSchemaNotReady(err: unknown): boolean {
  return err instanceof SchemaNotReadyError || isMissingSchema(err);
}
