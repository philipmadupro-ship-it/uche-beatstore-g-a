# Live payments checklist (owner)

Stripe test mode and live mode are **two separate worlds**: separate API keys,
separate webhook endpoints, and a separate signing secret (`whsec_…`) for each
endpoint. Switching the account to Live does not move any of them over.

If a buyer pays and gets **no email**, the sale is usually not recorded either:
the webhook never ran, or Stripe's signature check failed, so nothing was written.

## 1. Stripe (Dashboard → switch to **Live mode** first)

1. **Developers → Webhooks → Add endpoint** (in Live mode).
   - URL: `https://uche-beatstore-g-a.vercel.app/api/stripe/webhook`
   - Events: `checkout.session.completed`, `charge.refunded`,
     `charge.dispute.created`, and `charge.dispute.closed`
     (the last one restores downloads when a dispute is won).
2. Open the new endpoint → **Signing secret → Reveal** → copy the `whsec_…` value.
3. **Developers → API keys** (Live): copy the Secret key (`sk_live_…`) and the
   Publishable key (`pk_live_…`).

## 2. Vercel (Project → Settings → Environment Variables → Production)

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_…` (baked in at build, so a redeploy is required) |
| `STRIPE_WEBHOOK_SECRET` | the **live** endpoint's `whsec_…` (not the test one) |
| `RESEND_API_KEY` | a Resend API key with sending access |
| `RESEND_FROM_EMAIL` | an address on a **verified** Resend domain, e.g. `U2C <sales@yourdomain.com>` |
| `NEXT_PUBLIC_APP_URL` | `https://uche-beatstore-g-a.vercel.app` |

Paste values with no spaces or line breaks. After saving, **redeploy**
(Deployments → ⋯ → Redeploy); env changes only apply to new deployments.

## 3. Resend

- **Domains**: the domain in `RESEND_FROM_EMAIL` must show **Verified** (SPF + DKIM records in DNS).
- With `RESEND_FROM_EMAIL` unset or on `resend.dev`, Resend only delivers to the
  account owner's own address, so real buyers get nothing.

## 4. Check it (signed in as the producer)

Open `https://uche-beatstore-g-a.vercel.app/api/stripe/diagnostics`. It is owner-only and never shows secret values. You want:

- `stripe.key_mode: "live"` and `stripe.publishable_key_mode: "live"`
- `env.webhook_secret`: `set: true`, `looks_valid: true`
- `webhook.endpoint_registered: true`, `webhook.livemode: true`, `webhook.missing_events: []`
- `resend.api_key_set: true`, `resend.sandbox_sender: false`, `resend.from_domain` = your verified domain
- `fulfillment.paid_without_email_7d: 0`
- `hints: []` (anything listed there is the next thing to fix)

## 5. Work out which cause it is

| Symptom | Where to look | Cause |
|---|---|---|
| Stripe → Webhooks → endpoint → events show **400** | Vercel logs: `signature verification failed` with `event_livemode: true` | `STRIPE_WEBHOOK_SECRET` is the test (or another endpoint's) secret. Fix and redeploy. |
| Vercel log `STRIPE_WEBHOOK_SECRET is not set` | Vercel logs | Variable missing in Production. |
| No events at all in the Stripe endpoint's log | Stripe → Webhooks | No **live** endpoint exists, or wrong URL. Diagnostics: `webhook.endpoint_registered: false`. |
| Events **200**, sale visible in `/sales`, no email | Vercel log `delivery email skipped` (`reason: resend_api_key_missing` or `no_buyer_email`) | Resend key not set in Production, or no buyer address on the session. |
| Events **200**, sale in `/sales`, no email | Vercel log `delivery email failed` (has a `hint`); Resend → Logs | Unverified domain, sandbox sender, or a bad/restricted Resend key. |
| Events **500** | Vercel log `webhook handler errored` | A database error. The purchase was not recorded; Stripe retries for up to 3 days, so fix the cause and the retry completes it. |
| Checkout will not open | Browser console | Secret and publishable keys are in different modes (diagnostics hint). |

Failed emails are kept in a queue (`fulfillment_email_jobs`) and retried by
`/api/cron/process-fulfillment-emails` (every 15 minutes through the
`frequent-crons` GitHub workflow, which needs the `CRON_SECRET` and `APP_URL`
repo secrets; otherwise once a day).

## 6. Getting a missed email to a buyer

- Producer: **/sales** → the sale → **Resend delivery email** (`POST /api/sales/resend`).
- Buyer: `/store/orders` with the purchase email sends them a fresh link.
- A sale Stripe has but the app lacks (webhook failed): Stripe → Webhooks → the
  endpoint → the failed `checkout.session.completed` event → **Resend**. It is
  idempotent, so resending never double-sells or double-emails.
- To confirm the whole chain, make one small real purchase (or a 100%-promo
  order) with your own address and check the email arrives.

## 7. The "Work with …" contact form

`POST /api/store/contact` sends through the same Resend setup, to the creator
profile's `contact_email` (else the owner's login email), reply-to the visitor.
If it fails the visitor now sees "We could not send your message" (it used to
look like success or fail silently) and Vercel logs `store contact send failed`
with a hint. Same fixes as above: verified `RESEND_FROM_EMAIL`, valid `RESEND_API_KEY`.

Never paste any key or `whsec_` value into chat, tickets or git.
