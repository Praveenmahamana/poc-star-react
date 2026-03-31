from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from pathlib import Path


def iter_csv_rows(path: Path):
    if not path.exists():
        return
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            yield {k: (v if v is not None else "") for k, v in row.items()}


def iter_pref_rows(path: Path):
    if not path.exists():
        return
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            yield {k: (v if v is not None else "") for k, v in row.items()}


def build_database(base_dir: Path, output_db: Path, workset_ids: list[str]) -> None:
    output_db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(output_db, timeout=60)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
    except sqlite3.OperationalError:
        # Some synced folders (for example OneDrive) can reject WAL mode with I/O errors.
        conn.execute("PRAGMA journal_mode=DELETE;")
        conn.execute("PRAGMA synchronous=OFF;")
    conn.execute("PRAGMA temp_store=MEMORY;")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workset_meta (
          workset_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          profile_json TEXT
        );

        CREATE TABLE IF NOT EXISTS flight_report (
          workset_id TEXT NOT NULL,
          od TEXT NOT NULL,
          row_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS itinerary_report (
          workset_id TEXT NOT NULL,
          od TEXT NOT NULL,
          row_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS preference_rows (
          workset_id TEXT NOT NULL,
          pref_type TEXT NOT NULL,
          row_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_flight_report_workset_od ON flight_report(workset_id, od);
        CREATE INDEX IF NOT EXISTS idx_itinerary_report_workset_od ON itinerary_report(workset_id, od);
        CREATE INDEX IF NOT EXISTS idx_preference_rows_workset_type ON preference_rows(workset_id, pref_type);
        """
    )
    conn.executescript(
        """
        DELETE FROM workset_meta;
        DELETE FROM flight_report;
        DELETE FROM itinerary_report;
        DELETE FROM preference_rows;
        """
    )

    for workset_id in workset_ids:
        workset_dir = base_dir / workset_id
        output_dir = workset_dir / "dashboard_output"
        profile_path = output_dir / "workset_profile.json"
        profile_obj = {}
        if profile_path.exists():
            try:
                profile_obj = json.loads(profile_path.read_text(encoding="utf-8"))
            except Exception:
                profile_obj = {}

        label = workset_id
        host_airline = str(profile_obj.get("host_airline", "")).strip()
        host_eff_date = str(profile_obj.get("host_eff_date", "")).strip()
        if host_airline:
            label = f"{workset_id} \u2014 {host_airline}"
        if host_eff_date:
            label = f"{label} {host_eff_date}"

        conn.execute(
            "INSERT OR REPLACE INTO workset_meta (workset_id, label, profile_json) VALUES (?, ?, ?)",
            (workset_id, label, json.dumps(profile_obj, separators=(",", ":"))),
        )

        flight_insert_batch = []
        for row in iter_csv_rows(output_dir / "flight_report_summary.csv") or []:
            od = f"{row.get('Dept Sta', '').strip()}-{row.get('Arvl Sta', '').strip()}".strip("-")
            if not od:
                continue
            flight_insert_batch.append((workset_id, od, json.dumps(row, separators=(",", ":"))))
            if len(flight_insert_batch) >= 5000:
                conn.executemany(
                    "INSERT INTO flight_report (workset_id, od, row_json) VALUES (?, ?, ?)",
                    flight_insert_batch,
                )
                flight_insert_batch = []
        if flight_insert_batch:
            conn.executemany(
                "INSERT INTO flight_report (workset_id, od, row_json) VALUES (?, ?, ?)",
                flight_insert_batch,
            )

        itin_insert_batch = []
        for row in iter_csv_rows(output_dir / "itinerary_report_summary.csv") or []:
            od = f"{row.get('Dept Arp', '').strip()}-{row.get('Arvl Arp', '').strip()}".strip("-")
            if not od:
                continue
            itin_insert_batch.append((workset_id, od, json.dumps(row, separators=(",", ":"))))
            if len(itin_insert_batch) >= 5000:
                conn.executemany(
                    "INSERT INTO itinerary_report (workset_id, od, row_json) VALUES (?, ?, ?)",
                    itin_insert_batch,
                )
                itin_insert_batch = []
        if itin_insert_batch:
            conn.executemany(
                "INSERT INTO itinerary_report (workset_id, od, row_json) VALUES (?, ?, ?)",
                itin_insert_batch,
            )

        data_dir = workset_dir / "data"
        for pref_type in ["alnPref", "alliancePref", "relfarePref"]:
            pref_path = data_dir / f"{pref_type}.dat"
            pref_batch = []
            for row in iter_pref_rows(pref_path) or []:
                pref_batch.append((workset_id, pref_type, json.dumps(row, separators=(",", ":"))))
                if len(pref_batch) >= 5000:
                    conn.executemany(
                        "INSERT INTO preference_rows (workset_id, pref_type, row_json) VALUES (?, ?, ?)",
                        pref_batch,
                    )
                    pref_batch = []
            if pref_batch:
                conn.executemany(
                    "INSERT INTO preference_rows (workset_id, pref_type, row_json) VALUES (?, ?, ?)",
                    pref_batch,
                )

        conn.commit()
        print(f"SQLite rows prepared for {workset_id}")

    conn.commit()
    conn.close()
    print(f"SQLite database created at {output_db}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build one SQLite DB for all dashboard worksets.")
    parser.add_argument("--base-dir", required=True, help="Base directory that contains WORKSET folders.")
    parser.add_argument("--worksets", required=True, nargs="+", help="Workset IDs to include in database.")
    parser.add_argument("--output-db", required=True, help="Output sqlite path.")
    args = parser.parse_args()

    build_database(Path(args.base_dir), Path(args.output_db), args.worksets)


if __name__ == "__main__":
    main()
