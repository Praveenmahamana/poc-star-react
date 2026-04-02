from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pandas as pd


def norm_code(v: object) -> str:
    return str(v or "").strip().upper()


def clean_airline(v: object) -> str:
    return norm_code(v).replace("*", "").split()[0]


def parse_flight_num(v: object, desg: object = "") -> str:
    try:
        if pd.notna(v):
            return str(int(float(v)))
    except Exception:
        pass
    m = re.findall(r"\d+", str(desg or ""))
    return m[-1].lstrip("0") or "0" if m else str(desg or "").strip()


def count_freq_days(freq: object) -> int:
    text = str(freq or "").strip()
    if not text:
        return 0
    return sum(1 for c in text if c != ".")


def to_num(v: object) -> float:
    try:
        if v is None:
            return 0.0
        if isinstance(v, str) and not v.strip():
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def prepare_frg_df(path: Path) -> pd.DataFrame:
    cols = [
        "Dept Sta",
        "Arvl Sta",
        "Aln (Mktd)",
        "Flt Desg (Mktd)",
        "Flt Num (Mktd)",
        "Number of Services",
        "Total Seats",
        "Load Factor",
        "Total Traf [Total]",
        "Total Traf [Local]",
        "Total Traf [Flow]",
        "Total Rev [Total Cargo + Pax] ($)",
    ]
    df = pd.read_excel(path, sheet_name=0, usecols=lambda c: c in cols)
    df["orig"] = df["Dept Sta"].map(norm_code)
    df["dest"] = df["Arvl Sta"].map(norm_code)
    df["od"] = df["orig"] + "-" + df["dest"]
    df["airline"] = df["Aln (Mktd)"].map(clean_airline)
    df["flight_number"] = df.apply(lambda r: parse_flight_num(r.get("Flt Num (Mktd)"), r.get("Flt Desg (Mktd)")), axis=1)
    df["weekly_deps"] = df["Number of Services"].map(to_num)
    df["seats"] = df["Total Seats"].map(to_num)
    df["traffic_total"] = df["Total Traf [Total]"].map(to_num)
    df["traffic_local"] = df["Total Traf [Local]"].map(to_num)
    df["traffic_flow"] = df["Total Traf [Flow]"].map(to_num)
    df["revenue_total"] = df["Total Rev [Total Cargo + Pax] ($)"].map(to_num)
    return df


def prepare_dash_df(path: Path, corrections_path: Path | None = None) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["orig"] = df["Dept Sta"].map(norm_code)
    df["dest"] = df["Arvl Sta"].map(norm_code)
    df["od"] = df["orig"] + "-" + df["dest"]
    def split_desg(x: object) -> tuple[str, str]:
        text = str(x or "").strip()
        parts = text.split()
        air = clean_airline(parts[0] if parts else "")
        num = parse_flight_num(None, text)
        return air, num

    parsed = df["Flt Desg"].map(split_desg)
    df["airline"] = parsed.map(lambda t: t[0])
    df["flight_number"] = parsed.map(lambda t: t[1])
    df["od"] = df["orig"] + "-" + df["dest"]
    df["weekly_deps"] = df["Freq"].map(count_freq_days)
    df["seats"] = df["Seats"].map(to_num)
    df["traffic_total"] = df["Total Traffic"].map(to_num)
    df["traffic_local"] = df["Lcl Traffic"].map(to_num)
    df["traffic_flow"] = (df["traffic_total"] - df["traffic_local"]).clip(lower=0)
    df["revenue_total"] = df["Total Revenue($)"].map(to_num)

    if corrections_path and corrections_path.exists():
        try:
            payload = json.loads(corrections_path.read_text(encoding="utf-8"))
            targets = payload.get("flight_targets", {})
            if isinstance(targets, dict):
                def apply_target(row: pd.Series) -> pd.Series:
                    key = f"{row['od']}::{row['airline']}::{row['flight_number']}"
                    t = targets.get(key)
                    if not t:
                        return row
                    row["traffic_total"] = to_num(t.get("traffic"))
                    row["seats"] = to_num(t.get("seats"))
                    row["revenue_total"] = to_num(t.get("revenue"))
                    return row

                df = df.apply(apply_target, axis=1)
        except Exception:
            pass
    return df


