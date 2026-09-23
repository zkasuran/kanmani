#!/usr/bin/env python3
"""Export the live Postgres snapshot into SQLite DDL plus data, for Cloudflare D1.

This is a contingency, not the live path. The site runs on its own host and reads Postgres
directly, which is what https://kanmani.xyz serves today. What this buys is a restore: the entry
has to stay reachable from 2026-10-14 to 2026-11-03 while judging runs. If the host goes down
inside that window a serverless copy backed by D1 can be up in minutes without waiting on anyone.
39,595 rows is small enough that the whole measurement fits in D1's free tier.

The honest limit of that fallback, stated here so it never gets claimed as more: a D1 copy is a
dated snapshot. It serves the numbers as measured at a named block. The re-derivation commands
still run against the real chain, but it does not follow the chain head the way the indexer does.

Two rules this script follows so a restored copy cannot drift from the measured numbers.

1. The two heavy objects, `fovea.record_state` and `fovea.verdict_latest`, are VIEWS carrying
   `DISTINCT ON` plus the whole 402-classification `CASE`. They are materialised here and shipped
   as plain tables. The classification therefore runs in Postgres, where it is already tested,
   and never gets re-implemented in SQLite where it could disagree.
2. Every row count is printed and written to a manifest, so the load can be checked rather than
   assumed. A silent short load is the failure mode that would put a wrong number on a page.

SQLite has no schemas, so `fovea.verdict` becomes `fovea_verdict` and `public."Agent"` becomes
`Agent`. Any reader of the restored copy rewrites query text with the same mapping, reading that
mapping out of the manifest rather than hardcoding a second copy of it.

Usage:
  python3 tools/export-d1.py --out build/d1
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

CONTAINER = os.environ.get("KANMANI_PG_CONTAINER", "kanmani-postgres")
DB = os.environ.get("KANMANI_PG_DATABASE", "envio-dev")
USER = os.environ.get("KANMANI_PG_USER", "postgres")

# Postgres object -> SQLite table. Order matters only for readability; there are no foreign keys
# in the shipped copy because the source has none either (see the note in verifier schema.sql).
OBJECTS: list[tuple[str, str, bool]] = [
    # (postgres reference, sqlite table, is_view_to_materialise)
    ('public."Agent"', "Agent", False),
    ('public."AgentRecord"', "AgentRecord", False),
    ('public."AgentRecordOwner"', "AgentRecordOwner", False),
    ('public."Feedback"', "Feedback", False),
    ('public."Validation"', "Validation", False),
    ('public."IndexState"', "IndexState", False),
    ("fovea.verdict", "fovea_verdict", False),
    ("fovea.record_probe", "fovea_record_probe", False),
    ("fovea.record_state", "fovea_record_state", True),
    ("fovea.verdict_latest", "fovea_verdict_latest", True),
]

# Postgres type -> SQLite type. SQLite INTEGER is 64 bit, which covers every block number, agent
# id and feedback value here. `numeric` is used for whole numbers throughout this schema, so it
# maps to INTEGER rather than REAL: REAL would silently lose precision on a large value.
TYPES = {
    "text": "TEXT",
    "character varying": "TEXT",
    "integer": "INTEGER",
    "bigint": "INTEGER",
    "smallint": "INTEGER",
    "numeric": "INTEGER",
    "boolean": "INTEGER",
    "timestamp with time zone": "TEXT",
    "timestamp without time zone": "TEXT",
    "ARRAY": "TEXT",
    "jsonb": "TEXT",
    "json": "TEXT",
}


def psql(sql: str) -> str:
    """Run one statement and return raw stdout. Fails loudly rather than returning empty."""
    proc = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-U", USER, "-d", DB, "-At", "-c", sql],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"psql failed for: {sql[:120]}\n{proc.stderr.strip()}")
    return proc.stdout


def columns(ref: str) -> list[tuple[str, str, bool]]:
    """Column name, postgres type and nullability for a table or a view."""
    if "." in ref:
        schema, name = ref.split(".", 1)
    else:
        schema, name = "public", ref
    name = name.strip('"')
    rows = psql(
        "select column_name, data_type, is_nullable from information_schema.columns "
        f"where table_schema = '{schema}' and table_name = '{name}' order by ordinal_position"
    ).strip()
    if not rows:
        sys.exit(f"no columns found for {ref}. Either the name is wrong or the view is absent.")
    out = []
    for line in rows.splitlines():
        col, typ, nullable = line.split("|")
        out.append((col, typ, nullable == "YES"))
    return out


def sqlite_literal(value, pg_type: str) -> str:
    if value is None:
        return "NULL"
    if pg_type == "boolean":
        return "1" if value else "0"
    if pg_type == "ARRAY":
        # A Postgres array becomes a JSON string. Readers already treat endpoints as a list, so
        # the adapter parses it back rather than the page changing shape.
        return "'" + json.dumps(value).replace("'", "''") + "'"
    if TYPES.get(pg_type) == "INTEGER":
        # row_to_json renders numeric as a JSON number or a string depending on magnitude.
        return str(int(value))
    text = value if isinstance(value, str) else json.dumps(value)
    return "'" + text.replace("'", "''") + "'"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build/d1")
    ap.add_argument("--chunk", type=int, default=4000, help="rows per data file")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for stale in out.glob("*.sql"):
        stale.unlink()

    manifest: dict = {"tables": {}, "mapping": {}, "source": {}}

    # The block the snapshot was taken at, so the site can say so rather than implying live.
    head = psql('select "atBlock" from public."IndexState" limit 1').strip()
    manifest["source"]["indexed_to_block"] = int(head) if head else None
    manifest["source"]["taken_at"] = psql("select now()").strip()

    ddl: list[str] = [
        "-- Generated by tools/export-d1.py. Do not edit by hand.",
        "PRAGMA foreign_keys=OFF;",
    ]

    for ref, table, _is_view in OBJECTS:
        cols = columns(ref)
        manifest["mapping"][ref] = table
        defs = []
        for col, typ, nullable in cols:
            st = TYPES.get(typ)
            if st is None:
                sys.exit(f"unmapped type {typ} on {ref}.{col}. Add it to TYPES deliberately.")
            defs.append(f'  "{col}" {st}{"" if nullable else " NOT NULL"}')
        ddl.append(f'DROP TABLE IF EXISTS "{table}";')
        ddl.append(f'CREATE TABLE "{table}" (\n' + ",\n".join(defs) + "\n);")

    (out / "000-schema.sql").write_text("\n".join(ddl) + "\n")

    total = 0
    for ref, table, _is_view in OBJECTS:
        cols = columns(ref)
        names = [c[0] for c in cols]
        types = {c[0]: c[1] for c in cols}
        # row_to_json keeps every type legible in one pass and handles the array column without a
        # second query shape. The sort happens inside the subquery on the real first column,
        # because ordering the json output itself has no operator, so a re-export stays
        # byte-comparable.
        raw = psql(f"select row_to_json(t) from (select * from {ref} order by 1) t")
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        manifest["tables"][table] = len(rows)
        total += len(rows)

        collist = ", ".join(f'"{n}"' for n in names)
        part = 0
        for i in range(0, len(rows), args.chunk):
            part += 1
            stmts = []
            for row in rows[i : i + args.chunk]:
                vals = ", ".join(sqlite_literal(row.get(n), types[n]) for n in names)
                stmts.append(f'INSERT INTO "{table}" ({collist}) VALUES ({vals});')
            name = f"{table}-{part:03d}.sql" if len(rows) > args.chunk else f"{table}.sql"
            (out / f"100-{name}").write_text("\n".join(stmts) + "\n")
        print(f"{table:<26} {len(rows):>7} rows  {part} file(s)")

    # Indexes after the load, because building them per insert is slower and buys nothing here.
    idx = [
        'CREATE INDEX IF NOT EXISTS agent_agentid ON "Agent" ("agentId");',
        'CREATE INDEX IF NOT EXISTS agent_urihash ON "Agent" ("uriHash");',
        'CREATE INDEX IF NOT EXISTS feedback_agent ON "Feedback" ("agent_id");',
        'CREATE INDEX IF NOT EXISTS verdict_feedback ON "fovea_verdict" ("feedback_id");',
        'CREATE INDEX IF NOT EXISTS vlatest_feedback ON "fovea_verdict_latest" ("feedback_id");',
        'CREATE INDEX IF NOT EXISTS probe_hash ON "fovea_record_probe" ("uri_hash");',
        'CREATE INDEX IF NOT EXISTS state_hash ON "fovea_record_state" ("uri_hash");',
    ]
    (out / "900-indexes.sql").write_text("\n".join(idx) + "\n")

    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, default=str) + "\n")
    print(f"\ntotal {total} rows -> {out}")
    print(f"snapshot indexed to block {manifest['source']['indexed_to_block']}")


if __name__ == "__main__":
    main()
