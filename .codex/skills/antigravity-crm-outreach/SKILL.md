---
name: antigravity-crm-outreach
description: Use for Antigravity contacts, CRM pipeline, contact tags, segments, beat sends, send modal, Resend email tracking, contact timelines, outreach campaigns, and artist relationship workflows.
---

# Antigravity CRM Outreach

## Mental Model

The contacts area is a beat-industry CRM, not a generic address book. It supports artists, rappers, producers, A&R contacts, buyers, friends, and collaborators.

## Key Concepts

- `crm_status`: manual lifecycle stage, such as prospect, active, engaged, cold, archived.
- Activity tone: read-only recency signal computed from sends and opens.
- `buyer_pipeline_status`: commerce pipeline, separate from CRM stage.
- `contact_tags`: free-form owner-scoped tags.
- `contact_segments`: saved filter combinations.
- `beat_sends`: outreach log tied to share links and email events.

Never merge manual CRM stage with computed activity tone.

## Important Files

- `src/components/crm/ContactsView.tsx`
- `src/components/crm/ContactsTable.tsx`
- `src/components/crm/ContactStageCell.tsx`
- `src/components/crm/ContactTagPicker.tsx`
- `src/components/crm/SendBeatModal.tsx`
- `src/components/crm/ContactHistoryDrawer.tsx`
- `src/lib/contacts/filters.ts`
- `src/lib/contacts/tasks.ts`
- `src/lib/contacts/activity.ts`
- `src/lib/contacts/scoring.ts`

## Send Flow

1. Create share link through `/api/share`.
2. Send email through `/api/email`.
3. Store `beat_sends.email_resend_id`.
4. Resend webhook updates `opened_at`, `link_clicked_at`, and status.
5. Contact detail shows timeline and stats.

## Filter Rule

All contact search, sort, pagination, segment matching, or scoring logic belongs in `src/lib/contacts/**` with Vitest coverage. Do not add new filter branches inside the CRM table component.

## Scale Assumption

Design and queries should work smoothly for 500-600+ contacts. Avoid N+1 track title hydration or per-row network calls.
