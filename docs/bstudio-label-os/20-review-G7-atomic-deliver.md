# 20 — Review G7: making `deliver` atomic (proposal, needs a migration)

Status: PROPOSAL. No migration is added by the reviewer (the orchestrator assigns the number). The SQL is a draft in the style of 146/157.

## What is not atomic today (`POST …/releases/[id]/deliver`)

1. **Readiness is read, then the change is claimed, in separate statements.** The route reads the release, evaluates readiness in TypeScript (about 20+ queries), then runs `UPDATE releases SET state='delivered' … WHERE state='draft'`. The claim only checks `state`. Anything that changes a gate between the read and the claim is not seen: a `changes_requested` decision, a split sheet superseded, an artwork swap, a tracklist edit, a settings change. The release is delivered on a readiness that was true a moment ago.
2. **Tracklist and field edits are not serialised with delivery.** `tracklistLocked()` and the PATCH state guard are checked in application code on a row read earlier. An item add / reorder that read `draft` can land after the claim: a delivered release with a tracklist nobody approved. Nothing in the database refuses `release_items` writes on a non-draft release.
3. **State change and audit event are two writes with a compensating undo.** `release.delivered` is an audit verb but is written by `recordEvent` after the claim; on failure the route sets the row back to `draft`. Gaps: (a) between claim and undo other readers (store bridge, board, calendar) see `delivered`; (b) if the undo itself fails the error is only logged and the release stays delivered with no audit event; (c) if the insert succeeded but its response was lost, the undo leaves an event saying delivered on a draft; (d) the undo condition (`delivered_at = <ts>`) is a timestamp match, not a token.
4. Approvals are already atomic (157: row + event in one function, row lock on the subject). Delivery is the only audit-class write of LABEL-29..33 left on the compensating pattern.

## Proposed fix

One `SECURITY DEFINER` function `labelos_audit_release_deliver`, `service_role` only, in the same shape as 157:

* locks the release row `FOR UPDATE` (the approval functions already lock the same row for release subjects, so a decision and a delivery are serialised);
* takes an **expected fingerprint** of the facts the route evaluated and compares it with the same facts read under the lock, so a change in between is a `409 changed` and nothing is written;
* updates state and inserts the `release.delivered` event in one transaction, so there is no undo path.

The route keeps evaluating readiness in TypeScript (the rules need the capability model) and passes what it saw:

```
p_expect jsonb = {
  approvals: { master: <latest approval id|null>, artwork: …, legal: …, marketing: …, metadata: … },
  items_hash: <md5 of ordered song/master ids>,
  release_updated_at: <releases.updated_at as read>
}
```

Draft SQL:

```sql
CREATE OR REPLACE FUNCTION public.labelos_audit_release_deliver(
  p_org uuid, p_actor uuid, p_release uuid,
  p_distributor text, p_delivered_at timestamptz,
  p_expect jsonb, p_ctx jsonb, p_payload jsonb, p_visibility text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rel public.releases%ROWTYPE;
  v_gate text;
  v_latest uuid;
BEGIN
  PERFORM public.labelos_approval_check_payload(p_payload);
  SELECT * INTO v_rel FROM public.releases WHERE id = p_release AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF v_rel.state <> 'draft' THEN RETURN jsonb_build_object('error', 'not_draft', 'state', v_rel.state); END IF;

  -- Facts moved since the route evaluated readiness?
  IF v_rel.updated_at IS DISTINCT FROM (p_expect->>'release_updated_at')::timestamptz THEN
    RETURN jsonb_build_object('error', 'changed');
  END IF;
  FOR v_gate IN SELECT jsonb_object_keys(p_expect->'approvals') LOOP
    SELECT a.id INTO v_latest FROM public.approvals a
     WHERE a.release_id = p_release AND a.gate = v_gate ORDER BY a.created_at DESC LIMIT 1;
    IF v_latest IS DISTINCT FROM NULLIF(p_expect->'approvals'->>v_gate, '')::uuid THEN
      RETURN jsonb_build_object('error', 'changed');
    END IF;
  END LOOP;
  IF md5((SELECT coalesce(string_agg(song_track_id::text || ':' || master_track_id::text, ',' ORDER BY position), '')
          FROM public.release_items WHERE release_id = p_release)) <> p_expect->>'items_hash' THEN
    RETURN jsonb_build_object('error', 'changed');
  END IF;

  UPDATE public.releases SET state = 'delivered', delivered_at = p_delivered_at, delivered_to = p_distributor
   WHERE id = p_release RETURNING * INTO v_rel;

  INSERT INTO public.activity_events (org_id, actor_id, verb, subject_type, subject_id, artist_id, project_id, release_id, payload, audit, visibility)
  VALUES (p_org, p_actor, 'release.delivered', 'release', p_release,
          NULLIF(p_ctx->>'artist_id','')::uuid, NULLIF(p_ctx->>'project_id','')::uuid, p_release,
          p_payload, true, p_visibility);
  RETURN jsonb_build_object('release', to_jsonb(v_rel));
END $fn$;
```

Plus, in the same migration:

1. A trigger on `release_items` (INSERT / UPDATE / DELETE) that takes `SELECT … FROM releases WHERE id = release_id FOR SHARE` and raises unless `state = 'draft'` (or the 142/LABEL-42 imported-and-not-listed case). That serialises every tracklist write with the function's `FOR UPDATE`, closing point 2.
2. A trigger (or the function above) bumping `releases.updated_at` when any `release_items` row changes, so `release_updated_at` covers the tracklist; the route's `items_hash` can then be dropped.
3. Facts the route cannot hash (a split sheet superseded, a party's IPI changed) move **readiness**, not the release row. For those the fingerprint above is not enough; the honest options are (a) accept that the approvals, which carry snapshots, are the control (a changed split makes the legal approval stale, and the next read says so, but a delivery racing it still goes through), or (b) have the route pass the latest `split_sheets`/`track_collaborators` change stamp per song and compare it under the lock. Recommendation: (a) for splits and credits (window of milliseconds, and the audit event records what was delivered), (b) is only worth it if legal asks.

Route change: replace claim + `recordEvent` + undo with `auditRpc('releaseDeliver', …)`; `error: 'changed'` → 409 "The release changed while it was being delivered; check it again"; `not_draft` → 409. Add the verb to `audit-rpc.ts` and a `labelos_audit_release_deliver` check in `supabase/local/checks/` that proves: two concurrent deliveries → one wins; a decision recorded between read and call → `changed`; an `INSERT` into `release_items` after delivery fails; the event exists iff the state changed.

Rollback: drop the function and the two triggers; the route can fall back to the current code.