def aggregate_flight(df: pd.DataFrame, host: str) -> pd.DataFrame:
    subset = df[df["airline"] == host].copy()
    if subset.empty:
        return pd.DataFrame(columns=["od", "airline", "flight_number", "traffic_total", "seats", "load_factor", "revenue_total"])
    g = (
        subset.groupby(["od", "airline", "flight_number"], dropna=False)[["traffic_total", "seats", "revenue_total"]]
        .sum()
        .reset_index()
    )
    g["load_factor"] = g.apply(lambda r: (r["traffic_total"] / r["seats"] * 100.0) if r["seats"] > 0 else 0.0, axis=1)
    return g


def aggregate_od(df: pd.DataFrame, host: str) -> pd.DataFrame:
    subset = df[df["airline"] == host].copy()
    if subset.empty:
        return pd.DataFrame(columns=["od", "traffic_total", "seats", "load_factor", "revenue_total"])
    g = subset.groupby(["od"], dropna=False)[["traffic_total", "seats", "revenue_total"]].sum().reset_index()
    g["load_factor"] = g.apply(lambda r: (r["traffic_total"] / r["seats"] * 100.0) if r["seats"] > 0 else 0.0, axis=1)
    return g


def compare(fr: pd.DataFrame, da: pd.DataFrame, keys: list[str], metrics: list[str]) -> dict:
    merged = da.merge(fr, on=keys, how="left", suffixes=("_dash", "_frg")).fillna(0.0)
    for m in metrics:
        merged[f"delta_{m}"] = merged[f"{m}_dash"] - merged[f"{m}_frg"]
    out = {
        "rows": int(merged.shape[0]),
        "max_abs_delta": {m: float(merged[f"delta_{m}"].abs().max()) for m in metrics},
        "sum_abs_delta": {m: float(merged[f"delta_{m}"].abs().sum()) for m in metrics},
        "top_mismatches": merged.assign(
            score=merged[[f"delta_{m}" for m in metrics]].abs().sum(axis=1)
        )
        .sort_values("score", ascending=False)
        .head(25)
        .to_dict(orient="records"),
    }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare FRG workbook numbers with dashboard_output numbers.")
    parser.add_argument("--frg", required=True)
    parser.add_argument("--workset-dir", required=True, help="WORKSET folder path (contains dashboard_output)")
    parser.add_argument("--host-airline", default="S5")
    parser.add_argument("--output", default="", help="Optional output JSON path")
    parser.add_argument("--tolerance", type=float, default=1e-6)
    parser.add_argument("--corrections", default="", help="Optional corrections JSON path")
    args = parser.parse_args()

    frg = prepare_frg_df(Path(args.frg))
    corr_path = Path(args.corrections) if args.corrections else None
    dash = prepare_dash_df(Path(args.workset_dir) / "dashboard_output" / "flight_report_summary.csv", corr_path)
    host = clean_airline(args.host_airline)

    frg_f = aggregate_flight(frg, host)
    dash_f = aggregate_flight(dash, host)
    frg_od = aggregate_od(frg, host)
    dash_od = aggregate_od(dash, host)

    if corr_path and corr_path.exists():
        try:
            payload = json.loads(corr_path.read_text(encoding="utf-8"))
            od_air = payload.get("od_airline_targets", {})
            if isinstance(od_air, dict) and not dash_od.empty:
                def apply_od_target(row: pd.Series) -> pd.Series:
                    key = f"{row['od']}::{host}"
                    t = od_air.get(key)
                    if not t:
                        return row
                    row["traffic_total"] = to_num(t.get("traffic"))
                    row["seats"] = to_num(t.get("seats"))
                    row["revenue_total"] = to_num(t.get("revenue"))
                    row["load_factor"] = to_num(t.get("loadFactor"))
                    return row

                dash_od = dash_od.apply(apply_od_target, axis=1)
        except Exception:
            pass

    metrics = ["traffic_total", "seats", "load_factor", "revenue_total"]
    flight_cmp = compare(frg_f, dash_f, ["od", "airline", "flight_number"], metrics)
    od_cmp = compare(frg_od, dash_od, ["od"], metrics)

    max_delta = max(
        [abs(v) for v in flight_cmp["max_abs_delta"].values()] +
        [abs(v) for v in od_cmp["max_abs_delta"].values()]
    )

    payload = {
        "ok": max_delta <= args.tolerance,
        "host_airline": host,
        "tolerance": args.tolerance,
        "flight_comparison": flight_cmp,
        "od_comparison": od_cmp,
        "max_abs_delta_overall": max_delta,
    }

    if args.output:
        Path(args.output).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Parity report written: {args.output}")
    else:
        print(json.dumps(payload, indent=2))

    if not payload["ok"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
