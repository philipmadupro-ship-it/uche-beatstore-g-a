# Label OS for companies: running on-premise, with rule-based Python automation

_Proposal, 21 Nov 2026. Business side; complements `python-scripts-report.md`, which covers the beatmaker side._

## The idea in one paragraph

A label or company that buys Label OS wants it **on its own servers**, for security and confidentiality. It wants **no AI**: nothing reads its contracts or money and guesses. What it does want is for nothing to slip:
- legal hears about a contract that expires next month;
- marketing is told four weeks before a release that the plan is empty;
- finance is reminded that a period needs closing.

That job belongs to **plain, predictable Python scripts**. They read the Label OS database on a schedule, apply written rules, and send the right notification to the right person through the channels the company already uses. Same input gives the same output, every time.

## What Label OS already gives us to build on

The rules don't need new business data. Label OS already stores it:

| Department | Facts already in the database |
|---|---|
| Legal | contracts (status, sent date, signers, end date), split sheets (circulated / signed, total), legal approvals and the legal queue, parties missing IPI/PRO |
| Marketing | releases (target and release dates, the seven gates), marketing plans (timeline, checklist, asset requests), press kits (embargo) |
| Finance | earnings imports, periods (open / closed), statements (generated → approved → issued → paid), advances and recoupment |
| A&R / creative | song stages and how long they have sat there, reviews, creative gate |
| Everyone | tasks with due dates, org notifications (`notifications.org_id`), activity events, the Needs-attention list, the weekly digest |

Today some reminders already exist inside the app: the Needs-attention list, the weekly digest, contract end dates in the calendar feed, and direct asks. They are fixed rules in TypeScript, though. A company cannot tune them, and they cannot reach email or Teams on a closed network.

## Architecture (on-premise)

```
 Company network
 ┌──────────────────────────────────────────────────────────────┐
 │  Label OS web app (Next.js)  ←→  Postgres (Supabase self-host) │
 │                                   Object storage (MinIO = R2)  │
 │                                                                │
 │  Python automation worker  ── reads (read-only DB role) ──→ Postgres
 │    • rules.yaml (per org, edited by the company)               │
 │    • runs every 15 min (cron / systemd timer / container)      │
 │    • sends: in-app notification (through the app's API),       │
 │             email (company SMTP), Teams/Slack/Mattermost        │
 │             webhook, calendar (.ics)                           │
 └──────────────────────────────────────────────────────────────┘
        nothing leaves the network; no AI service is called
```

What changes for a self-hosted install:
- **R2** becomes MinIO, or any S3-compatible store. The app already talks the S3 API.
- **Resend** becomes the company's SMTP server.
- **Supabase cloud** becomes self-hosted Supabase or plain Postgres + PostgREST. The repo's `scripts/local-db` stack already proves the app runs on that.
- **Stripe and the public store** are switched off for a label that doesn't sell. `LABEL_OS_ENABLED` stays on.

## The rules (examples a company would switch on)

Rules are written in a config file, not in code. Example `rules.yaml`:

```yaml
org: acme-records
channels:
  email: smtp://mail.acme.local
  teams: https://acme.webhook.office.com/...   # stored encrypted, like the Slack digest
rules:
  - id: contract-expiring
    department: legal
    when: contract.status == "signed" and contract.ends_in_days in [60, 30, 7]
    notify: [role:legal, contract.owner]
    via: [in_app, email]
  - id: contract-unsigned
    department: legal
    when: contract.status == "sent" and contract.sent_days_ago >= 10
    notify: [contract.owner]
  - id: split-not-100
    department: legal
    when: release.target_in_days <= 30 and song.split_total != 100
    notify: [role:legal, role:ar]
  - id: marketing-plan-missing
    department: marketing
    when: release.target_in_days == 28 and not release.has_marketing_plan
    notify: [role:marketing]
  - id: embargo-lifts
    department: pr
    when: press_kit.embargo_in_hours == 24
    notify: [role:pr]
  - id: period-close
    department: finance
    when: period.ended_days_ago == 5 and period.status == "open"
    notify: [role:finance]
  - id: statement-waiting-approval
    department: finance
    when: statement.status == "generated" and statement.age_days >= 3
    notify: [role:finance_approver]
  - id: song-stalled
    department: ar
    when: song.stage in ["demo","in_progress"] and song.days_in_stage >= 30
    notify: [song.ar_owner]
  - id: overdue-tasks-digest
    department: all
    when: weekly("monday 08:00")
    notify: [each_member_with_overdue_tasks]
```

