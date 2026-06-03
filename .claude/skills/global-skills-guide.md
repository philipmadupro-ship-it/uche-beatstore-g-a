# global-skills-guide

How to use the globally installed Claude Code skills in this project.

## `/verify`

**When to use:** After implementing a UI change, especially anything touching the CRM table, store checkout, send modal, or library views.

**Pattern for this project:**
1. Make sure `npm run dev` is running on port 3000.
2. `/verify` — describe what to check (e.g., "verify that tags show on contact rows and clicking a tag chip filters the list").
3. The skill will screenshot and interact with the app; confirm it matches intent.

**Critical flows to verify before any PR:**
- CRM: contact tags filter, batch edit stage, send modal template save/load, "Sent before" badge.
- Store: checkout happy path (add to cart → checkout → Stripe embed loads).
- Library: bulk tag edit, sort by rating.

---

## `/code-review`

**When to use:** Before merging anything that touches auth, checkout, migrations, public API routes, or RLS.

```
/code-review medium    # good default — correctness + obvious simplifications
/code-review high      # before major features
/code-review --fix     # apply safe fixes directly
```

---

## `/supabase-postgres-best-practices`

**When to use:** Before writing any query, index, or RLS policy. Especially important for:
- Contact list queries (500+ rows, multiple JOINs to contact_tags, beat_sends).
- Beat-send analytics (aggregate queries over potentially thousands of rows).
- Any new RLS policy — `auth.uid()` in policies can cause sequential scans without the right indexes.

**Common Supabase patterns this project uses:**
- Service-role queries after ownership check.
- `scopedList` facade for most reads.
- Batch `IN (ids)` lookups rather than N+1 per-row fetches.

---

## `/high-end-visual-design`

**When to use:** When designing any new UI component from scratch — especially storefront-facing cards, modals, or landing sections.

**How to apply to this project:**
- Keep the warm dark palette (`#0a0907`, `#14110d`, `#D4BFA0`).
- Use the skill's shadow, hover, and typography patterns but remap to project tokens.
- The storefront competes visually with Bandcamp and Beatstars — aim for that level.

---

## `/web-design-guidelines`

**When to use:** Audit new pages before shipping — especially store pages seen by buyers.

**Checklist for this project:**
- `prefers-reduced-motion` gates all animations (vinyl spin, particle text, cosmos fades).
- Focus rings on all interactive elements (the store has many keyboard-navigable items).
- Mobile: no fixed elements that scroll with `window.scrollY`; portal-rendered modals escape overflow.
- Contrast: cream-on-near-black (#E8DCC8 on #0a0907) is AA compliant — don't lighten it.

---

## `/simplify`

**When to use:** After a large feature refactor to clean up leftover state, redundant imports, or dead code paths.

**Good candidates in this project:**
- After the CRM table rewrite (`ContactsView.tsx` is 1300+ lines).
- After adding new filter logic — check if any old inline filter code can be deleted.

---

## `/security-review`

**When to use:** Before any release that touches:
- Payment routes (`/api/stripe/webhook`, `/api/store/checkout`).
- Email sending (`/api/email`, `/api/resend/webhook`).
- Share link creation/access (`/api/share`, `/api/projects/*/shares`).
- File upload (`/api/upload/*`).

---

## `/fewer-permission-prompts`

Run this once per session on a new machine to reduce friction:
```
/fewer-permission-prompts
```
It scans recent tool calls and adds safe read-only allowlists to `.claude/settings.json`.
