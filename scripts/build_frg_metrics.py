from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def to_num(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, str) and not value.strip():
            return default
        return float(value)
    except Exception:
        return default


def norm_code(value: object) -> str:
    return str(value or "").strip().upper()


def clean_airline(value: object) -> str:
    code = norm_code(value).replace("*", "")
    return code.split()[0] if code else ""


def clean_flight_num(row: pd.Series) -> str:
    raw = row.get("Flt Num (Mktd)")
    if pd.notna(raw):
        try:
            return str(int(float(raw)))
        except Exception:
            pass
    desg = norm_code(row.get("Flt Desg (Mktd)"))
    digits = "".join(ch for ch in desg if ch.isdigit())
    return digits or desg or "0"


def build_metrics(frg_path: Path, output_path: Path, host_airline: str) -> None:
    usecols = [
        "Dept Sta",
        "Arvl Sta",
        "Aln (Mktd)",
        "Flt Desg (Mktd)",
        "Flt Num (Mktd)",
        "Number of Services",
        "Total Seats",
        "Load Factor",
        "Total Pax Dmd [Total]",
        "Total Traf [Flow]",
        "Total Traf [Local]",
        "Total Traf [Total]",
        "Total Rev [Pax Flow] ($)",
        "Total Rev [Pax Local] ($)",
        "Total Rev [Total Cargo + Pax] ($)",
    ]
    df = pd.read_excel(frg_path, sheet_name=0, usecols=lambda c: c in usecols)
    if df.empty:
        payload = {
            "ok": False,
            "message": "FRG workbook is empty",
            "host_airline": host_airline,
            "od_options": [],
            "od_aggregates": [],
            "flight_rows": [],
            "market_by_od": {},
        }
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload), encoding="utf-8")
        return

    df["orig"] = df["Dept Sta"].map(norm_code)
    df["dest"] = df["Arvl Sta"].map(norm_code)
    df["od"] = df["orig"] + "-" + df["dest"]
    df["airline"] = df["Aln (Mktd)"].map(clean_airline)
    df["flight_number"] = df.apply(clean_flight_num, axis=1)

    df["weekly_deps"] = df["Number of Services"].map(to_num)
    df["weekly_seats"] = df["Total Seats"].map(to_num)
    df["flow_pax"] = df["Total Traf [Flow]"].map(to_num)
    df["local_pax"] = df["Total Traf [Local]"].map(to_num)
    df["total_pax"] = df["Total Traf [Total]"].map(to_num)
    df["flow_revenue"] = df["Total Rev [Pax Flow] ($)"].map(to_num)
    df["local_revenue"] = df["Total Rev [Pax Local] ($)"].map(to_num)
    df["total_revenue"] = df["Total Rev [Total Cargo + Pax] ($)"].map(to_num)
    df["total_demand"] = df["Total Pax Dmd [Total]"].map(to_num)

    host = clean_airline(host_airline)

    market_rows = []
    market_by_od: dict[str, list[dict[str, object]]] = {}
    group_cols = ["od", "orig", "dest", "airline"]
    for (od, orig, dest, airline), g in df.groupby(group_cols, dropna=False):
        demand = float(g["total_demand"].sum())
        traffic = float(g["total_pax"].sum())
        revenue = float(g["total_revenue"].sum())
        nstops = float(g["weekly_deps"].sum())
        row = {
            "aln": airline or "?",
            "nstops": nstops,
            "cncts": 0.0,
            "demand": demand if demand > 0 else traffic,
            "traffic": traffic,
            "revenue": revenue,
            "avgFare": (revenue / traffic) if traffic > 0 else 0.0,
        }
        market_rows.append((od, orig, dest, row))

    tmp = {}
    for od, orig, dest, row in market_rows:
        arr = tmp.get(od, [])
        arr.append(row)
        tmp[od] = arr

    for od, rows in tmp.items():
        total_demand = sum(float(x["demand"]) for x in rows) or 1.0
        total_traffic = sum(float(x["traffic"]) for x in rows) or 1.0
        total_revenue = sum(float(x["revenue"]) for x in rows) or 1.0
        out_rows = []
        for r in rows:
            rr = dict(r)
            rr["demandShare"] = (float(rr["demand"]) / total_demand) * 100.0
            rr["trafficShare"] = (float(rr["traffic"]) / total_traffic) * 100.0
            rr["revenueShare"] = (float(rr["revenue"]) / total_revenue) * 100.0
            out_rows.append(rr)
        out_rows.sort(key=lambda x: float(x["demand"]), reverse=True)
        market_by_od[od] = out_rows

    # Host OD aggregates for Network tab
    od_aggregates = []
    host_df = df[df["airline"] == host] if host else df.iloc[0:0]
    for (od, orig, dest), g in host_df.groupby(["od", "orig", "dest"], dropna=False):
        total_pax = float(g["total_pax"].sum())
        flow_pax = float(g["flow_pax"].sum())
        local_pax = float(g["local_pax"].sum())
        total_rev = float(g["total_revenue"].sum())
        flow_rev = float(g["flow_revenue"].sum())
        local_rev = float(g["local_revenue"].sum())
        weekly_seats = float(g["weekly_seats"].sum())
        lf = (total_pax / weekly_seats * 100.0) if weekly_seats > 0 else 0.0

        m_rows = market_by_od.get(od, [])
        host_market = next((x for x in m_rows if norm_code(x.get("aln")) == host), None)
        host_share = float(host_market["trafficShare"]) if host_market else 0.0

        od_aggregates.append(
            {
                "od": od,
                "orig": orig,
                "dest": dest,
                "flights": int(g.shape[0]),
                "weeklyDepartures": float(g["weekly_deps"].sum()),
                "localPax": local_pax,
                "flowPax": flow_pax,
                "totalPax": total_pax,
                "weeklyPax": total_pax,
                "weeklySeats": weekly_seats,
                "loadFactorPct": lf,
                "localRevenue": local_rev,
                "flowRevenue": flow_rev,
                "totalRevenue": total_rev,
                "flowPddPct": (flow_pax / total_pax * 100.0) if total_pax > 0 else 0.0,
                "flowApmPct": (flow_pax / total_pax * 100.0) if total_pax > 0 else 0.0,
                "absPaxDiffPct": 0.0,
                "absPlfDiffPct": 0.0,
                "hostSharePct": host_share,
                "predictedMarketSharePct": host_share,
                "actualMarketSharePct": host_share,
                "elapsedTimeDeltaPct": 0.0,
                "localDemandPct": (local_pax / total_pax * 100.0) if total_pax > 0 else 0.0,
                "flowDemandPct": (flow_pax / total_pax * 100.0) if total_pax > 0 else 0.0,
                "localRevenuePct": (local_rev / total_rev * 100.0) if total_rev > 0 else 0.0,
                "flowRevenuePct": (flow_rev / total_rev * 100.0) if total_rev > 0 else 0.0,
            }
        )

    od_aggregates.sort(key=lambda x: float(x["totalRevenue"]), reverse=True)

    # Flight aggregates for Flight View
    flight_rows = []
    for (airline, fnum, orig, dest), g in df.groupby(["airline", "flight_number", "orig", "dest"], dropna=False):
        weekly_deps = float(g["weekly_deps"].sum())
        weekly_seats = float(g["weekly_seats"].sum())
        observed_pax = float(g["total_pax"].sum())
        load_factor = (observed_pax / weekly_seats * 100.0) if weekly_seats > 0 else 0.0
        revenue = float(g["total_revenue"].sum())
        flow_pax = float(g["flow_pax"].sum())
        local_pax = float(g["local_pax"].sum())
        total_pax = observed_pax
        avg_fare = (revenue / observed_pax) if observed_pax > 0 else 0.0
        seats_per_dep = (weekly_seats / weekly_deps) if weekly_deps > 0 else weekly_seats
        flight_rows.append(
            {
                "isHost": norm_code(airline) == host,
                "key": f"{airline}-{fnum}-{orig}-{dest}",
                "airline": airline or "?",
                "flightNumber": fnum or "0",
                "orig": orig,
                "dest": dest,
                "freq": "",
                "weeklyDeps": weekly_deps,
                "equipment": "",
                "seatsPerDep": seats_per_dep,
                "deptTime": "",
                "arvlTime": "",
                "elapTime": "",
                "observedPax": observed_pax,
                "totalPax": total_pax,
                "localPax": local_pax,
                "flowPax": flow_pax,
                "loadFactor": load_factor,
                "weeklySeats": weekly_seats,
                "revenue": revenue,
                "avgFare": avg_fare,
            }
        )

    flight_rows.sort(key=lambda x: (not bool(x["isHost"]), x["orig"], x["dest"], str(x["flightNumber"])))
    od_options = sorted(market_by_od.keys())

    payload = {
        "ok": True,
        "host_airline": host,
        "rows": int(df.shape[0]),
        "od_options": od_options,
        "od_aggregates": od_aggregates,
        "flight_rows": flight_rows,
        "market_by_od": market_by_od,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"FRG metrics written: {output_path}")
    print(f"Rows: {df.shape[0]} | ODs: {len(od_options)} | Flights: {len(flight_rows)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build dashboard metrics JSON from FRG workbook.")
    parser.add_argument("--frg", required=True, help="Path to frg.xlsx")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--host-airline", default="S5", help="Host airline code")
    args = parser.parse_args()

    build_metrics(Path(args.frg), Path(args.output), args.host_airline)


if __name__ == "__main__":
    main()