**Ready-made packs.** Ship sets of rules per department: Legal, Marketing, PR, Finance, A&R and Executive. A company switches a pack on in `/setup`, then adjusts the days.

## Non-negotiable rules for the worker

These come from how Label OS is already built.

1. **Same permissions as the app.** An alert only goes to a person who could open the thing it is about: artist scope, the working-vs-finished audio rule (D4), `business.read.internal` for money, `rights.read` for legal names. A scoped member never learns a title they could not see.
   - The worker does not re-implement this. It asks the app (`POST /api/org/[orgId]/automation/deliver`, server-side checks), or uses the same SQL helper functions (`has_org_cap`, `can_see_artist`).
2. **Read-only database access.** The worker uses a Postgres role that can only SELECT. It never edits contracts, money, approvals or splits. Its only write is "send this notification", through the app's endpoint, which records it.
3. **Never twice.** Each alert is keyed by (rule, subject, recipient, window), for example `contract-expiring / contract 123 / alice / 30-day`. A re-run sends nothing new.
4. **Audited.** Every alert sent is an activity event (`automation.alert_sent`, internal visibility). The owner can see what went out and why.
5. **Notifications stay a closed list.** Label OS deliberately limits who may notify whom (`lib/labelos/notify.ts` is a closed list, guarded by a test). Automation alerts become ONE new kind, `rule_alert`, with exactly one caller: the automation endpoint. Rules can't spam people through any other door.
6. **No AI, no outside calls.** Pure rules over database facts. Secrets (SMTP, webhooks) are stored encrypted, like the Slack digest webhook, and never logged.
7. **Quiet by default.** Every rule is off until the company switches it on. Per-person opt-out, a daily cap per person, and a "bundle into one email" option are standard.

## What has to be built

| Piece | Where | Size |
|---|---|---|
| Migration 202: `automation_rules` (per org, JSON rules + on/off), `automation_alerts` (the never-twice ledger), notification kind `rule_alert` | Postgres | Small |
| `POST /api/org/[orgId]/automation/deliver`: checks the recipient may see the subject, writes the notification + audit event, dedupes | Next.js, TypeScript (the permission rules live here) | Medium |
| Settings page "Automation" (`/o/<slug>/settings/automation`): switch packs on, edit days, test-send, see the sent log | Next.js | Medium |
| **Python worker** (`automation-worker/`): loads rules, runs read-only SQL queries per rule, calls the deliver endpoint, sends email/webhooks | Python, like `stem-service/` | Medium |
| On-premise install kit: docker-compose (app, Postgres/PostgREST, MinIO, worker, SMTP relay), backup script, install guide | DevOps | Medium |

**Suggested order:**
1. Legal pack: contract expiring, unsigned, splits not at 100 %.
2. Finance.
3. Marketing / PR.
4. A&R / Exec.
5. The on-premise install kit.

## Questions to settle before building

1. **Which channels** do your target companies use: email only, Teams, Slack, or something on-premise like Mattermost?
2. **Who owns the rules:** each company edits its own, or you (the operator) ship fixed packs per licence?
3. **On-premise from day one, or a dedicated private cloud first?** A dedicated private cloud means one Supabase project per company in its region; it's easier to sell and maintain.
4. **Is the worker included in every licence, or a paid module?** It would fit the existing module licensing as "automation".
