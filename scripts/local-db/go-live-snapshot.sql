-- Row fingerprints of every pre-existing table, for the go-live rehearsal
-- (go-live-rehearsal.sh). `rehearsal.start()` records which tables and columns
-- exist NOW; `rehearsal.take(label)` fingerprints those tables over exactly
-- those columns, so columns and tables a migration adds do not show up as
-- changes but any edit, insert or delete of an existing row does.
-- LOCAL VERIFICATION ONLY.
CREATE SCHEMA IF NOT EXISTS rehearsal;
DROP TABLE IF EXISTS rehearsal.cols, rehearsal.snap;
CREATE TABLE rehearsal.cols (tbl text PRIMARY KEY, cols text[] NOT NULL);
CREATE TABLE rehearsal.snap (label text, tbl text, n bigint, h text, PRIMARY KEY (label, tbl));

CREATE OR REPLACE FUNCTION rehearsal.start() RETURNS void LANGUAGE sql AS $$
  INSERT INTO rehearsal.cols
  SELECT c.table_schema || '.' || c.table_name, array_agg(c.column_name::text ORDER BY c.ordinal_position)
  FROM information_schema.columns c
  JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE t.table_type = 'BASE TABLE'
    AND ((c.table_schema = 'public') OR (c.table_schema = 'auth' AND c.table_name = 'users'))
  GROUP BY c.table_schema, c.table_name;
$$;

CREATE OR REPLACE FUNCTION rehearsal.take(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl, cols FROM rehearsal.cols LOOP
    EXECUTE format(
      'INSERT INTO rehearsal.snap SELECT %L, %L, count(*), md5(coalesce(string_agg(j::text, ''|'' ORDER BY j::text), '''')) FROM (
         SELECT (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(t)) AS e(k, v) WHERE k = ANY (%L::text[])) AS j FROM %s t) s',
      p_label, r.tbl, r.cols, r.tbl);
  END LOOP;
END $$;
