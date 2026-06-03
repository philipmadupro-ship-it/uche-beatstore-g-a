# crm-system

## What the CRM is

The contacts surface is a beat-industry CRM, not a generic contact list. 500–600+ contacts:
- **Buyers** — store purchasers (`category: 'buyer'`, `buyer_pipeline_status`: new_lead → contacted → negotiating → purchased → repeat_buyer).
- **Rappers / artists** — main outreach targets.
- **Producers** — collaborators.
- **A&R / label** — industry gatekeepers.
- **Friends** — casual listeners.

## Key tables (migrations 001, 007, 008, 038, 089, 090, 091, 092)

| Table | Key columns |
|-------|------------|
| `contacts` | id, name, email, role, label, category, crm_status (092), contact_tags (091), buyer_pipeline_status |
| `beat_sends` | id, contact_id, track_ids[], status (sent/opened/interested/negotiating/placed/pass), sent_at, email_resend_id, opened_at, link_clicked_at |
| `contact_tags` | contact_id, tag, category — free-form CRM tags (mig 091) |
| `contact_segments` | id, user_id, name, filters jsonb — saved filter combos (mig 090) |

## CRM stages vs activity tones

Two separate concepts — never confuse them:
- **CRM stage** (`crm_status`) — manually set lifecycle: prospect / active / engaged / cold / archived. Stored, editable.
- **Activity tone** — auto-computed from last send recency: Active (≤30d), Engaged (>30d), Cold (never). Read-only.

## Send flow

1. `POST /api/share` — creates a share link per recipient.
2. `POST /api/email` — sends via Resend, logs to `beat_sends`, stores `email_resend_id`.
3. `POST /api/resend/webhook` — on open/click events, sets `opened_at` / `link_clicked_at`.
4. Contact history visible on `/contacts/[id]` and in `ContactHistoryDrawer`.

## Pure filter helper

`lib/contacts/filters.ts` → `filterAndSortContacts`, `paginate`, `pageCount`.
Any new filter logic goes here with a test. Currently 12 test cases.

## Key components

- `ContactsView.tsx` — main CRM table (1300+ lines, stateful container).
- `ContactsTable.tsx` — the `<table>` presentational component.
- `ContactStageCell.tsx` — inline editable stage dropdown.
- `ContactTagPicker.tsx` — free-form tag entry.
- `SendBeatModal.tsx` — compose + send. Has template save/load, "Sent before" badge, personalised preview.
- `ContactHistoryDrawer.tsx` — per-contact send timeline with track title hydration.

## Resend open tracking (mig 089)

`beat_sends.email_resend_id` is set at send time. Once Resend webhook is live:
- `email.opened` → sets `opened_at`, bumps status from 'sent' to 'opened'.
- `email.clicked` → sets `link_clicked_at`.
Webhook: `POST /api/resend/webhook`. Set `RESEND_WEBHOOK_SECRET` in prod env.
