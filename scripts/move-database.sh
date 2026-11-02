#!/usr/bin/env bash
# Copies the clinic's data from one Supabase project to another (for example Ireland -> Mumbai) and checks the counts.
# It only READS the source. It REPLACES the `arx` schema on the destination, so it refuses to run if the destination
# already holds patients or prescriptions (set FORCE=1 only if you are sure that data is disposable).
#
# Run it on your own computer, never paste the addresses into a chat. You need psql, pg_dump and pg_restore (version 17
# or newer) and these values, from Supabase -> Connect -> "Session pooler" (port 5432, NOT the transaction pooler):
#
#   SRC_DB_URL=...   the OLD database (Ireland)
#   DST_DB_URL=...   the NEW database (Mumbai)
#
# Optional, to copy scans, logo and PDFs too (Supabase -> Project Settings -> API -> secret key):
#
#   SRC_SUPABASE_URL=https://<old-ref>.supabase.co   SRC_SUPABASE_KEY=...
#   DST_SUPABASE_URL=https://<new-ref>.supabase.co   DST_SUPABASE_KEY=...
#
# Example:  SRC_DB_URL='postgresql://...' DST_DB_URL='postgresql://...' bash scripts/move-database.sh
set -euo pipefail

: "${SRC_DB_URL:?Set SRC_DB_URL (old database, session pooler, port 5432)}"
: "${DST_DB_URL:?Set DST_DB_URL (new database, session pooler, port 5432)}"
[ "$SRC_DB_URL" != "$DST_DB_URL" ] || { echo "SRC_DB_URL and DST_DB_URL are the same database. Stopping." >&2; exit 1; }
for t in psql pg_dump pg_restore; do command -v "$t" >/dev/null || { echo "$t is not installed (install PostgreSQL client tools, version 17 or newer)." >&2; exit 1; }; done

q() { psql "$1" -v ON_ERROR_STOP=1 -X -At -c "$2"; }
TABLES="clinics users patients appointments visits prescriptions documents lab_results bills files templates messages medicines med_usage"

echo "== 1. Checking both databases"
SRC_VER=$(q "$SRC_DB_URL" "show server_version_num"); DST_VER=$(q "$DST_DB_URL" "show server_version_num")
CLIENT_MAJOR=$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
echo "   source server: ${SRC_VER:0:2}   destination server: ${DST_VER:0:2}   pg_dump: $CLIENT_MAJOR"
[ "$CLIENT_MAJOR" -ge "${SRC_VER:0:2}" ] || { echo "pg_dump ($CLIENT_MAJOR) is older than the source server (${SRC_VER:0:2}). Install a newer client." >&2; exit 1; }
[ "$(q "$SRC_DB_URL" "select count(*) from information_schema.tables where table_schema='arx' and table_name='patients'")" = 1 ] || { echo "The SOURCE has no arx.patients table. Is SRC_DB_URL the old database?" >&2; exit 1; }
SRC_P=$(q "$SRC_DB_URL" "select count(*) from arx.patients")
[ "$SRC_P" -gt 0 ] || { echo "The SOURCE has no patients. Is SRC_DB_URL the old database?" >&2; exit 1; }
if [ "$(q "$DST_DB_URL" "select count(*) from information_schema.tables where table_schema='arx' and table_name='patients'")" = 1 ]; then
  DST_P=$(q "$DST_DB_URL" "select count(*) from arx.patients"); DST_R=$(q "$DST_DB_URL" "select count(*) from arx.prescriptions")
  if [ "$DST_P" -gt 0 ] || [ "$DST_R" -gt 0 ]; then
    [ "${FORCE:-}" = 1 ] || { echo "The DESTINATION already has $DST_P patients and $DST_R prescriptions. Not touching it. (FORCE=1 to override.)" >&2; exit 1; }
  fi
fi

WORK=$(mktemp -d); chmod 700 "$WORK"
cleanup() { [ "${KEEP_DUMP:-}" = 1 ] && echo "Dump kept in $WORK (contains patient data, delete it when done)" || rm -rf "$WORK"; }
trap cleanup EXIT

echo "== 2. Dumping the source (read only)"
pg_dump "$SRC_DB_URL" --schema=arx --format=custom --no-owner --no-privileges -f "$WORK/arx.dump"
echo "   $(du -h "$WORK/arx.dump" | cut -f1) written"

echo "== 3. Replacing the arx schema on the destination"
psql "$DST_DB_URL" -v ON_ERROR_STOP=1 -X -q -c "drop schema if exists arx cascade; create schema if not exists extensions; create extension if not exists pg_trgm with schema extensions;"
pg_restore --no-owner --no-privileges --exit-on-error -d "$DST_DB_URL" "$WORK/arx.dump"

echo "== 4. Comparing counts"
BAD=0
printf "   %-14s %10s %10s\n" table source destination
for t in $TABLES; do
  a=$(q "$SRC_DB_URL" "select count(*) from arx.$t"); b=$(q "$DST_DB_URL" "select count(*) from arx.$t")
  if [ "$a" = "$b" ]; then m=""; else m="  <-- DIFFERENT"; BAD=1; fi
  printf "   %-14s %10s %10s%s\n" "$t" "$a" "$b" "$m"
done
[ "$BAD" = 0 ] || { echo "Counts differ. Do NOT switch the app. Send this output to Claude." >&2; exit 1; }

if [ -n "${SRC_SUPABASE_URL:-}" ] && [ -n "${DST_SUPABASE_URL:-}" ] && [ -n "${SRC_SUPABASE_KEY:-}" ] && [ -n "${DST_SUPABASE_KEY:-}" ]; then
  echo "== 5. Copying stored files (scans, logo, PDFs)"
  BUCKET=arogya-rx
  auth() { if [[ "$1" == eyJ* ]]; then echo "Authorization: Bearer $1"; else echo "X-No-Auth: 1"; fi; }
  SU="${SRC_SUPABASE_URL%/}"; DU="${DST_SUPABASE_URL%/}"
  curl -sS -o /dev/null -X POST "$DU/storage/v1/bucket" -H "apikey: $DST_SUPABASE_KEY" -H "$(auth "$DST_SUPABASE_KEY")" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$BUCKET\",\"name\":\"$BUCKET\",\"public\":false,\"file_size_limit\":15728640}" || true   # already exists is fine
  OK=0; FAIL=0
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if curl -fsS "$SU/storage/v1/object/authenticated/$BUCKET/$p" -H "apikey: $SRC_SUPABASE_KEY" -H "$(auth "$SRC_SUPABASE_KEY")" -o "$WORK/f.bin" \
       && curl -fsS -X POST "$DU/storage/v1/object/$BUCKET/$p" -H "apikey: $DST_SUPABASE_KEY" -H "$(auth "$DST_SUPABASE_KEY")" -H 'x-upsert: true' \
            -H "Content-Type: $(file -b --mime-type "$WORK/f.bin")" --data-binary @"$WORK/f.bin" -o /dev/null; then OK=$((OK+1)); else FAIL=$((FAIL+1)); echo "   could not copy: $p" >&2; fi
  done < <(q "$SRC_DB_URL" "select path from arx.files where storage = 'supabase'")
  echo "   copied $OK files, $FAIL failed"
  [ "$FAIL" = 0 ] || exit 1
else
  echo "== 5. Stored files not copied (SRC_/DST_SUPABASE_URL and _KEY not all set). Scans, logo and PDFs stay in the old project's bucket."
fi

echo
echo "Done. Next: set DATABASE_URL (transaction pooler, port 6543), SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel to the NEW project, redeploy, and log in with your usual password."
