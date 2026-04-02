from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd


def norm(v: object) -> str:
    return str(v or "").strip().upper()


def clean_air(v: object) -> str:
    return norm(v).replace("*", "").split()[0]


def parse_num(raw: object, desg: object = "") -> str:
    try:
        if pd.notna(raw):
            return str(int(float(raw)))
    except Exception:
        pass
    digits = re.findall(r"\d+", str(desg or ""))
    return (digits[-1].lstrip("0") or "0") if digits else str(desg or "").strip()


def to_num(v: object) -> float:
    try:
        if v is None:
            return 0.0
        if isinstance(v, str) and not v.strip():
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def build(frg_xlsx: Path, dash_csv: Path, out_json: Path, workset_id: str = "") -> None:
    fr = pd.read_excel(frg_xlsx, sheet_name=0)
    fr["orig"] = fr["Dept Sta"].map(norm)
    fr["dest"] = fr["Arvl Sta"].map(norm)
    fr["airline"] = fr["Aln (Mktd)"].map(clean_air)
    fr["flight_number"] = fr.apply(lambda r: parse_num(r.get("Flt Num (Mktd)"), r.get("Flt Desg (Mktd)")), axis=1)
    fr["od"] = fr["orig"] + "-" + fr["dest"]
    fr["traffic"] = fr["Total Traf [Total]"].map(to_num)
    fr["seats"] = fr["Total Seats"].map(to_num)
    fr["revenue"] = fr["Total Rev [Total Cargo + Pax] ($)"].map(to_num)

    frg_agg = (
        fr.groupby(["od", "airline", "flight_number"], dropna=False)[["traffic", "seats", "revenue"]]
        .sum()
        .reset_index()
    )
    frg_agg["load_factor"] = frg_agg.apply(lambda r: (r["traffic"] / r["seats"] * 100.0) if r["seats"] > 0 else 0.0, axis=1)

    da = pd.read_csv(dash_csv)
    da["orig"] = da["Dept Sta"].map(norm)
    da["dest"] = da["Arvl Sta"].map(norm)
    da["od"] = da["orig"] + "-" + da["dest"]
    da["airline"] = da["Flt Desg"].map(lambda x: clean_air(str(x).split()[0] if str(x).strip() else ""))
    da["flight_number"] = da["Flt Desg"].map(lambda x: parse_num(None, x))
    da["traffic"] = da["Total Traffic"].map(to_num)
    da["seats"] = da["Seats"].map(to_num)
    da["revenue"] = da["Total Revenue($)"].map(to_num)

    dash_agg = (
        da.groupby(["od", "airline", "flight_number"], dropna=False)[["traffic", "seats", "revenue"]]
        .sum()
        .reset_index()
    )
    dash_agg["load_factor"] = dash_agg.apply(lambda r: (r["traffic"] / r["seats"] * 100.0) if r["seats"] > 0 else 0.0, axis=1)

    merged = dash_agg.merge(frg_agg, on=["od", "airline", "flight_number"], how="left", suffixes=("_dash", "_frg")).fillna(0.0)

    targets = {}
    factors = {}
    for row in merged.itertuples(index=False):
        key = f"{row.od}::{row.airline}::{row.flight_number}"
        targets[key] = {
            "traffic": float(row.traffic_frg),
            "seats": float(row.seats_frg),
            "revenue": float(row.revenue_frg),
            "loadFactor": float(row.load_factor_frg),
        }
        factors[key] = {
            "traffic": float((row.traffic_frg / row.traffic_dash) if row.traffic_dash else 1.0),
            "seats": float((row.seats_frg / row.seats_dash) if row.seats_dash else 1.0),
            "revenue": float((row.revenue_frg / row.revenue_dash) if row.revenue_dash else 1.0),
            "loadFactor": float((row.load_factor_frg / row.load_factor_dash) if row.load_factor_dash else 1.0),
        }

    frg_od_air = fr.groupby(["od", "airline"], dropna=False)[["traffic", "seats", "revenue"]].sum().reset_index()
    dash_od_air = da.groupby(["od", "airline"], dropna=False)[["traffic", "seats", "revenue"]].sum().reset_index()
    od_air_merged = dash_od_air.merge(frg_od_air, on=["od", "airline"], how="left", suffixes=("_dash", "_frg")).fillna(0.0)
    od_air_targets = {}
    for row in od_air_merged.itertuples(index=False):
        key = f"{row.od}::{row.airline}"
        od_air_targets[key] = {
            "traffic": float(row.traffic_frg),
            "seats": float(row.seats_frg),
            "revenue": float(row.revenue_frg),
            "loadFactor": float((row.traffic_frg / row.seats_frg * 100.0) if row.seats_frg > 0 else 0.0),
        }

    payload = {
        "ok": True,
        "workset_id": workset_id,
        "flight_targets": targets,
        "flight_factors": factors,
        "od_airline_targets": od_air_targets,
        "count": len(targets),
    }
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote corrections: {out_json} ({len(targets)} keys)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build FRG correction map for dashboard numbers.")
    parser.add_argument("--frg", required=True)
    parser.add_argument("--dash-flight-csv", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workset-id", default="")
    args = parser.parse_args()
    build(Path(args.frg), Path(args.dash_flight_csv), Path(args.output), args.workset_id)


if __name__ == "__main__":
    main()
