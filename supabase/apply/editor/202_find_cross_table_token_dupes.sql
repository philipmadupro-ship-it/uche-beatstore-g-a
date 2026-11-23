-- READ-ONLY audit for migration 202 (SHARE-04). Run in the SQL editor BEFORE applying 202.
-- Lists every share token that exists in more than one of share_links, project_shares and
-- artist_portals. Zero rows = nothing to fix. A row means two shares answer to one URL:
-- reissue one of them (portals: "Reissue link" in the contact's workspace; shares: revoke and re-create).
-- 202 does not change existing rows, and still lets an unrelated UPDATE of such a row through.
SELECT token,
       count(*)                                 AS tables_holding_it,
       array_agg(source ORDER BY source)        AS in_tables,
       array_agg(row_id ORDER BY source)        AS row_ids
FROM (
  SELECT token, 'share_links'    AS source, id::text AS row_id FROM public.share_links
  UNION ALL
  SELECT token, 'project_shares' AS source, id::text AS row_id FROM public.project_shares
  UNION ALL
  SELECT token, 'artist_portals' AS source, id::text AS row_id FROM public.artist_portals
) t
GROUP BY token
HAVING count(DISTINCT source) > 1
ORDER BY token;
