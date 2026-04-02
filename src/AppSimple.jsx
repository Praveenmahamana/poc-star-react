import React, { useEffect, useMemo, useState } from "react";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { Badge, Group, Paper, ScrollArea, Select, SimpleGrid, Slider, Stack, Table as MantineTable, Text, Title } from "@mantine/core";
import initialBundle from "./generated/dashboard_bundle.json";

const tabs = [
  { id: "summary", label: "Network", icon: "N" },
  { id: "flightView", label: "Flight View", icon: "F" },
  { id: "odView", label: "O&D View", icon: "OD" },
];

function formatNumber(value, digits = 0) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(num);
}

function formatPct(value, digits = 1) {
  return `${formatNumber(value, digits)}%`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function fetchJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(path);
    return response.json();
  });
}

function queryRowsFromSqlite(db, sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const obj = stmt.getAsObject();
    if (obj.row_json) rows.push(JSON.parse(obj.row_json));
  }
  stmt.free();
  return rows;
}

function parseElapsedToMinutes(elap) {
  const parts = String(elap || "0:0").split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function parseFlightDesign(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const match = text.match(/^([A-Z0-9*]{1,3})\s*([0-9A-Z]+)?$/i);
  if (!match) return { airline: text.split(" ")[0] || "", flightNumber: text };
  return {
    airline: String(match[1] || "").replace("*", "").toUpperCase(),
    flightNumber: String(match[2] || "").replace(/^0+/, "") || "0",
  };
}

function SplitBar({ localPct, flowPct }) {
  const safeLocal = Math.max(0, Number(localPct || 0));
  const safeFlow = Math.max(0, Number(flowPct || 0));
  return (
    <div className="split-bar-wrap">
      <div className="split-bar">
        <div className="split-local" style={{ width: `${safeLocal}%` }} />
        <div className="split-flow" style={{ width: `${safeFlow}%` }} />
      </div>
      <div className="split-legend">
        <span>Local {formatPct(safeLocal, 1)}</span>
        <span>Flow {formatPct(safeFlow, 1)}</span>
      </div>
    </div>
  );
}

function NetworkScorecard({ hostPax, hostSeats, avgLoadFactor, totalLocalPax, totalFlowPax, totalLocalRevenue, totalFlowRevenue }) {
  const totalPax = (totalLocalPax + totalFlowPax) || 1;
  const totalRev = (totalLocalRevenue + totalFlowRevenue) || 1;
  const localPaxPct = (totalLocalPax / totalPax) * 100;
  const flowPaxPct = (totalFlowPax / totalPax) * 100;
  const localRevPct = (totalLocalRevenue / totalRev) * 100;
  const flowRevPct = (totalFlowRevenue / totalRev) * 100;
  const lf = Math.min(avgLoadFactor, 100);
  return (
    <div className="net-scorecard">
      <div className="nsc-group">
        <div className="nsc-kpi">
          <div className="nsc-kpi-label">Weekly Pax</div>
          <div className="nsc-kpi-value">{formatNumber(hostPax)}</div>
          <div className="nsc-kpi-sub">Est. demand capture</div>
        </div>
        <div className="nsc-kpi">
          <div className="nsc-kpi-label">Weekly Seats</div>
          <div className="nsc-kpi-value">{formatNumber(hostSeats)}</div>
          <div className="nsc-kpi-sub">Scheduled capacity</div>
        </div>
        <div className="nsc-kpi">
          <div className="nsc-kpi-label">Load Factor</div>
          <div className="nsc-kpi-value accent">{formatPct(avgLoadFactor, 1)}</div>
          <div className="nsc-lf-track"><div className="nsc-lf-fill" style={{ width: `${lf}%` }} /></div>
        </div>
      </div>
      <div className="nsc-divider-v" />
      <div className="nsc-group">
        <div className="nsc-split">
          <div className="nsc-split-label">Demand Mix <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-secondary)" }}>(all host ODs)</span></div>
          <div className="nsc-split-nums">
            <span className="nsc-local-val">{formatNumber(totalLocalPax, 0)}</span>
            <span className="nsc-split-sep">|</span>
            <span className="nsc-flow-val">{formatNumber(totalFlowPax, 0)}</span>
          </div>
          <SplitBar localPct={localPaxPct} flowPct={flowPaxPct} />
        </div>
        <div className="nsc-split">
          <div className="nsc-split-label">Revenue Mix <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-secondary)" }}>(all host ODs)</span></div>
          <div className="nsc-split-nums">
            <span className="nsc-local-val">{formatNumber(totalLocalRevenue, 0)}</span>
            <span className="nsc-split-sep">|</span>
            <span className="nsc-flow-val">{formatNumber(totalFlowRevenue, 0)}</span>
          </div>
          <SplitBar localPct={localRevPct} flowPct={flowRevPct} />
        </div>
      </div>
    </div>
  );
}

function SidebarKpis({ hostAirline, hostPax, hostSeats, avgLoadFactor, totalLocalPax, totalFlowPax, totalLocalRevenue, totalFlowRevenue }) {
  const cards = [
    { label: "Weekly Pax", value: formatNumber(hostPax, 0), tone: "blue" },
    { label: "Weekly Seats", value: formatNumber(hostSeats, 0), tone: "teal" },
    { label: "Load Factor", value: formatPct(avgLoadFactor, 1), tone: "amber" },
    { label: "Local/Flow Pax", value: `${formatNumber(totalLocalPax, 0)} / ${formatNumber(totalFlowPax, 0)}`, tone: "indigo" },
    { label: "Local/Flow Revenue", value: `${formatNumber(totalLocalRevenue, 0)} / ${formatNumber(totalFlowRevenue, 0)}`, tone: "slate" },
  ];
  return (
    <div className="sidebar-kpi-wrap">
      <div className="eyebrow">KPI Snapshot</div>
      <div className="sidebar-kpi-grid">
        {cards.map((card) => (
          <div key={card.label} className={`sidebar-kpi-card ${card.tone}`}>
            <div className="sidebar-kpi-label">{card.label}</div>
            <div className="sidebar-kpi-value">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="sidebar-kpi-note">{hostAirline || "Host"} network aggregate</div>
    </div>
  );
}

function Table({ columns, rows, emptyMessage, onRowClick, selectedKey, selectedKeyField }) {
  if (!rows.length) return <div className="empty-state">{emptyMessage}</div>;
  return (
    <div className="table-shell">
      <table>
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selectedKey != null && selectedKeyField && row[selectedKeyField] === selectedKey;
            return (
              <tr
                key={`${index}-${columns[0].key}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`${onRowClick ? "row-clickable" : ""} ${isSelected ? "row-selected" : ""}`}
              >
                {columns.map((column) => <td key={column.key}>{column.render ? column.render(row[column.key], row) : row[column.key]}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PIE_COLORS = ["#2065d1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16", "#6366f1"];

function PieChart({ slices, size = 180 }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return <div className="empty-state" style={{ padding: "24px" }}>No data available</div>;
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  const positiveSlices = slices.filter((s) => Number(s.value || 0) > 0);
  if (positiveSlices.length === 1) {
    const only = positiveSlices[0];
    const full = { ...only, pct: 100, color: PIE_COLORS[0] };
    return (
      <div className="pie-wrap">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <circle cx={cx} cy={cy} r={r} fill={full.color} stroke="#fff" strokeWidth="1.5" />
        </svg>
        <div className="pie-legend">
          <div className="pie-legend-item">
            <span className="pie-dot" style={{ background: full.color }} />
            <span className="pie-label">{full.label}</span>
            <span className="pie-pct">{formatPct(full.pct, 1)}</span>
          </div>
        </div>
      </div>
    );
  }
  let angle = -Math.PI / 2;
  const paths = positiveSlices
    .map((slice, i) => {
      const frac = slice.value / total;
      const start = angle;
      const end = angle + frac * 2 * Math.PI;
      angle = end;
      const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      return { ...slice, d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x2},${y2} Z`, pct: frac * 100, color: PIE_COLORS[i % PIE_COLORS.length] };
    });
  return (
    <div className="pie-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} stroke="#fff" strokeWidth="1.5" />)}
      </svg>
      <div className="pie-legend">
        {paths.map((p, i) => (
          <div key={i} className="pie-legend-item">
            <span className="pie-dot" style={{ background: p.color }} />
            <span className="pie-label">{p.label}</span>
            <span className="pie-pct">{formatPct(p.pct, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function countFreqDays(freq) {
  const s = String(freq || "");
  const m = s.match(/[1-7]/g);
  return m ? m.length : 0;
}

function safeRatio(num, den) {
  return den > 0 ? num / den : 0;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = String(keyFn(item));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function maxAbsFinite(values) {
  let max = 0;
  for (const v of values || []) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const a = Math.abs(n);
    if (a > max) max = a;
  }
  return max;
}

function maxFinite(values, fallback = 0) {
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values || []) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n > max) max = n;
  }
  return Number.isFinite(max) ? max : fallback;
}

function minFinite(values, fallback = 0) {
  let min = Number.POSITIVE_INFINITY;
  for (const v of values || []) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < min) min = n;
  }
  return Number.isFinite(min) ? min : fallback;
}

function minMaxScale(value, min, max) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : 0;
  const span = hi - lo;
  if (span <= 0) return 50;
  return ((value - lo) / span) * 100;
}

function pctToScore(pct) {
  return clamp(Number(pct || 0), 0, 100);
}

function MixFusion({ demandLocalPct, demandFlowPct, revenueLocalPct, revenueFlowPct }) {
  return (
    <div className="mix-fusion">
      <div className="mix-fusion-row">
        <span>D</span>
        <div className="mix-fusion-track">
          <div className="mix-fusion-local" style={{ width: `${Math.max(0, Number(demandLocalPct || 0))}%` }} />
          <div className="mix-fusion-flow" style={{ width: `${Math.max(0, Number(demandFlowPct || 0))}%` }} />
        </div>
      </div>
      <div className="mix-fusion-row">
        <span>R</span>
        <div className="mix-fusion-track">
          <div className="mix-fusion-local" style={{ width: `${Math.max(0, Number(revenueLocalPct || 0))}%` }} />
          <div className="mix-fusion-flow" style={{ width: `${Math.max(0, Number(revenueFlowPct || 0))}%` }} />
        </div>
      </div>
    </div>
  );
}

function RevenueMixPieCell({ localRevenue, flowRevenue }) {
  const local = Math.max(0, Number(localRevenue || 0));
  const flow = Math.max(0, Number(flowRevenue || 0));
  const total = local + flow;
  const localPct = total > 0 ? (local / total) * 100 : 0;
  const flowPct = total > 0 ? (flow / total) * 100 : 0;
  return (
    <div className="rev-pie-cell">
      <div
        className="rev-pie-disc"
        style={{
          background: total > 0
            ? `conic-gradient(#0ea5e9 0 ${localPct}%, #f59e0b ${localPct}% 100%)`
            : "#cbd5e1",
        }}
      />
      <div className="rev-pie-labels">
        <span>L {formatNumber(local, 0)}</span>
        <span>F {formatNumber(flow, 0)}</span>
      </div>
      <div className="rev-pie-pct">{formatPct(localPct, 1)} / {formatPct(flowPct, 1)}</div>
    </div>
  );
}

function QsiBarChart({ qsiRows }) {
  const metrics = [
    { key: "share", label: "Demand Share", isRelative: false },
    { key: "elapScore", label: "Elapsed Time Advantage", isRelative: true, note: "Positive is better (lower elapsed)." },
    { key: "opp", label: "Schedule Opportunity", isRelative: true, note: "Log-scaled schedule coverage." },
    { key: "relFare", label: "Relative Fare", isRelative: true, note: "Positive means higher than market." },
    { key: "service", label: "Service Quality", isRelative: true, note: "N/A in current source." },
    { key: "equipment", label: "Equipment", isRelative: true, note: "N/A in current source." },
    { key: "alnPref", label: "Airline Preference", isRelative: true, note: "N/A in current source." },
    { key: "metroPref", label: "Metro Preference", isRelative: true, note: "N/A in current source." },
    { key: "sr", label: "Schedule Reliability", isRelative: true, note: "N/A in current source." },
    { key: "tow", label: "TOW", isRelative: true, note: "N/A in current source." },
    { key: "rsqm", label: "RSQM", isRelative: true, note: "N/A in current source." },
  ];

  const rows = Array.isArray(qsiRows) ? qsiRows : [];
  if (!rows.length) return <div className="empty-state">No QSI data available.</div>;
  const airlines = rows.slice(0, 6);

  const maxAbsByMetric = Object.fromEntries(
    metrics.map((m) => {
      const vals = airlines.map((a) => Number(a[m.key])).filter((v) => Number.isFinite(v));
      const maxAbs = vals.length ? maxAbsFinite(vals) : 1;
      return [m.key, maxAbs || 1];
    }),
  );

  return (
    <div className="qsi-chart">
      <div className="qsi-header-row">
        <div className="qsi-metric-col">
          <div className="qsi-metric-label">Metric</div>
        </div>
        <div className="qsi-bars-col">
          {airlines.map((a) => <div key={`h-${a.code}`} className="qsi-airline-header">{a.code}</div>)}
        </div>
      </div>

      {metrics.map((m) => {
        const isAllZero = airlines.every((a) => Math.abs(Number(a[m.key] || 0)) < 1e-9);
        return (
          <div key={m.key} className={`qsi-metric-row ${isAllZero ? "qsi-na" : ""}`}>
            <div className="qsi-metric-col">
              <div className="qsi-metric-label">{m.label}</div>
              {m.note ? <div className="qsi-note">{m.note}</div> : null}
            </div>
            <div className="qsi-bars-col">
              {airlines.map((a) => {
                const val = Number(a[m.key] || 0);
                if (!Number.isFinite(val) || isAllZero) {
                  return (
                    <div key={`${m.key}-${a.code}`} className="qsi-bar-line">
                      <div className="qsi-pos-track" />
                      <div className="qsi-val">-</div>
                    </div>
                  );
                }
                if (m.isRelative) {
                  const maxAbs = maxAbsByMetric[m.key] || 1;
                  const pct = Math.min(100, Math.abs(val) / maxAbs * 100);
                  return (
                    <div key={`${m.key}-${a.code}`} className="qsi-bar-line">
                      <div className="qsi-relative-track">
                        <div className="qsi-neg-half" />
                        <div className="qsi-pos-half" />
                        <div className="qsi-center-tick" />
                        <div
                          className="qsi-fill"
                          style={val >= 0 ? { left: "50%", width: `${pct / 2}%` } : { left: `${50 - pct / 2}%`, width: `${pct / 2}%` }}
                        />
                      </div>
                      <div className="qsi-val">{val >= 0 ? "+" : ""}{formatNumber(val, 2)}</div>
                    </div>
                  );
                }
                const pct = Math.max(0, Math.min(100, val));
                return (
                  <div key={`${m.key}-${a.code}`} className="qsi-bar-line">
                    <div className="qsi-pos-track">
                      <div className="qsi-fill" style={{ left: 0, width: `${pct}%` }} />
                    </div>
                    <div className="qsi-val">{formatNumber(val, 1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="qsi-footnote">Relative bars are normalized within each metric across visible airlines.</div>
    </div>
  );
}

function buildQsiRows(itineraryRows, flightRows) {
  const alnMap = new Map();
  for (const row of itineraryRows || []) {
    const aln = String(row["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
    const stops = Number(row["Stops"] || 0);
    const freq = countFreqDays(row["Freq"]);
    const elap = parseElapsedToMinutes(row["Elap Time"]);
    const demand = Number(row["Total Demand"] || 0);
    const traffic = Number(row["Total Traffic"] || 0);
    const g = alnMap.get(aln) || { aln, nstops: 0, cncts: 0, demand: 0, traffic: 0, elapWeighted: 0 };
    if (stops === 0) g.nstops += freq; else g.cncts += freq;
    g.demand += demand;
    g.traffic += traffic;
    g.elapWeighted += elap * traffic;
    alnMap.set(aln, g);
  }
  const yieldMap = new Map();
  for (const row of flightRows || []) {
    const aln = String(row["Flt Desg"] || "").trim().split(/\s+/)[0] || "?";
    const y = yieldMap.get(aln) || { traffic: 0, revenue: 0 };
    y.traffic += Number(row["Total Traffic"] || 0);
    y.revenue += Number(row["Pax Revenue($)"] || 0);
    yieldMap.set(aln, y);
  }
  const alns = [...alnMap.values()];
  const totalDemand = alns.reduce((s, a) => s + a.demand, 0) || 1;
  const totalTraffic = alns.reduce((s, a) => s + a.traffic, 0) || 1;
  const mktElapAvg = alns.reduce((s, a) => s + a.elapWeighted, 0) / totalTraffic || 1;
  const mktRevenue = [...yieldMap.values()].reduce((s, y) => s + y.revenue, 0);
  const mktYield = mktRevenue / totalTraffic || 1;
  const n = alns.length || 1;
  const totalFreq = alns.reduce((s, a) => s + a.nstops + a.cncts, 0) || 1;
  return alns.map((a) => {
    const share = (a.demand / totalDemand) * 100;
    const avgElap = a.traffic > 0 ? a.elapWeighted / a.traffic : 0;
    const elapScore = mktElapAvg > 0 ? ((mktElapAvg - avgElap) / mktElapAvg) * 100 : 0;
    const airlineFreq = a.nstops + a.cncts;
    const opp = airlineFreq > 0 ? Math.log(n * airlineFreq / totalFreq) : 0;
    const yld = yieldMap.get(a.aln);
    const alnYield = yld && yld.traffic > 0 ? yld.revenue / yld.traffic : 0;
    const relFare = mktYield > 0 ? ((alnYield - mktYield) / mktYield) * 100 : 0;
    return { code: a.aln, share, nstops: a.nstops, cncts: a.cncts, elapScore, opp, relFare, service: 0, equipment: 0, alnPref: 0, metroPref: 0, sr: 0, tow: 0, rsqm: 0 };
  }).sort((x, y) => y.share - x.share);
}

function OdDetailPanel({ od, odRow, flightRows, itineraryRows, status, onClose, hostAirline }) {
  const airlineSlices = useMemo(() => {
    const groups = new Map();
    for (const row of flightRows) {
      const code = String(row["Flt Desg"] || "").trim().split(" ")[0] || "?";
      groups.set(code, (groups.get(code) || 0) + Number(row["Total Traffic"] || 0));
    }
    return [...groups.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [flightRows]);

  const hostVsCompSlices = useMemo(() => {
    let hostTraffic = 0, compTraffic = 0;
    for (const row of flightRows) {
      const traffic = Number(row["Total Traffic"] || 0);
      if (String(row["Flt Desg"] || "").trim().startsWith(`${hostAirline} `)) hostTraffic += traffic;
      else compTraffic += traffic;
    }
    return [{ label: hostAirline, value: hostTraffic }, { label: "Competitors", value: compTraffic }];
  }, [flightRows, hostAirline]);

  const directTraffic = useMemo(() => itineraryRows.filter((r) => Number(r["Stops"] || 0) === 0).reduce((s, r) => s + Number(r["Total Traffic"] || 0), 0), [itineraryRows]);
  const connectingTraffic = useMemo(() => itineraryRows.filter((r) => Number(r["Stops"] || 0) > 0).reduce((s, r) => s + Number(r["Total Traffic"] || 0), 0), [itineraryRows]);

  const marketSummaryRows = useMemo(() => {
    const marketOd = od.replace("-", "");
    const itinAgg = new Map();
    for (const row of itineraryRows || []) {
      const aln = String(row["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
      const stops = Number(row["Stops"] || 0);
      const segs = Number(row["Segs"] || 0);
      const freq = countFreqDays(row["Freq"]);
      const g = itinAgg.get(aln) || { nstps: 0, thrus: 0, cncts: 0 };
      if (stops === 0 && segs > 1) g.thrus += freq;
      else if (stops === 0) g.nstps += freq;
      else g.cncts += freq;
      itinAgg.set(aln, g);
    }

    const flightAgg = new Map();
    for (const row of flightRows || []) {
      const parsed = parseFlightDesign(row["Flt Desg"]);
      const aln = parsed.airline || "?";
      const opText = String(row["Op/Nonop Flight"] || "").trim().toLowerCase();
      const isNonop = opText.includes("non");
      const demand = Number(row["Total Demand"] || 0);
      const traffic = Number(row["Total Traffic"] || 0);
      const revenue = Number(row["Total Revenue($)"] || row["Pax Revenue($)"] || 0);
      const g = flightAgg.get(aln) || {
        demand: 0, traffic: 0, revenue: 0,
        opDemand: 0, nonopDemand: 0,
        opTraffic: 0, nonopTraffic: 0,
        opRevenue: 0, nonopRevenue: 0,
      };
      g.demand += demand;
      g.traffic += traffic;
      g.revenue += revenue;
      if (isNonop) {
        g.nonopDemand += demand;
        g.nonopTraffic += traffic;
        g.nonopRevenue += revenue;
      } else {
        g.opDemand += demand;
        g.opTraffic += traffic;
        g.opRevenue += revenue;
      }
      flightAgg.set(aln, g);
    }

    const airlines = new Set([...itinAgg.keys(), ...flightAgg.keys()]);
    const rows = [...airlines].map((aln) => {
      const i = itinAgg.get(aln) || { nstps: 0, thrus: 0, cncts: 0 };
      const f = flightAgg.get(aln) || {
        demand: 0, traffic: 0, revenue: 0,
        opDemand: 0, nonopDemand: 0,
        opTraffic: 0, nonopTraffic: 0,
        opRevenue: 0, nonopRevenue: 0,
      };
      return { aln, market: marketOd, ...i, ...f };
    }).sort((a, b) => b.traffic - a.traffic);

    const mktDemand = rows.reduce((s, r) => s + Number(r.demand || 0), 0) || 1;
    const mktTraffic = rows.reduce((s, r) => s + Number(r.traffic || 0), 0) || 1;
    const mktRevenue = rows.reduce((s, r) => s + Number(r.revenue || 0), 0) || 1;
    return rows.map((r) => ({
      ...r,
      marketSize: mktTraffic,
      demandShare: (Number(r.demand || 0) / mktDemand) * 100,
      trafficShare: (Number(r.traffic || 0) / mktTraffic) * 100,
      revenueShare: (Number(r.revenue || 0) / mktRevenue) * 100,
    }));
  }, [itineraryRows, flightRows, od]);

  return (
    <div className="od-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="od-modal">
        <div className="od-modal-header">
          <div>
            <h3>{od} - Market Detail</h3>
            <p>Airline shares | host vs competitors | local/flow mix | direct vs connecting</p>
          </div>
          <button className="od-close-btn" onClick={onClose}>x</button>
        </div>
        {status === "loading" ? <div className="loading">Loading market data...</div> : (
          <div className="od-modal-body">
            <div className="od-modal-grid">
              <div className="chart-card">
                <div className="chart-head"><h3>Airline Market Share</h3><p>All carriers - share of total traffic</p></div>
                <PieChart slices={airlineSlices} />
              </div>
              <div className="chart-card">
                <div className="chart-head"><h3>Host vs Competitors</h3><p>Host airline share vs market</p></div>
                <PieChart slices={hostVsCompSlices} size={160} />
                <div className="breakdown-list" style={{ marginTop: "12px" }}>
                  {hostVsCompSlices.map((s, i) => (
                    <div key={i} className="breakdown-item">
                      <span>{s.label}</span>
                      <strong>{formatNumber(s.value, 1)}</strong>
                      <span className="breakdown-pct">{formatPct(hostVsCompSlices.reduce((t, x) => t + x.value, 0) ? s.value / hostVsCompSlices.reduce((t, x) => t + x.value, 0) * 100 : 0, 1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="chart-card">
                <div className="chart-head"><h3>Demand &amp; Revenue Mix</h3><p>Local vs flow contribution (host)</p></div>
                {odRow ? (
                  <div className="breakdown-list">
                    <div className="breakdown-section-label">Passengers</div>
                    <div className="breakdown-item">
                      <span>Local Pax</span>
                      <strong>{formatNumber(odRow.localPax, 1)}</strong>
                      <span className="breakdown-pct">{formatPct(odRow.localDemandPct, 1)}</span>
                    </div>
                    <div className="breakdown-item">
                      <span>Flow Pax</span>
                      <strong>{formatNumber(odRow.flowPax, 1)}</strong>
                      <span className="breakdown-pct">{formatPct(odRow.flowDemandPct, 1)}</span>
                    </div>
                    <SplitBar localPct={odRow.localDemandPct} flowPct={odRow.flowDemandPct} />
                    <div className="breakdown-divider" />
                    <div className="breakdown-section-label">Revenue</div>
                    <div className="breakdown-item">
                      <span>Local Revenue</span>
                      <strong>{formatNumber(odRow.localRevenue, 0)}</strong>
                      <span className="breakdown-pct">{formatPct(odRow.localRevenuePct, 1)}</span>
                    </div>
                    <div className="breakdown-item">
                      <span>Flow Revenue</span>
                      <strong>{formatNumber(odRow.flowRevenue, 0)}</strong>
                      <span className="breakdown-pct">{formatPct(odRow.flowRevenuePct, 1)}</span>
                    </div>
                    <SplitBar localPct={odRow.localRevenuePct} flowPct={odRow.flowRevenuePct} />
                  </div>
                ) : <div className="empty-state">No demand data available.</div>}
              </div>
              <div className="chart-card">
                <div className="chart-head"><h3>Direct vs Connecting</h3><p>Traffic split by itinerary type</p></div>
                <PieChart slices={[{ label: "Direct", value: directTraffic }, { label: "Connecting", value: connectingTraffic }]} size={160} />
                <div className="breakdown-list" style={{ marginTop: "12px" }}>
                  <div className="breakdown-item"><span>Direct</span><strong>{formatNumber(directTraffic, 1)}</strong></div>
                  <div className="breakdown-item"><span>Connecting</span><strong>{formatNumber(connectingTraffic, 1)}</strong></div>
                </div>
              </div>
            </div>

            <div className="od-table-section">
              <div className="od-table-section-head">
                <h4>Market Summary by Airline</h4>
                <p>Aggregated demand, traffic &amp; revenue share per carrier</p>
              </div>
              <div className="od-table-scroll">
                <table className="od-data-table">
                  <thead>
                    <tr>
                      <th>Market</th><th>Airline</th><th>Num NStps</th><th>Num Thrus</th><th>Num Cncts</th>
                      <th>Market Size</th><th>Total Demand</th><th>Total Op Demand</th><th>Total NonOp Demand</th><th>Demand Share (%)</th>
                      <th>Total Traffic</th><th>Total Op Traffic</th><th>Total NonOp Traffic</th><th>Traffic Share (%)</th>
                      <th>Pax Revenue($)</th><th>Total Op Revenue($)</th><th>Total NonOp Revenue($)</th><th>Revenue Share (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketSummaryRows.length === 0 ? (
                      <tr><td colSpan={18} className="od-table-empty">No data available.</td></tr>
                    ) : marketSummaryRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.market}</td>
                        <td><strong>{r.aln}</strong></td>
                        <td>{r.nstps}</td>
                        <td>{r.thrus}</td>
                        <td>{r.cncts}</td>
                        <td>{formatNumber(r.marketSize, 1)}</td>
                        <td>{formatNumber(r.demand, 1)}</td>
                        <td>{formatNumber(r.opDemand, 1)}</td>
                        <td>{formatNumber(r.nonopDemand, 1)}</td>
                        <td>{formatPct(r.demandShare, 2)}</td>
                        <td>{formatNumber(r.traffic, 1)}</td>
                        <td>{formatNumber(r.opTraffic, 1)}</td>
                        <td>{formatNumber(r.nonopTraffic, 1)}</td>
                        <td>{formatPct(r.trafficShare, 2)}</td>
                        <td>{formatNumber(r.revenue, 0)}</td>
                        <td>{formatNumber(r.opRevenue, 0)}</td>
                        <td>{formatNumber(r.nonopRevenue, 0)}</td>
                        <td>{formatPct(r.revenueShare, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="od-table-section">
              <div className="od-table-section-head">
                <h4>Itinerary Report</h4>
                <p>All itineraries for this OD including connections</p>
              </div>
              <div className="od-table-scroll">
                <table className="od-data-table">
                  <thead>
                    <tr>
                      <th>Dept Arp</th><th>Arvl Arp</th><th>Flt Desg (Seg1)</th>
                      <th>Connect Point 1</th><th>Min Connect 1</th><th>Connect Time 1</th>
                      <th>Flt Desg (Seg2)</th><th>Connect Point 2</th><th>Min Connect 2</th><th>Connect Time 2</th>
                      <th>Flt Desg (Seg3)</th><th>Stops</th><th>Segs</th><th>Freq</th>
                      <th>Dept Time</th><th>Arvl Time</th><th>Elap Time</th>
                      <th>Total Demand</th><th>Total Traffic</th><th>Pax Revenue($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itineraryRows.length === 0 ? (
                      <tr><td colSpan={20} className="od-table-empty">No itinerary data available.</td></tr>
                    ) : itineraryRows.map((r, i) => (
                      <tr key={i} className={Number(r["Stops"] || 0) > 0 ? "itin-connecting" : ""}>
                        <td>{r["Dept Arp"]}</td>
                        <td>{r["Arvl Arp"]}</td>
                        <td><strong>{r["Flt Desg (Seg1)"]}</strong></td>
                        <td>{r["Connect Point 1"] === "*" ? "-" : r["Connect Point 1"]}</td>
                        <td>{r["Minimum Connect Time 1"] || "-"}</td>
                        <td>{r["Connect Time 1"] || "-"}</td>
                        <td>{r["Flt Desg (Seg2)"] === "*" ? "-" : r["Flt Desg (Seg2)"]}</td>
                        <td>{r["Connect Point 2"] === "*" ? "-" : (r["Connect Point 2"] || "-")}</td>
                        <td>{r["Minimum Connect Time 2"] || "-"}</td>
                        <td>{r["Connect Time 2"] || "-"}</td>
                        <td>{r["Flt Desg (Seg3)"] === "*" ? "-" : (r["Flt Desg (Seg3)"] || "-")}</td>
                        <td>{r["Stops"]}</td>
                        <td>{r["Segs"]}</td>
                        <td>{r["Freq"]}</td>
                        <td>{r["Dept Time"]}</td>
                        <td>{r["Arvl Time"]}</td>
                        <td>{r["Elap Time"]}</td>
                        <td>{formatNumber(r["Total Demand"], 1)}</td>
                        <td>{formatNumber(r["Total Traffic"], 1)}</td>
                        <td>{formatNumber(r["Pax Revenue($)"], 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default function AppSimple() {
  const [activeTab, setActiveTab] = useState("summary");
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 1024 : false));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedOd, setSelectedOd] = useState("");
  const [flightReportRows, setFlightReportRows] = useState([]);
  const [itineraryRows, setItineraryRows] = useState([]);
  const [reportStatus, setReportStatus] = useState("loading");
  const [networkClickedOd, setNetworkClickedOd] = useState(null);
  const [odDetailFlightRows, setOdDetailFlightRows] = useState([]);
  const [odDetailItineraryRows, setOdDetailItineraryRows] = useState([]);
  const [odDetailStatus, setOdDetailStatus] = useState("idle");
  const [odQsiOpen, setOdQsiOpen] = useState(false);
  const [networkOrigFilter, setNetworkOrigFilter] = useState("");
  const [networkDestFilter, setNetworkDestFilter] = useState("");

  // Flight View state
  const [fvOrig, setFvOrig] = useState("");
  const [fvDest, setFvDest] = useState("");
  const [fvAirlineFilter, setFvAirlineFilter] = useState("all");
  const [selectedFlightKey, setSelectedFlightKey] = useState(null);
  const [fvCompFlightRows, setFvCompFlightRows] = useState([]);

  // Workset state
  const defaultWorksetId = initialBundle?.profile?.workset || "";
  const [bundle, setBundle] = useState(initialBundle);
  const [worksets, setWorksets] = useState(defaultWorksetId ? [{ id: defaultWorksetId, label: defaultWorksetId }] : []);
  const [worksetId, setWorksetId] = useState(defaultWorksetId);
  const [worksetLoading, setWorksetLoading] = useState(false);
  const [sqliteDb, setSqliteDb] = useState(null);
  const [allWorksetFlightRows, setAllWorksetFlightRows] = useState([]);

  // Load worksets index once
  useEffect(() => {
    fetchJson("/data/worksets/index.json")
      .then((data) => {
        if (!Array.isArray(data) || !data.length) return;
        setWorksets(data);
        setWorksetId((prev) => (prev && data.some((w) => w.id === prev) ? prev : data[0].id));
      })
      .catch(() => { /* keep default */ });
  }, []);

  useEffect(() => {
    let active = true;
    let dbInstance = null;

    Promise.all([
      initSqlJs({ locateFile: () => sqlWasmUrl }),
      fetch("/data/worksets/dashboard.sqlite").then((response) => {
        if (!response.ok) throw new Error("Failed to load dashboard.sqlite");
        return response.arrayBuffer();
      }),
    ])
      .then(([SQL, buffer]) => {
        dbInstance = new SQL.Database(new Uint8Array(buffer));
        if (active) setSqliteDb(dbInstance);
      })
      .catch(() => {
        if (active) setSqliteDb(null);
      });

    return () => {
      active = false;
      if (dbInstance) dbInstance.close();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      const mobile = window.innerWidth <= 1024;
      setIsMobile(mobile);
      if (!mobile) setMobileSidebarOpen(false);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // When workset changes, load bundle
  useEffect(() => {
    if (!worksetId) return;
    if (worksetId === defaultWorksetId && initialBundle?.profile?.workset) {
      setBundle(initialBundle);
    } else {
      setWorksetLoading(true);
      fetchJson(`/data/worksets/${worksetId}/bundle.json`)
        .then((data) => { setBundle(data); setWorksetLoading(false); })
        .catch(() => setWorksetLoading(false));
    }
  }, [worksetId]);

  useEffect(() => {
    setFvOrig("");
    setFvDest("");
    setFvAirlineFilter("all");
    setSelectedFlightKey(null);
    setFvCompFlightRows([]);
    setNetworkOrigFilter("");
    setNetworkDestFilter("");
    setNetworkClickedOd(null);
  }, [worksetId]);

  useEffect(() => {
    if (!worksetId || !sqliteDb) {
      setAllWorksetFlightRows([]);
      return;
    }
    try {
      const rows = queryRowsFromSqlite(
        sqliteDb,
        "SELECT row_json FROM flight_report WHERE workset_id = ?",
        [worksetId],
      );
      setAllWorksetFlightRows(rows);
    } catch {
      setAllWorksetFlightRows([]);
    }
  }, [sqliteDb, worksetId]);

  const dataBasePath = `/data/worksets/${worksetId}`;


  const odOptions = useMemo(() => {
    return (bundle?.level1_host_od_summary || []).map((row) => `${row.orig}-${row.dest}`);
  }, [bundle]);

  useEffect(() => {
    if (!odOptions.length) {
      if (selectedOd) setSelectedOd("");
      return;
    }
    if (!selectedOd || !odOptions.includes(selectedOd)) {
      setSelectedOd(odOptions[0]);
    }
  }, [odOptions, selectedOd]);

  const hostAirline = bundle?.profile?.host_airline || "";
  const hostWorksetFlightRows = useMemo(
    () => (allWorksetFlightRows || []).filter((r) => parseFlightDesign(r["Flt Desg"]).airline === normalizeCode(hostAirline)),
    [allWorksetFlightRows, hostAirline],
  );

  const odNetworkRows = useMemo(() => {
    const level1ByOd = new Map(
      (bundle?.level1_host_od_summary || []).map((row) => [`${row.orig}-${row.dest}`, row]),
    );
    const level2ByOd = new Map();
    for (const r of bundle?.level2_od_airline_share_summary || []) {
      const od = `${r.orig}-${r.dest}`;
      const traffic = Number(r.total_traffic_est || 0);
      const avgElapsed = Number(r.avg_elapsed_minutes || 0);
      const item = level2ByOd.get(od) || {
        marketElapsedWeighted: 0,
        marketTraffic: 0,
        hostElapsedWeighted: 0,
        hostTraffic: 0,
        hostTrafficSharePct: 0,
        hostDemandSharePct: 0,
      };
      item.marketElapsedWeighted += avgElapsed * traffic;
      item.marketTraffic += traffic;
      if (Boolean(r.is_host_airline)) {
        item.hostElapsedWeighted += avgElapsed * traffic;
        item.hostTraffic += traffic;
        item.hostTrafficSharePct = Number(r.traffic_share_pct_est || 0);
        item.hostDemandSharePct = Number(r.demand_share_pct_est || 0);
      }
      level2ByOd.set(od, item);
    }
    const grouped = new Map();
    const competitorByOd = new Map();
    for (const row of allWorksetFlightRows || []) {
      const parsed = parseFlightDesign(row["Flt Desg"]);
      if (!parsed.airline || parsed.airline === normalizeCode(hostAirline)) continue;
      const orig = normalizeCode(row["Dept Sta"]);
      const dest = normalizeCode(row["Arvl Sta"]);
      const key = `${orig}-${dest}`;
      const compTotalPax = Number(row["Total Traffic"] || 0);
      const compLocalPax = Number(row["Lcl Traffic"] || 0);
      const compFlowPax = Math.max(0, compTotalPax - compLocalPax);
      const compTotalDemand = Number(row["Total Demand"] || compTotalPax || 0);
      const compLocalDemandDirect = Number(row["Lcl Demand"] || 0);
      const compLocalDemandMktd = Number(row["Lcl Demand (Mktd)"] || 0);
      const compLocalDemandCodeshared = Number(row["Lcl Demand (Codeshared)"] || 0);
      const compLocalDemandCombined = compLocalDemandMktd + compLocalDemandCodeshared;
      const compLocalDemand = compLocalDemandDirect > 0
        ? compLocalDemandDirect
        : (compLocalDemandCombined > 0 ? compLocalDemandCombined : Math.min(compTotalDemand, compLocalPax));
      const compFlowDemand = Math.max(0, compTotalDemand - compLocalDemand);
      const current = competitorByOd.get(key) || {
        compLocalPax: 0,
        compFlowPax: 0,
        compTotalPax: 0,
        compLocalDemand: 0,
        compFlowDemand: 0,
        compTotalDemand: 0,
      };
      current.compLocalPax += compLocalPax;
      current.compFlowPax += compFlowPax;
      current.compTotalPax += compTotalPax;
      current.compLocalDemand += compLocalDemand;
      current.compFlowDemand += compFlowDemand;
      current.compTotalDemand += compTotalDemand;
      competitorByOd.set(key, current);
    }
    if (hostWorksetFlightRows.length) {
      for (const row of hostWorksetFlightRows) {
        const orig = normalizeCode(row["Dept Sta"]);
        const dest = normalizeCode(row["Arvl Sta"]);
        const key = `${orig}-${dest}`;
        const totalPax = Number(row["Total Traffic"] || 0);
        const localPax = Number(row["Lcl Traffic"] || 0);
        const flowPax = Math.max(0, totalPax - localPax);
        const totalDemand = Number(row["Total Demand"] || totalPax || 0);
        const localDemandDirect = Number(row["Lcl Demand"] || 0);
        const localDemandMktd = Number(row["Lcl Demand (Mktd)"] || 0);
        const localDemandCodeshared = Number(row["Lcl Demand (Codeshared)"] || 0);
        const localDemandCombined = localDemandMktd + localDemandCodeshared;
        const localDemand = localDemandDirect > 0
          ? localDemandDirect
          : (localDemandCombined > 0 ? localDemandCombined : Math.min(totalDemand, localPax));
        const flowDemand = Math.max(0, totalDemand - localDemand);
        const totalRevenue = Number(row["Total Revenue($)"] || row["Pax Revenue($)"] || 0);
        const localRevenue = totalPax > 0 ? (localPax / totalPax) * totalRevenue : 0;
        const flowRevenue = Math.max(0, totalRevenue - localRevenue);
        const current = grouped.get(key) || {
          od: key,
          orig,
          dest,
          flights: 0,
          weeklyDepartures: 0,
          localPax: 0,
          flowPax: 0,
          totalPax: 0,
          localDemand: 0,
          flowDemand: 0,
          totalDemand: 0,
          localRevenue: 0,
          flowRevenue: 0,
          totalRevenue: 0,
          weeklySeats: 0,
        };
        current.flights += 1;
        current.weeklyDepartures += countFreqDays(row["Freq"]);
        current.localPax += localPax;
        current.flowPax += flowPax;
        current.totalPax += totalPax;
        current.localDemand += localDemand;
        current.flowDemand += flowDemand;
        current.totalDemand += totalDemand;
        current.localRevenue += localRevenue;
        current.flowRevenue += flowRevenue;
        current.totalRevenue += totalRevenue;
        current.weeklySeats += Number(row["Seats"] || 0);
        grouped.set(key, current);
      }
    } else {
      for (const row of bundle?.level3_host_flight_summary || []) {
      const key = `${row.orig}-${row.dest}`;
      const current = grouped.get(key) || {
        od: key,
        orig: row.orig,
        dest: row.dest,
        flights: 0,
        weeklyDepartures: 0,
        localPax: 0,
        flowPax: 0,
        totalPax: 0,
        localDemand: 0,
        flowDemand: 0,
        totalDemand: 0,
        localRevenue: 0,
        flowRevenue: 0,
        totalRevenue: 0,
      };
      current.flights += 1;
      current.weeklyDepartures += Number(row.weekly_departures || 0);
      current.localPax += Number(row.spill_local_pax_est || 0);
      current.flowPax += Number(row.spill_flow_pax_est || 0);
      current.totalPax += Number(row.weekly_pax_est || row.spill_total_pax_est || 0);
      current.localDemand += Number(row.spill_local_pax_est || 0);
      current.flowDemand += Number(row.spill_flow_pax_est || 0);
      current.totalDemand += Number(row.weekly_pax_est || row.spill_total_pax_est || 0);
      current.localRevenue += Number(row.spill_local_revenue_est || 0);
      current.flowRevenue += Number(row.spill_flow_revenue_est || 0);
      current.totalRevenue += Number(row.spill_total_revenue_est || 0);
      grouped.set(key, current);
    }
    }
    const rows = [...grouped.values()].map((row) => {
      const level1 = level1ByOd.get(row.od);
      const level2 = level2ByOd.get(row.od);
      const comp = competitorByOd.get(row.od) || {
        compLocalPax: 0,
        compFlowPax: 0,
        compTotalPax: 0,
        compLocalDemand: 0,
        compFlowDemand: 0,
        compTotalDemand: 0,
      };
      const marketElapsed = level2?.marketTraffic ? level2.marketElapsedWeighted / level2.marketTraffic : 0;
      const hostElapsed = level2?.hostTraffic ? level2.hostElapsedWeighted / level2.hostTraffic : 0;
      const elapsedTimeDeltaPct = marketElapsed > 0 ? ((hostElapsed - marketElapsed) / marketElapsed) * 100 : 0;
      const demandDenominator = (row.localDemand + row.flowDemand) || row.totalDemand || 1;
      const revDenominator = row.totalRevenue || row.localRevenue + row.flowRevenue || 1;
      return {
        ...row,
        ...comp,
        weeklyPax: Number(row.totalPax || 0),
        weeklySeats: Number(row.weeklySeats || level1?.weekly_seats_est || 0),
        loadFactorPct:
          Number(row.weeklySeats || level1?.weekly_seats_est || 0) > 0
            ? (Number(row.totalPax || 0) / Number(row.weeklySeats || level1?.weekly_seats_est || 0)) * 100
            : 0,
        absPaxDiffPct: Number(level1?.abs_total_pax_diff_pct_est || 0),
        absPlfDiffPct: Number(level1?.abs_plf_diff_pct_est || 0),
        flowPddPct: Number(level1?.flow_pdd_pct_est || 0),
        flowApmPct: Number(level1?.flow_apm_pct_est || 0),
        hostSharePct: Number(level2?.hostTrafficSharePct || level1?.host_share_of_market_demand_pct_est || 0),
        predictedMarketSharePct: Number(level2?.hostTrafficSharePct || level1?.host_share_of_market_demand_pct_est || 0),
        actualMarketSharePct: Number(level2?.hostDemandSharePct || level2?.hostTrafficSharePct || 0),
        elapsedTimeDeltaPct,
        localDemandPct: (row.localDemand / demandDenominator) * 100,
        flowDemandPct: (row.flowDemand / demandDenominator) * 100,
        localRevenuePct: (row.localRevenue / revDenominator) * 100,
        flowRevenuePct: (row.flowRevenue / revDenominator) * 100,
      };
    });
    rows.sort((left, right) => right.totalRevenue - left.totalRevenue);
    return rows;
  }, [bundle, hostWorksetFlightRows, hostAirline, allWorksetFlightRows]);

  const hostPax = odNetworkRows.reduce((sum, row) => sum + Number(row.weeklyPax || row.totalPax || 0), 0);
  const hostSeats = odNetworkRows.reduce((sum, row) => sum + Number(row.weeklySeats || 0), 0);
  const avgLoadFactor = hostSeats ? (hostPax / hostSeats) * 100 : 0;

  const networkOrigOptions = useMemo(() => {
    const items = networkDestFilter
      ? odNetworkRows.filter((r) => normalizeCode(r.dest) === networkDestFilter)
      : odNetworkRows;
    return [...new Set(items.map((r) => normalizeCode(r.orig)))].sort();
  }, [odNetworkRows, networkDestFilter]);

  const networkDestOptions = useMemo(() => {
    const items = networkOrigFilter
      ? odNetworkRows.filter((r) => normalizeCode(r.orig) === networkOrigFilter)
      : odNetworkRows;
    return [...new Set(items.map((r) => normalizeCode(r.dest)))].sort();
  }, [odNetworkRows, networkOrigFilter]);

  useEffect(() => {
    if (networkOrigFilter && !networkOrigOptions.includes(networkOrigFilter)) setNetworkOrigFilter("");
  }, [networkOrigFilter, networkOrigOptions]);

  useEffect(() => {
    if (networkDestFilter && !networkDestOptions.includes(networkDestFilter)) setNetworkDestFilter("");
  }, [networkDestFilter, networkDestOptions]);

  const odNetworkRowsFiltered = useMemo(
    () =>
      odNetworkRows.filter(
        (r) =>
          (!networkOrigFilter || normalizeCode(r.orig) === networkOrigFilter) &&
          (!networkDestFilter || normalizeCode(r.dest) === networkDestFilter),
      ),
    [odNetworkRows, networkOrigFilter, networkDestFilter],
  );

  const networkNumericScales = useMemo(() => {
    const keys = [
      "weeklyDepartures",
      "localPax",
      "flowPax",
      "compLocalPax",
      "compFlowPax",
      "localDemand",
      "flowDemand",
      "absPaxDiffPct",
      "absPlfDiffPct",
    ];
    const scales = {};
    for (const key of keys) {
      const values = odNetworkRowsFiltered
        .map((row) => Number(row[key]))
        .filter((value) => Number.isFinite(value));
      const max = values.length ? maxAbsFinite(values) : 0;
      scales[key] = { max };
    }
    return scales;
  }, [odNetworkRowsFiltered]);

  const renderNetworkNumericCell = (value, key, digits = 1, isPct = false) => {
    const num = Number(value || 0);
    const max = Number(networkNumericScales[key]?.max || 0);
    const intensity = max > 0 ? Math.min(1, Math.abs(num) / max) : 0;
    return (
      <span className="fv-num-chip" style={{ "--fv-heat": intensity }}>
        {isPct ? formatPct(num, digits) : formatNumber(num, digits)}
      </span>
    );
  };

  const totalLocalPax = odNetworkRowsFiltered.reduce((sum, row) => sum + row.localPax, 0);
  const totalFlowPax = odNetworkRowsFiltered.reduce((sum, row) => sum + row.flowPax, 0);
  const totalLocalRevenue = odNetworkRowsFiltered.reduce((sum, row) => sum + row.localRevenue, 0);
  const totalFlowRevenue = odNetworkRowsFiltered.reduce((sum, row) => sum + row.flowRevenue, 0);

  useEffect(() => {
    if (!selectedOd) {
      setFlightReportRows([]);
      setItineraryRows([]);
      setReportStatus("ready");
      return;
    }
    let cancelled = false;
    setReportStatus("loading");
    if (sqliteDb) {
      try {
        const flightRowsData = queryRowsFromSqlite(
          sqliteDb,
          "SELECT row_json FROM flight_report WHERE workset_id = ? AND od = ?",
          [worksetId, selectedOd],
        );
        const itineraryRowsData = queryRowsFromSqlite(
          sqliteDb,
          "SELECT row_json FROM itinerary_report WHERE workset_id = ? AND od = ?",
          [worksetId, selectedOd],
        );
        if (!cancelled) {
          setFlightReportRows(flightRowsData);
          setItineraryRows(itineraryRowsData);
          setReportStatus("ready");
        }
      } catch {
        if (!cancelled) setReportStatus("ready");
      }
    } else {
      Promise.all([
        fetchJson(`${dataBasePath}/flight-report-db/${selectedOd}.json`).catch(() => []),
        fetchJson(`${dataBasePath}/itinerary-report-db/${selectedOd}.json`).catch(() => []),
      ]).then(([flightRowsData, itineraryRowsData]) => {
        if (!cancelled) {
          setFlightReportRows(flightRowsData);
          setItineraryRows(itineraryRowsData);
          setReportStatus("ready");
        }
      });
    }
    return () => { cancelled = true; };
  }, [selectedOd, dataBasePath, sqliteDb, worksetId]);

  useEffect(() => {
    if (!networkClickedOd) return;
    let cancelled = false;
    setOdDetailStatus("loading");
    setOdDetailFlightRows([]);
    setOdDetailItineraryRows([]);
    if (sqliteDb) {
      try {
        const flightData = queryRowsFromSqlite(
          sqliteDb,
          "SELECT row_json FROM flight_report WHERE workset_id = ? AND od = ?",
          [worksetId, networkClickedOd],
        );
        const itineraryData = queryRowsFromSqlite(
          sqliteDb,
          "SELECT row_json FROM itinerary_report WHERE workset_id = ? AND od = ?",
          [worksetId, networkClickedOd],
        );
        if (!cancelled) {
          setOdDetailFlightRows(flightData);
          setOdDetailItineraryRows(itineraryData);
          setOdDetailStatus("ready");
        }
      } catch {
        if (!cancelled) setOdDetailStatus("ready");
      }
    } else {
      Promise.all([
        fetchJson(`${dataBasePath}/flight-report-db/${networkClickedOd}.json`).catch(() => []),
        fetchJson(`${dataBasePath}/itinerary-report-db/${networkClickedOd}.json`).catch(() => []),
      ]).then(([flightData, itineraryData]) => {
        if (!cancelled) {
          setOdDetailFlightRows(flightData);
          setOdDetailItineraryRows(itineraryData);
          setOdDetailStatus("ready");
        }
      });
    }
    return () => { cancelled = true; };
  }, [networkClickedOd, dataBasePath, sqliteDb, worksetId]);

  const networkClickedOdRow = networkClickedOd
    ? (odNetworkRows.find((r) => r.od === networkClickedOd) || null)
    : null;

  // Load competitor flights for Flight View when origin+dest both selected
  useEffect(() => {
    if (!fvOrig || !fvDest) { setFvCompFlightRows([]); return; }
    const od = `${fvOrig}-${fvDest}`;
    let cancelled = false;
    if (sqliteDb) {
      try {
        const data = queryRowsFromSqlite(
          sqliteDb,
          "SELECT row_json FROM flight_report WHERE workset_id = ? AND od = ?",
          [worksetId, od],
        );
        if (!cancelled) setFvCompFlightRows(data);
      } catch {
        if (!cancelled) setFvCompFlightRows([]);
      }
    } else {
      fetchJson(`${dataBasePath}/flight-report-db/${od}.json`)
        .then((data) => { if (!cancelled) setFvCompFlightRows(data); })
        .catch(() => { if (!cancelled) setFvCompFlightRows([]); });
    }
    return () => { cancelled = true; };
  }, [fvOrig, fvDest, dataBasePath, sqliteDb, worksetId]);

  const fvRoutePairs = useMemo(
    () => (bundle?.level3_host_flight_summary || []).map((r) => ({ orig: normalizeCode(r.orig), dest: normalizeCode(r.dest) })),
    [bundle],
  );

  // Flight View: origins filtered by selected destination (bidirectional filtering)
  const fvOrigOptions = useMemo(() => {
    const origins = fvDest
      ? [...new Set(fvRoutePairs.filter((r) => r.dest === fvDest).map((r) => r.orig))]
      : [...new Set(fvRoutePairs.map((r) => r.orig))];
    return origins.sort();
  }, [fvRoutePairs, fvDest]);

  // Flight View: destinations filtered by selected origin (bidirectional filtering)
  const fvDestOptions = useMemo(() => {
    const dests = fvOrig
      ? [...new Set(fvRoutePairs.filter((r) => r.orig === fvOrig).map((r) => r.dest))]
      : [...new Set(fvRoutePairs.map((r) => r.dest))];
    return dests.sort();
  }, [fvRoutePairs, fvOrig]);

  useEffect(() => {
    if (fvOrig && !fvOrigOptions.includes(fvOrig)) setFvOrig("");
  }, [fvOrig, fvOrigOptions]);

  useEffect(() => {
    if (fvDest && !fvDestOptions.includes(fvDest)) setFvDest("");
  }, [fvDest, fvDestOptions]);

  // Flight View: host flights (from bundle, filtered)
  const fvHostFlights = useMemo(() => {
    if (hostWorksetFlightRows.length) {
      return dedupeBy(
        hostWorksetFlightRows
          .filter((r) => {
            const orig = normalizeCode(r["Dept Sta"]);
            const dest = normalizeCode(r["Arvl Sta"]);
            return (!fvOrig || orig === fvOrig) && (!fvDest || dest === fvDest);
          })
          .map((r) => {
            const parsed = parseFlightDesign(r["Flt Desg"]);
            const orig = normalizeCode(r["Dept Sta"]);
            const dest = normalizeCode(r["Arvl Sta"]);
            const weeklyDeps = countFreqDays(r["Freq"]);
            const weeklySeats = Number(r["Seats"] || 0);
            const seatsPerDep = weeklyDeps > 0 ? (weeklySeats / weeklyDeps) : weeklySeats;
            const observedPax = Number(r["Total Traffic"] || 0);
            const localPax = Number(r["Lcl Traffic"] || 0);
            const flowPax = Math.max(0, observedPax - localPax);
            const totalDemand = Number(r["Total Demand"] || observedPax || 0);
            const localDemandDirect = Number(r["Lcl Demand"] || 0);
            const localDemandMktd = Number(r["Lcl Demand (Mktd)"] || 0);
            const localDemandCodeshared = Number(r["Lcl Demand (Codeshared)"] || 0);
            const localDemandCombined = localDemandMktd + localDemandCodeshared;
            const localDemand = localDemandDirect > 0
              ? localDemandDirect
              : (localDemandCombined > 0 ? localDemandCombined : Math.min(totalDemand, localPax));
            const flowDemand = Math.max(0, totalDemand - localDemand);
            const revenue = Number(r["Total Revenue($)"] || r["Pax Revenue($)"] || 0);
            const loadFactorRaw = Number(r["Load Factor (%)"] || 0);
            const loadFactor = loadFactorRaw > 0 ? loadFactorRaw : (weeklySeats > 0 ? (observedPax / weeklySeats) * 100 : 0);
            return {
              isHost: true,
              key: `${normalizeCode(hostAirline)}-${parsed.flightNumber}-${orig}-${dest}`,
              airline: hostAirline,
              flightNumber: parsed.flightNumber,
              orig,
              dest,
              freq: r["Freq"],
              weeklyDeps,
              equipment: r["Subfleet"],
              seatsPerDep,
              deptTime: r["Dept Time"],
              arvlTime: r["Arvl Time"],
              elapTime: r["Elap Time"],
              observedPax,
              totalDemand,
              localDemand,
              flowDemand,
              totalPax: observedPax,
              localPax,
              flowPax,
              loadFactor,
              weeklySeats,
              revenue,
              avgFare: observedPax > 0 ? revenue / observedPax : null,
            };
          }),
        (r) => r.key,
      );
    }

    return dedupeBy((bundle?.level3_host_flight_summary || [])
      .filter((r) => {
        const orig = normalizeCode(r.orig);
        const dest = normalizeCode(r.dest);
        return (!fvOrig || orig === fvOrig) && (!fvDest || dest === fvDest);
      })
      .map((r) => {
        const weeklyDeps = Number(r.weekly_departures || 0);
        const weeklySeats = Number(r.weekly_seats_est || 0);
        const seatsPerDep = weeklyDeps > 0 ? (weeklySeats / weeklyDeps) : Number(r.avg_seats_per_departure || 0);
        const observedPax = Number(r.weekly_pax_est || r.spill_total_pax_est || 0);
        const totalDemand = Number(r.weekly_demand_est || r.spill_total_pax_est || r.weekly_pax_est || 0);
        const localDemand = Number(r.spill_local_pax_est || 0);
        const flowDemand = Math.max(0, Number(r.spill_flow_pax_est || 0));
        const lfFromObserved = weeklySeats > 0 ? (observedPax / weeklySeats) * 100 : 0;
        return {
          isHost: true,
          key: `${hostAirline}-${r.flight_number}-${r.orig}-${r.dest}`,
          airline: hostAirline,
          flightNumber: r.flight_number,
          orig: normalizeCode(r.orig), dest: normalizeCode(r.dest),
          freq: null,
          weeklyDeps,
          equipment: r.equipment,
          seatsPerDep,
          deptTime: null, arvlTime: null, elapTime: null,
          observedPax,
          totalDemand,
          localDemand,
          flowDemand,
          totalPax: r.weekly_pax_est || r.spill_total_pax_est,
          localPax: r.spill_local_pax_est,
          flowPax: r.spill_flow_pax_est,
          loadFactor: lfFromObserved,
          weeklySeats,
          revenue: r.spill_total_revenue_est,
          avgFare: r.spill_avg_total_fare_est,
        };
      }), (r) => r.key);
  }, [bundle, fvOrig, fvDest, hostAirline, hostWorksetFlightRows]);

  // Flight View: competitor flights (from fetched data for selected OD)
  const fvCompFlights = useMemo(() => {
    // Guardrail: only materialize competitor universe for a selected OD pair to keep UI responsive.
    if (!fvOrig || !fvDest) return [];
    const sourceRows = allWorksetFlightRows.length ? allWorksetFlightRows : fvCompFlightRows;
    return dedupeBy(sourceRows
      .filter((r) => {
        const parsed = parseFlightDesign(r["Flt Desg"]);
        if (!parsed.airline || parsed.airline === normalizeCode(hostAirline)) return false;
        const orig = normalizeCode(r["Dept Sta"]);
        const dest = normalizeCode(r["Arvl Sta"]);
        return (!fvOrig || orig === fvOrig) && (!fvDest || dest === fvDest);
      })
      .map((r) => {
        const parsed = parseFlightDesign(r["Flt Desg"]);
        const orig = normalizeCode(r["Dept Sta"]);
        const dest = normalizeCode(r["Arvl Sta"]);
        const weeklyDeps = countFreqDays(r["Freq"]);
        const weeklySeats = Number(r["Seats"] || 0);
        const seatsPerDep = weeklyDeps > 0 ? (weeklySeats / weeklyDeps) : weeklySeats;
        const observedPax = Number(r["Total Traffic"] || 0);
        const totalDemand = Number(r["Total Demand"] || observedPax || 0);
        const localDemandDirect = Number(r["Lcl Demand"] || 0);
        const localDemandMktd = Number(r["Lcl Demand (Mktd)"] || 0);
        const localDemandCodeshared = Number(r["Lcl Demand (Codeshared)"] || 0);
        const localDemandCombined = localDemandMktd + localDemandCodeshared;
        const localDemand = localDemandDirect > 0
          ? localDemandDirect
          : (localDemandCombined > 0 ? localDemandCombined : Math.min(totalDemand, observedPax));
        const flowDemand = Math.max(0, totalDemand - localDemand);
        const loadFactor = weeklySeats > 0 ? (observedPax / weeklySeats) * 100 : 0;
        return {
          isHost: false,
          key: `comp-${normalizeCode(parsed.airline)}-${parsed.flightNumber}-${orig}-${dest}`,
          airline: parsed.airline,
          flightNumber: parsed.flightNumber,
          orig,
          dest,
          freq: r["Freq"],
          weeklyDeps,
          equipment: r["Subfleet"],
          seatsPerDep,
          deptTime: r["Dept Time"], arvlTime: r["Arvl Time"], elapTime: r["Elap Time"],
          observedPax,
          totalDemand,
          localDemand,
          flowDemand,
          totalPax: null, localPax: null, flowPax: null,
          loadFactor,
          weeklySeats,
          revenue: Number(r["Total Revenue($)"] || r["Pax Revenue($)"] || 0),
          avgFare: observedPax > 0 ? Number(r["Total Revenue($)"] || r["Pax Revenue($)"] || 0) / observedPax : null,
        };
      }), (r) => r.key);
  }, [allWorksetFlightRows, fvCompFlightRows, hostAirline, fvOrig, fvDest]);

  // Flight View: combined and filtered
  const fvFilteredFlights = useMemo(() => {
    let result = [];
    if (fvAirlineFilter !== "competitors") result = [...fvHostFlights];
    if (fvAirlineFilter !== "host") result = [...result, ...fvCompFlights];
    result = result.filter((f) => (!fvOrig || f.orig === fvOrig) && (!fvDest || f.dest === fvDest));
    return result.sort((a, b) => {
      if (a.isHost && !b.isHost) return -1;
      if (!a.isHost && b.isHost) return 1;
      return (a.orig + a.dest + a.flightNumber).localeCompare(b.orig + b.dest + b.flightNumber);
    });
  }, [fvHostFlights, fvCompFlights, fvAirlineFilter, fvOrig, fvDest]);

  const MAX_FLIGHT_ROWS = 500;
  const fvDisplayedFlights = useMemo(
    () => fvFilteredFlights.slice(0, MAX_FLIGHT_ROWS),
    [fvFilteredFlights],
  );
  const fvRowsTruncated = fvFilteredFlights.length > MAX_FLIGHT_ROWS;

  const fvHostRows = useMemo(() => fvFilteredFlights.filter((f) => f.isHost), [fvFilteredFlights]);
  const fvCompRows = useMemo(() => fvFilteredFlights.filter((f) => !f.isHost), [fvFilteredFlights]);
  const fvHostLfAvg = useMemo(() => {
    const seats = fvHostRows.reduce((sum, f) => sum + Number(f.weeklySeats || (Number(f.seatsPerDep || 0) * Number(f.weeklyDeps || 0))), 0);
    const pax = fvHostRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
    return seats > 0 ? (pax / seats) * 100 : 0;
  }, [fvHostRows]);

  const fvKpiCards = useMemo(() => {
    const hostFlights = fvHostRows.length;
    const compFlights = fvCompRows.length;
    const hostObservedPax = fvHostRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
    const compObservedPax = fvCompRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
    const hostTotalDemand = fvHostRows.reduce((sum, f) => sum + Number(f.totalDemand || 0), 0);
    const compTotalDemand = fvCompRows.reduce((sum, f) => sum + Number(f.totalDemand || 0), 0);
    const hostLocalDemand = fvHostRows.reduce((sum, f) => sum + Number(f.localDemand || 0), 0);
    const compLocalDemand = fvCompRows.reduce((sum, f) => sum + Number(f.localDemand || 0), 0);
    const hostFlowDemand = fvHostRows.reduce((sum, f) => sum + Number(f.flowDemand || 0), 0);
    const compFlowDemand = fvCompRows.reduce((sum, f) => sum + Number(f.flowDemand || 0), 0);
    const hostRevenue = fvHostRows.reduce((sum, f) => sum + Number(f.revenue || 0), 0);
    const compRevenue = fvCompRows.reduce((sum, f) => sum + Number(f.revenue || 0), 0);
    const compLfAvg = (() => {
      const seats = fvCompRows.reduce((sum, f) => sum + Number(f.weeklySeats || (Number(f.seatsPerDep || 0) * Number(f.weeklyDeps || 0))), 0);
      const pax = fvCompRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
      return seats > 0 ? (pax / seats) * 100 : 0;
    })();
    const hostFareAvg = safeRatio(hostRevenue, hostObservedPax);
    const compFareAvg = safeRatio(compRevenue, compObservedPax);

    return [
      { id: "flights", label: "Flights", host: hostFlights, comp: compFlights, format: (v) => formatNumber(v, 0), accent: false },
      { id: "pax", label: "Observed Pax", host: hostObservedPax, comp: compObservedPax, format: (v) => formatNumber(v, 1), accent: false },
      { id: "total-demand", label: "Total Demand", host: hostTotalDemand, comp: compTotalDemand, format: (v) => formatNumber(v, 1), accent: false },
      { id: "local-demand", label: "Local Demand", host: hostLocalDemand, comp: compLocalDemand, format: (v) => formatNumber(v, 1), accent: false },
      { id: "flow-demand", label: "Flow Demand", host: hostFlowDemand, comp: compFlowDemand, format: (v) => formatNumber(v, 1), accent: false },
      { id: "lf", label: "Avg LF %", host: fvHostLfAvg, comp: compLfAvg, format: (v) => formatPct(v, 1), accent: false },
      { id: "revenue", label: "Revenue", host: hostRevenue, comp: compRevenue, format: (v) => formatNumber(v, 0), accent: true },
      { id: "fare", label: "Avg Fare", host: hostFareAvg, comp: compFareAvg, format: (v) => formatNumber(v, 0), accent: false },
    ];
  }, [fvHostRows, fvCompRows, fvHostLfAvg]);

  const fvNumericScales = useMemo(() => {
    const keys = [
      "seatsPerDep",
      "observedPax",
      "totalDemand",
      "localDemand",
      "flowDemand",
      "loadFactor",
      "totalPax",
      "localPax",
      "flowPax",
      "revenue",
      "avgFare",
    ];
    const scales = {};
    for (const key of keys) {
      const values = fvFilteredFlights
        .map((row) => Number(row[key]))
        .filter((value) => Number.isFinite(value));
      const max = values.length ? maxAbsFinite(values) : 0;
      scales[key] = { max };
    }
    return scales;
  }, [fvFilteredFlights]);

  const renderFvNumericCell = (value, key, digits = 1, isPct = false, allowNull = false) => {
    if ((value == null || value === "") && allowNull) return "-";
    const num = Number(value || 0);
    const max = Number(fvNumericScales[key]?.max || 0);
    const intensity = max > 0 ? Math.min(1, Math.abs(num) / max) : 0;
    return (
      <span className="fv-num-chip" style={{ "--fv-heat": intensity }}>
        {isPct ? formatPct(num, digits) : formatNumber(num, digits)}
      </span>
    );
  };

  const toggleFvOrig = (orig) => {
    const next = normalizeCode(orig);
    setFvOrig((prev) => (prev === next ? "" : next));
    setSelectedFlightKey(null);
  };

  const toggleFvDest = (dest) => {
    const next = normalizeCode(dest);
    setFvDest((prev) => (prev === next ? "" : next));
    setSelectedFlightKey(null);
  };

  const fvSelectedFlight = selectedFlightKey
    ? (fvFilteredFlights.find((f) => f.key === selectedFlightKey) || null)
    : null;

  // Flow OD rows for the selected host flight
  const fvFlowRows = useMemo(() => {
    if (!fvSelectedFlight?.isHost) return [];
    return (bundle?.flight_spill_breakdown || [])
      .filter((r) => r.flight_number === fvSelectedFlight.flightNumber && r.flight_orig === fvSelectedFlight.orig && r.flight_dest === fvSelectedFlight.dest)
      .filter((r) => Number(r.flow_pax_est || 0) > 0 || Number(r.flow_revenue_est || 0) > 0)
      .map((r) => ({ ...r, label: `${r.flow_orig}-${r.flow_dest}` }))
      .sort((a, b) => Number(b.flow_pax_est || 0) - Number(a.flow_pax_est || 0));
  }, [fvSelectedFlight, bundle]);

  const fvOdDemandBreakupRows = useMemo(() => {
    const grouped = new Map();
    for (const row of fvFilteredFlights) {
      const od = `${normalizeCode(row.orig)}-${normalizeCode(row.dest)}`;
      const current = grouped.get(od) || {
        od,
        orig: normalizeCode(row.orig),
        dest: normalizeCode(row.dest),
        hostTotalDemand: 0,
        hostLocalDemand: 0,
        hostFlowDemand: 0,
        compTotalDemand: 0,
        compLocalDemand: 0,
        compFlowDemand: 0,
      };
      if (row.isHost) {
        current.hostTotalDemand += Number(row.totalDemand || 0);
        current.hostLocalDemand += Number(row.localDemand || 0);
        current.hostFlowDemand += Number(row.flowDemand || 0);
      } else {
        current.compTotalDemand += Number(row.totalDemand || 0);
        current.compLocalDemand += Number(row.localDemand || 0);
        current.compFlowDemand += Number(row.flowDemand || 0);
      }
      grouped.set(od, current);
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        marketTotalDemand: row.hostTotalDemand + row.compTotalDemand,
        marketLocalDemand: row.hostLocalDemand + row.compLocalDemand,
        marketFlowDemand: row.hostFlowDemand + row.compFlowDemand,
      }))
      .sort((a, b) => Number(b.marketTotalDemand || 0) - Number(a.marketTotalDemand || 0));
  }, [fvFilteredFlights]);
  const fvSelectedOdBreakupRows = useMemo(() => {
    if (!fvSelectedFlight) return [];
    const od = `${normalizeCode(fvSelectedFlight.orig)}-${normalizeCode(fvSelectedFlight.dest)}`;
    return fvOdDemandBreakupRows.filter((r) => r.od === od);
  }, [fvSelectedFlight, fvOdDemandBreakupRows]);

  // O&D View: market summary rows
  const odViewMarketRows = useMemo(() => {
    if (selectedOd && fvCompFlightRows.length) {
      const [odOrig, odDest] = String(selectedOd).split("-");
      const rows = fvCompFlightRows.filter(
        (r) => normalizeCode(r["Dept Sta"]) === normalizeCode(odOrig) && normalizeCode(r["Arvl Sta"]) === normalizeCode(odDest),
      );
      const groups = new Map();
      for (const row of rows) {
        const parsed = parseFlightDesign(row["Flt Desg"]);
        const aln = parsed.airline || "?";
        const weeklyDeps = countFreqDays(row["Freq"]);
        const demand = Number(row["Total Demand"] || row["Total Traffic"] || 0);
        const traffic = Number(row["Total Traffic"] || 0);
        const revenue = Number(row["Total Revenue($)"] || row["Pax Revenue($)"] || 0);
        const g = groups.get(aln) || { aln, nstops: 0, cncts: 0, demand: 0, traffic: 0, revenue: 0 };
        g.nstops += weeklyDeps;
        g.demand += demand;
        g.traffic += traffic;
        g.revenue += revenue;
        groups.set(aln, g);
      }
      const result = [...groups.values()].sort((a, b) => b.traffic - a.traffic);
      const mktDemand = result.reduce((s, r) => s + r.demand, 0) || 1;
      const mktTraffic = result.reduce((s, r) => s + r.traffic, 0) || 1;
      const mktRevenue = result.reduce((s, r) => s + r.revenue, 0) || 1;
      return result.map((r) => ({
        ...r,
        demandShare: (r.demand / mktDemand) * 100,
        trafficShare: (r.traffic / mktTraffic) * 100,
        revenueShare: (r.revenue / mktRevenue) * 100,
        avgFare: r.traffic > 0 ? r.revenue / r.traffic : 0,
      }));
    }

    const level2Rows = (bundle?.level2_od_airline_share_summary || [])
      .filter((r) => `${r.orig}-${r.dest}` === selectedOd)
      .map((r) => {
        const traffic = Number(r.total_traffic_est || 0);
        const revenue = Number(r.total_revenue_est || 0);
        const demandProxy = Number(r.total_demand_est || 0) > 0 ? Number(r.total_demand_est || 0) : traffic;
        return {
          aln: String(r.carrier || "").trim() || "?",
          nstops: Number(r.nonstop_itinerary_count || 0),
          cncts: Number(r.single_connect_itinerary_count || 0),
          demand: demandProxy,
          traffic,
          revenue,
          demandShare: Number(r.demand_share_pct_est || r.traffic_share_pct_est || 0),
          trafficShare: Number(r.traffic_share_pct_est || r.demand_share_pct_est || 0),
          revenueShare: Number(r.revenue_share_pct_est || 0),
          avgFare: traffic > 0 ? revenue / traffic : 0,
        };
      })
      .sort((a, b) => b.demand - a.demand);
    if (level2Rows.length) return level2Rows;

    const groups = new Map();
    for (const row of itineraryRows) {
      const aln = String(row["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
      const stops = Number(row["Stops"] || 0);
      const freq = countFreqDays(row["Freq"]);
      const demand = Number(row["Total Demand"] || 0);
      const traffic = Number(row["Total Traffic"] || 0);
      const revenue = Number(row["Pax Revenue($)"] || 0);
      const g = groups.get(aln) || { aln, nstops: 0, cncts: 0, demand: 0, traffic: 0, revenue: 0 };
      if (stops === 0) g.nstops += freq; else g.cncts += freq;
      g.demand += demand;
      g.traffic += traffic;
      g.revenue += revenue;
      groups.set(aln, g);
    }
    const rows = [...groups.values()].sort((a, b) => b.demand - a.demand);
    const mktDemand = rows.reduce((s, r) => s + r.demand, 0) || 1;
    const mktTraffic = rows.reduce((s, r) => s + r.traffic, 0) || 1;
    const mktRevenue = rows.reduce((s, r) => s + r.revenue, 0) || 1;
    return rows.map((r) => ({
      ...r,
      demandShare: (r.demand / mktDemand) * 100,
      trafficShare: (r.traffic / mktTraffic) * 100,
      revenueShare: (r.revenue / mktRevenue) * 100,
      avgFare: r.traffic > 0 ? r.revenue / r.traffic : 0,
    }));
  }, [bundle, itineraryRows, selectedOd, fvCompFlightRows]);

  const odViewHostRow = odViewMarketRows.find((r) => r.aln === hostAirline) || null;
  const odViewMarketSize = odViewMarketRows.reduce((s, r) => s + r.traffic, 0);
  const odViewTotalRevenue = odViewMarketRows.reduce((s, r) => s + r.revenue, 0);
  const odQsiRows = useMemo(() => buildQsiRows(itineraryRows, flightReportRows), [itineraryRows, flightReportRows]);
  const odViewShareBars = useMemo(
    () =>
      odViewMarketRows.slice(0, 8).map((r) => ({
        ...r,
        label: r.aln,
      })),
    [odViewMarketRows],
  );

  const odItineraryMix = useMemo(() => {
    const nonstop = itineraryRows.filter((r) => Number(r["Stops"] || 0) === 0);
    const oneStop = itineraryRows.filter((r) => Number(r["Stops"] || 0) === 1);
    const multiStop = itineraryRows.filter((r) => Number(r["Stops"] || 0) >= 2);
    const demand = (rows) => rows.reduce((s, r) => s + Number(r["Total Demand"] || 0), 0);
    const traffic = (rows) => rows.reduce((s, r) => s + Number(r["Total Traffic"] || 0), 0);
    const revenue = (rows) => rows.reduce((s, r) => s + Number(r["Pax Revenue($)"] || 0), 0);
    return [
      { label: "Nonstop", demand: demand(nonstop), traffic: traffic(nonstop), revenue: revenue(nonstop) },
      { label: "1-Stop", demand: demand(oneStop), traffic: traffic(oneStop), revenue: revenue(oneStop) },
      { label: "2+ Stops", demand: demand(multiStop), traffic: traffic(multiStop), revenue: revenue(multiStop) },
    ];
  }, [itineraryRows]);

  const odConnectivityGraph = useMemo(() => {
    const [orig, dest] = String(selectedOd || "").split("-");
    const edgeMap = new Map();
    const nodes = new Map();
    const addNode = (id, role) => {
      if (!id) return;
      if (!nodes.has(id)) nodes.set(id, { id, role });
    };
    const addEdge = (source, target, weight) => {
      if (!source || !target || source === target) return;
      const key = `${source}->${target}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + Number(weight || 0));
    };

    addNode(orig, "origin");
    addNode(dest, "destination");
    for (const r of itineraryRows) {
      const cp1 = String(r["Connect Point 1"] || "").trim();
      const cp2 = String(r["Connect Point 2"] || "").trim();
      const w = Number(r["Total Traffic"] || 0);
      const c1 = cp1 && cp1 !== "*" ? normalizeCode(cp1) : "";
      const c2 = cp2 && cp2 !== "*" ? normalizeCode(cp2) : "";
      if (!c1) {
        addEdge(orig, dest, w);
        continue;
      }
      addNode(c1, "connect1");
      addEdge(orig, c1, w);
      if (!c2) {
        addEdge(c1, dest, w);
      } else {
        addNode(c2, "connect2");
        addEdge(c1, c2, w);
        addEdge(c2, dest, w);
      }
    }

    const nodeList = [...nodes.values()];
    const edgeList = [...edgeMap.entries()].map(([k, weight]) => {
      const [source, target] = k.split("->");
      return { source, target, weight };
    }).sort((a, b) => b.weight - a.weight).slice(0, 28);

    const byRole = {
      origin: nodeList.filter((n) => n.role === "origin"),
      connect1: nodeList.filter((n) => n.role === "connect1"),
      connect2: nodeList.filter((n) => n.role === "connect2"),
      destination: nodeList.filter((n) => n.role === "destination"),
    };
    const xByRole = { origin: 34, connect1: 150, connect2: 270, destination: 386 };
    const pos = {};
    for (const [role, list] of Object.entries(byRole)) {
      const count = Math.max(1, list.length);
      list.forEach((n, idx) => {
        const y = 28 + ((idx + 1) * (176 / (count + 1)));
        pos[n.id] = { x: xByRole[role], y };
      });
    }
    return { nodes: nodeList, edges: edgeList, pos };
  }, [itineraryRows, selectedOd]);

  return (
    <div className={`app-shell app-shell-vision ${sidebarCollapsed ? "sidebar-hidden" : ""} ${isMobile ? "sidebar-mobile" : ""} ${mobileSidebarOpen ? "sidebar-open" : ""}`}>
      <button
        className="sidebar-toggle-btn"
        onClick={() => {
          if (isMobile) setMobileSidebarOpen((prev) => !prev);
          else setSidebarCollapsed((prev) => !prev);
        }}
        title={isMobile ? (mobileSidebarOpen ? "Close sidebar" : "Open sidebar") : (sidebarCollapsed ? "Show sidebar" : "Hide sidebar")}
        aria-label={isMobile ? (mobileSidebarOpen ? "Close sidebar" : "Open sidebar") : (sidebarCollapsed ? "Show sidebar" : "Hide sidebar")}
      >
        <span />
        <span />
        <span />
      </button>
      <aside className="sidebar">
          <div className="sidebar-brand"><div><div className="eyebrow">NETWORK FORECASTER</div><strong>{hostAirline || "-"}</strong></div></div>
        <div className="sidebar-selectors">
          {worksets.length > 1 ? (
            <div className="selector-wrap">
              <label htmlFor="workset-selector">Workset</label>
              <select id="workset-selector" value={worksetId} onChange={(e) => { setWorksetId(e.target.value); setNetworkClickedOd(null); }}>
                {worksets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </div>
          ) : null}
          <div className="selector-wrap">
            <label htmlFor="od-selector">Selected OD</label>
            <select id="od-selector" value={selectedOd} onChange={(event) => setSelectedOd(event.target.value)}>
              {!odOptions.length ? <option value="">No ODs available</option> : null}
              {odOptions.map((od) => <option key={od} value={od}>{od}</option>)}
            </select>
          </div>
        </div>
        <div className="sidebar-divider" />
              <SidebarKpis
                hostAirline={hostAirline}
                hostPax={hostPax}
                hostSeats={hostSeats}
                avgLoadFactor={activeTab === "flightView" ? fvHostLfAvg : avgLoadFactor}
                totalLocalPax={totalLocalPax}
                totalFlowPax={totalFlowPax}
                totalLocalRevenue={totalLocalRevenue}
                totalFlowRevenue={totalFlowRevenue}
              />
      </aside>
      {isMobile && mobileSidebarOpen ? <div className="sidebar-overlay" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <main className="main-shell">
        <div className="folder-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === activeTab ? "folder-tab active" : "folder-tab"}
              onClick={() => {
                setActiveTab(tab.id);
                if (isMobile) setMobileSidebarOpen(false);
              }}
            >
              <span className="folder-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <section className="panel panel-vision">
          {activeTab === "summary" ? <div className="tab-content">
            {reportStatus === "loading" ? <div className="loading">Loading selected OD report data...</div> : null}
            <div className="network-filter-bar">
              <div className="fv-filter-item">
                <label className="fv-filter-label">Origin</label>
                <select value={networkOrigFilter} className="fv-filter-select" onChange={(e) => setNetworkOrigFilter(normalizeCode(e.target.value))}>
                  <option value="">All Origins</option>
                  {networkOrigOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="fv-filter-item">
                <label className="fv-filter-label">Destination</label>
                <select value={networkDestFilter} className="fv-filter-select" onChange={(e) => setNetworkDestFilter(normalizeCode(e.target.value))}>
                  <option value="">All Destinations</option>
                  {networkDestOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              {(networkOrigFilter || networkDestFilter) ? (
                <button className="fv-clear-btn" onClick={() => { setNetworkOrigFilter(""); setNetworkDestFilter(""); }}>
                  Clear
                </button>
              ) : null}
            </div>
            <Table

              columns={[
                { key: "orig", label: "Origin", render: (value) => <strong>{normalizeCode(value)}</strong> },
                { key: "dest", label: "Destination", render: (value) => <strong>{normalizeCode(value)}</strong> },
                { key: "weeklyDepartures", label: "Wkly Deps", render: (value) => renderNetworkNumericCell(value, "weeklyDepartures", 0) },
                { key: "localPax", label: `${hostAirline} Local Pax`, render: (value) => renderNetworkNumericCell(value, "localPax", 1) },
                { key: "flowPax", label: `${hostAirline} Flow Pax`, render: (value) => renderNetworkNumericCell(value, "flowPax", 1) },
                { key: "compLocalPax", label: "Comp Local Pax", render: (value) => renderNetworkNumericCell(value, "compLocalPax", 1) },
                { key: "compFlowPax", label: "Comp Flow Pax", render: (value) => renderNetworkNumericCell(value, "compFlowPax", 1) },
                { key: "localDemand", label: "Local Demand", render: (value) => renderNetworkNumericCell(value, "localDemand", 1) },
                { key: "flowDemand", label: "Flow Demand", render: (value) => renderNetworkNumericCell(value, "flowDemand", 1) },
                { key: "mix", label: "Demand/Revenue Mix", render: (_, row) => <MixFusion demandLocalPct={row.localDemandPct} demandFlowPct={row.flowDemandPct} revenueLocalPct={row.localRevenuePct} revenueFlowPct={row.flowRevenuePct} /> },
                { key: "absPaxDiffPct", label: "Abs Pax Diff %", render: (value) => renderNetworkNumericCell(value, "absPaxDiffPct", 1, true) },
                { key: "absPlfDiffPct", label: "Abs LF Diff pts", render: (value) => renderNetworkNumericCell(value, "absPlfDiffPct", 1) },
                { key: "revenueMix", label: "Local/Flow Revenue", render: (_, row) => <RevenueMixPieCell localRevenue={row.localRevenue} flowRevenue={row.flowRevenue} /> },
              ]}
              rows={odNetworkRowsFiltered}
              emptyMessage="No host OD aggregates available."
              onRowClick={(row) => setNetworkClickedOd((prev) => prev === row.od ? null : row.od)}
              selectedKey={networkClickedOd}
              selectedKeyField="od"
            />
          </div> : null}

          {activeTab === "flightView" ? (
  <div className="tab-content">
    {/* Filter Bar */}
    <div className="fv-filter-bar">
      <div className="fv-filter-item">
        <label className="fv-filter-label">Origin</label>
        <select className="fv-filter-select" value={fvOrig} onChange={(e) => { setFvOrig(normalizeCode(e.target.value)); setSelectedFlightKey(null); }}>
          <option value="">All Origins</option>
          {fvOrigOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="fv-filter-item">
        <label className="fv-filter-label">Destination</label>
        <select className="fv-filter-select" value={fvDest} onChange={(e) => { setFvDest(normalizeCode(e.target.value)); setSelectedFlightKey(null); }}>
          <option value="">All Destinations</option>
          {fvDestOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <div className="fv-filter-item">
        <label className="fv-filter-label">Show</label>
        <select className="fv-filter-select" value={fvAirlineFilter} onChange={(e) => setFvAirlineFilter(e.target.value)}>
          <option value="all">All Airlines</option>
          <option value="host">{hostAirline} only</option>
          <option value="competitors">Competitors only</option>
        </select>
      </div>
      {(fvOrig || fvDest || fvAirlineFilter !== "all") ? (
        <button className="fv-clear-btn" onClick={() => { setFvOrig(""); setFvDest(""); setFvAirlineFilter("all"); setSelectedFlightKey(null); }}>
          Clear filters
        </button>
      ) : null}
      {fvOrig && fvDest ? (
        <span className="fv-comp-hint">Competitor data loaded for {fvOrig}-{fvDest}</span>
      ) : (
        <span className="fv-comp-hint">Select Origin + Destination to load competitor flights</span>
      )}
    </div>

    {/* Summary KPI Strip */}
    {fvFilteredFlights.length > 0 ? (
      <div className="fv-kpi-strip">
        {fvKpiCards.map((card) => {
          const total = card.host + card.comp;
          const hostPct = total > 0 ? (card.host / total) * 100 : 0;
          const compPct = total > 0 ? (card.comp / total) * 100 : 0;
          return (
            <div key={card.id} className={`fv-kpi-card ${card.accent ? "accent" : ""}`}>
              <div className="fv-kpi-label">{card.label}</div>
              <div className="fv-kpi-value">{card.format(card.host)}</div>
              <div className="fv-kpi-compare">
                <div className="fv-kpi-compare-row">
                  <span>{hostAirline || "Host"}</span>
                  <div className="fv-kpi-track"><div className="fv-kpi-fill host" style={{ width: `${hostPct}%` }} /></div>
                  <strong>{card.format(card.host)}</strong>
                </div>
                <div className="fv-kpi-compare-row">
                  <span>Comp</span>
                  <div className="fv-kpi-track"><div className="fv-kpi-fill comp" style={{ width: `${compPct}%` }} /></div>
                  <strong>{card.format(card.comp)}</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    ) : null}

    {/* Flight Table */}
    <div className="fv-table-wrap">
      {fvRowsTruncated ? (
        <div className="fv-comp-hint" style={{ marginBottom: "8px" }}>
          Showing first {formatNumber(MAX_FLIGHT_ROWS, 0)} rows for performance. Refine Origin/Destination filters for full detail.
        </div>
      ) : null}
      <div className="table-shell">
        <table className="fv-wide-table">
          <thead>
            <tr>
              <th>Airline</th><th>Flight #</th><th>Orig</th><th>Dest</th>
              <th>Freq</th><th>Wkly Deps</th><th>A/C</th><th>Seats/Dep</th>
              <th>Dept</th><th>Arvl</th><th>Elap</th>
              <th>Obs Pax</th><th>Total Demand</th><th>Local Demand</th><th>Flow Demand</th><th>LF %</th>
              <th>Spill Total</th><th>Local Pax</th><th>Flow Pax</th>
              <th>Revenue</th><th>Avg Fare</th>
            </tr>
          </thead>
          <tbody>
            {fvDisplayedFlights.length === 0 ? (
              <tr><td colSpan={21} style={{ textAlign: "center", padding: "24px", color: "var(--text-secondary)", fontStyle: "italic" }}>No flights match the selected filters.</td></tr>
            ) : fvDisplayedFlights.map((f) => (
              <tr
                key={f.key}
                className={`row-clickable ${f.isHost ? "fv-host-row" : "fv-comp-row"} ${selectedFlightKey === f.key ? "row-selected" : ""}`}
                onClick={() => setSelectedFlightKey((prev) => prev === f.key ? null : f.key)}
              >
                <td><strong style={{ color: f.isHost ? "var(--accent-light)" : "var(--text-primary)" }}>{f.airline}</strong></td>
                <td>{f.flightNumber}</td>
                <td>
                  <button
                    className={`fv-od-pill ${fvOrig === f.orig ? "active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleFvOrig(f.orig); }}
                    title={`Filter Origin ${f.orig}`}
                  >
                    {f.orig}
                  </button>
                </td><td>
                  <button
                    className={`fv-od-pill ${fvDest === f.dest ? "active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); toggleFvDest(f.dest); }}
                    title={`Filter Destination ${f.dest}`}
                  >
                    {f.dest}
                  </button>
                </td>
                <td className="mono">{f.freq || "-"}</td>
                <td>{formatNumber(f.weeklyDeps, 0)}</td>
                <td>{f.equipment || "-"}</td>
                <td>{renderFvNumericCell(f.seatsPerDep, "seatsPerDep", 0)}</td>
                <td>{f.deptTime || "-"}</td>
                <td>{f.arvlTime || "-"}</td>
                <td>{f.elapTime || "-"}</td>
                <td>{renderFvNumericCell(f.observedPax, "observedPax", 1)}</td>
                <td>{renderFvNumericCell(f.totalDemand, "totalDemand", 1)}</td>
                <td>{renderFvNumericCell(f.localDemand, "localDemand", 1)}</td>
                <td>{renderFvNumericCell(f.flowDemand, "flowDemand", 1)}</td>
                <td>{renderFvNumericCell(f.loadFactor, "loadFactor", 1, true)}</td>
                <td>{f.isHost ? renderFvNumericCell(f.totalPax, "totalPax", 1) : "-"}</td>
                <td>{f.isHost ? renderFvNumericCell(f.localPax, "localPax", 1) : "-"}</td>
                <td>{f.isHost ? renderFvNumericCell(f.flowPax, "flowPax", 1) : "-"}</td>
                <td>{renderFvNumericCell(f.revenue, "revenue", 0)}</td>
                <td>{f.avgFare != null ? renderFvNumericCell(f.avgFare, "avgFare", 0, false, true) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

  </div>
) : null}

          {activeTab === "odView" ? (
  <div className="tab-content">
    {reportStatus === "loading" ? <div className="loading">Loading O&D data...</div> : null}

    {/* KPI Cards */}
    <div className="odv-kpi-strip">
      <div className="odv-kpi-card accent">
        <div className="odv-kpi-label">Market Traffic</div>
        <div className="odv-kpi-value">{formatNumber(odViewMarketSize, 1)}</div>
        <div className="odv-kpi-sub">Total traffic (all carriers)</div>
      </div>
      <div className="odv-kpi-card host">
        <div className="odv-kpi-label">{hostAirline} Demand Share</div>
        <div className="odv-kpi-value">{odViewHostRow ? formatPct(odViewHostRow.demandShare, 1) : "-"}</div>
        <div className="odv-kpi-sub">{odViewHostRow ? formatNumber(odViewHostRow.demand, 1) + " pax" : "No data"}</div>
      </div>
      <div className="odv-kpi-card host">
        <div className="odv-kpi-label">{hostAirline} Traffic Share</div>
        <div className="odv-kpi-value">{odViewHostRow ? formatPct(odViewHostRow.trafficShare, 1) : "-"}</div>
        <div className="odv-kpi-sub">{odViewHostRow ? formatNumber(odViewHostRow.traffic, 1) + " boarded" : "No data"}</div>
      </div>
      <div className="odv-kpi-card host">
        <div className="odv-kpi-label">{hostAirline} Revenue Share</div>
        <div className="odv-kpi-value">{odViewHostRow ? formatPct(odViewHostRow.revenueShare, 1) : "-"}</div>
        <div className="odv-kpi-sub">{odViewHostRow ? formatNumber(odViewHostRow.revenue, 0) : "No data"}</div>
      </div>
      <div className="odv-kpi-card">
        <div className="odv-kpi-label">Market Revenue</div>
        <div className="odv-kpi-value">{formatNumber(odViewTotalRevenue, 0)}</div>
        <div className="odv-kpi-sub">All carriers combined</div>
      </div>
      <div className="odv-kpi-card">
        <div className="odv-kpi-label">Airlines in Market</div>
        <div className="odv-kpi-value">{odViewMarketRows.length}</div>
        <div className="odv-kpi-sub">{itineraryRows.length} itineraries</div>
      </div>
    </div>

    <div className="odv-section">
      <div className="odv-section-head">
        <div>
          <h3>Market Visual Report - {selectedOd}</h3>
          <p>Charts for airline share, yield, itinerary mix, and connection network</p>
        </div>
        <button className="odv-qsi-btn" onClick={() => setOdQsiOpen(true)} disabled={!selectedOd}>
          Competitive Position (QSI)
        </button>
      </div>
      <div className="odv-chart-grid">
        <div className="odv-chart-card">
          <div className="odv-chart-head">Airline Share (Traffic %)</div>
          <div className="odv-bars">
            {odViewShareBars.length === 0 ? <div className="empty-state">No market data.</div> : odViewShareBars.map((r) => (
              <div key={`ts-${r.aln}`} className="odv-bar-row">
                <div className="odv-bar-label">{r.aln}</div>
                <div className="odv-bar-track">
                  <div className={`odv-bar-fill ${r.aln === hostAirline ? "host" : ""}`} style={{ width: `${Math.min(100, r.trafficShare)}%` }} />
                </div>
                <div className="odv-bar-value">{formatPct(r.trafficShare, 1)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="odv-chart-card">
          <div className="odv-chart-head">Airline Yield (Revenue / Traffic)</div>
          {(() => {
            const maxFare = Math.max(1, maxFinite(odViewShareBars.map((x) => Number(x.avgFare || 0)), 0));
            return (
          <div className="odv-bars">
            {odViewShareBars.length === 0 ? <div className="empty-state">No market data.</div> : odViewShareBars.map((r) => {
              const width = (Number(r.avgFare || 0) / maxFare) * 100;
              return (
                <div key={`yf-${r.aln}`} className="odv-bar-row">
                  <div className="odv-bar-label">{r.aln}</div>
                  <div className="odv-bar-track">
                    <div className={`odv-bar-fill revenue ${r.aln === hostAirline ? "host" : ""}`} style={{ width: `${Math.min(100, width)}%` }} />
                  </div>
                  <div className="odv-bar-value">{formatNumber(r.avgFare, 0)}</div>
                </div>
              );
            })}
          </div>
            );
          })()}
        </div>
        <div className="odv-chart-card">
          <div className="odv-chart-head">Itinerary Pattern Mix</div>
          {(() => {
            const maxTraffic = Math.max(1, maxFinite(odItineraryMix.map((x) => Number(x.traffic || 0)), 0));
            return (
          <div className="odv-bars">
            {odItineraryMix.map((m) => {
              const width = (Number(m.traffic || 0) / maxTraffic) * 100;
              return (
                <div key={m.label} className="odv-bar-row">
                  <div className="odv-bar-label">{m.label}</div>
                  <div className="odv-bar-track">
                    <div className="odv-bar-fill mix" style={{ width: `${Math.min(100, width)}%` }} />
                  </div>
                  <div className="odv-bar-value">{formatNumber(m.traffic, 1)}</div>
                </div>
              );
            })}
          </div>
            );
          })()}
        </div>
        <div className="odv-chart-card">
          <div className="odv-chart-head">Connection Network</div>
          {(() => {
            const maxW = Math.max(1, maxFinite(odConnectivityGraph.edges.map((x) => Number(x.weight || 0)), 0));
            return (
          <svg viewBox="0 0 420 220" className="odv-network-svg">
            <rect x="20" y="12" width="380" height="190" fill="#f8fafc" stroke="#e2e8f0" />
            {odConnectivityGraph.edges.map((e, idx) => {
              const s = odConnectivityGraph.pos[e.source];
              const t = odConnectivityGraph.pos[e.target];
              if (!s || !t) return null;
              const sw = 1 + (Number(e.weight || 0) / maxW) * 4;
              return <line key={`e-${idx}`} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="#94a3b8" strokeWidth={sw} opacity={0.75} />;
            })}
            {odConnectivityGraph.nodes.map((n) => {
              const p = odConnectivityGraph.pos[n.id];
              if (!p) return null;
              const fill = n.role === "origin" || n.role === "destination" ? "#0ea5e9" : "#64748b";
              return (
                <g key={`n-${n.id}`}>
                  <circle cx={p.x} cy={p.y} r={7} fill={fill} />
                  <text x={p.x + 10} y={p.y + 4} className="odv-network-label">{n.id}</text>
                </g>
              );
            })}
          </svg>
            );
          })()}
        </div>
      </div>
      <div className="odv-mini-strip">
        {odViewShareBars.slice(0, 6).map((r) => (
          <span key={`chip-${r.aln}`} className={`odv-mini-chip ${r.aln === hostAirline ? "host" : ""}`}>
            {r.aln}: {formatPct(r.trafficShare, 1)} / {formatNumber(r.avgFare, 0)}
          </span>
        ))}
      </div>
      <div className="od-table-section" style={{ margin: "0 12px 12px" }}>
        <div className="od-table-section-head">
          <h4>Market Summary Table</h4>
          <p>Detailed carrier-wise market metrics for {selectedOd}</p>
        </div>
        <div className="odv-table-shell">
          <table className="od-data-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Airline</th>
                <th>Num NStps</th>
                <th>Num Cncts</th>
                <th>Total Demand</th>
                <th>Demand Share %</th>
                <th>Total Traffic</th>
                <th>Traffic Share %</th>
                <th>Pax Revenue($)</th>
                <th>Revenue Share %</th>
                <th>Avg Fare</th>
              </tr>
            </thead>
            <tbody>
              {odViewMarketRows.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text-secondary)" }}>No market rows available.</td></tr>
              ) : odViewMarketRows.map((row) => (
                <tr key={`od-summary-${selectedOd}-${row.aln}`} className={row.aln === hostAirline ? "odv-host-row" : ""}>
                  <td>{selectedOd}</td>
                  <td>
                    <strong>{row.aln}</strong>
                    {row.aln === hostAirline ? <span className="odv-host-badge">HOST</span> : null}
                  </td>
                  <td>{formatNumber(row.nstops, 0)}</td>
                  <td>{formatNumber(row.cncts, 0)}</td>
                  <td>{formatNumber(row.demand, 1)}</td>
                  <td>{formatPct(row.demandShare, 1)}</td>
                  <td>{formatNumber(row.traffic, 1)}</td>
                  <td>{formatPct(row.trafficShare, 1)}</td>
                  <td>{formatNumber(row.revenue, 0)}</td>
                  <td>{formatPct(row.revenueShare, 1)}</td>
                  <td>{formatNumber(row.avgFare, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
) : null}
        </section>
      </main>
      {odQsiOpen ? (
        <div className="od-modal-backdrop" onClick={() => setOdQsiOpen(false)}>
          <div className="od-modal" onClick={(e) => e.stopPropagation()}>
            <div className="od-modal-header">
              <div>
                <h3>Competitive Position (QSI Factors) - {selectedOd || "Selected OD"}</h3>
                <p>Derived metrics from itinerary and flight data; metrics marked * require external model parameters.</p>
              </div>
              <button className="od-close-btn" onClick={() => setOdQsiOpen(false)}>x</button>
            </div>
            <div className="od-modal-body">
              <div className="od-table-section">
                <div style={{ padding: "12px 16px 18px" }}>
                  <QsiBarChart qsiRows={odQsiRows} />
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {networkClickedOd ? (
        <OdDetailPanel
          od={networkClickedOd}
          odRow={networkClickedOdRow}
          flightRows={odDetailFlightRows}
          itineraryRows={odDetailItineraryRows}
          status={odDetailStatus}
          hostAirline={hostAirline}
          onClose={() => setNetworkClickedOd(null)}
        />
      ) : null}

      {fvSelectedFlight ? (
        <div className="fv-modal-backdrop" onClick={() => setSelectedFlightKey(null)}>
          <div className="fv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="od-modal-header">
              <div>
                <h3>
                  {fvSelectedFlight.isHost
                    ? `${hostAirline} ${fvSelectedFlight.flightNumber} - Flow OD Breakdown`
                    : `${fvSelectedFlight.flightNumber} - Flight Details`}
                </h3>
                <p>
                  {fvSelectedFlight.orig} {"->"} {fvSelectedFlight.dest} {"|"}{" "}
                  {fvSelectedFlight.isHost ? "Host flight | local & flow pax breakdown" : "Competitor flight | operational metrics"}
                </p>
              </div>
              <button className="od-close-btn" onClick={() => setSelectedFlightKey(null)}>x</button>
            </div>
            <div className="od-modal-body">
              <div className="fv-detail-stats">
                {fvSelectedFlight.isHost ? (
                  <>
                    <div className="fv-ds"><span>Total Spill Pax</span><strong>{formatNumber(fvSelectedFlight.totalPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Local Pax</span><strong>{formatNumber(fvSelectedFlight.localPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Flow Pax</span><strong>{formatNumber(fvSelectedFlight.flowPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Flow %</span><strong>{fvSelectedFlight.totalPax > 0 ? formatPct((fvSelectedFlight.flowPax / fvSelectedFlight.totalPax) * 100, 1) : "-"}</strong></div>
                    <div className="fv-ds"><span>Load Factor</span><strong>{formatPct(fvSelectedFlight.loadFactor, 1)}</strong></div>
                    <div className="fv-ds"><span>Revenue</span><strong>{formatNumber(fvSelectedFlight.revenue, 0)}</strong></div>
                  </>
                ) : (
                  <>
                    <div className="fv-ds"><span>Weekly Deps</span><strong>{formatNumber(fvSelectedFlight.weeklyDeps, 0)}</strong></div>
                    <div className="fv-ds"><span>A/C Type</span><strong>{fvSelectedFlight.equipment || "-"}</strong></div>
                    <div className="fv-ds"><span>Seats/Dep</span><strong>{formatNumber(fvSelectedFlight.seatsPerDep, 0)}</strong></div>
                    <div className="fv-ds"><span>Observed Pax</span><strong>{formatNumber(fvSelectedFlight.observedPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Load Factor</span><strong>{formatPct(fvSelectedFlight.loadFactor, 1)}</strong></div>
                    <div className="fv-ds"><span>Revenue</span><strong>{formatNumber(fvSelectedFlight.revenue, 0)}</strong></div>
                  </>
                )}
              </div>
              {fvSelectedOdBreakupRows.length > 0 ? (
                <div className="fv-table-wrap" style={{ marginBottom: "12px" }}>
                  <div className="table-shell">
                    <table className="fv-od-breakup-table">
                      <thead>
                        <tr>
                          <th>OD</th>
                          <th>{hostAirline} Total Demand</th>
                          <th>{hostAirline} Local Demand</th>
                          <th>{hostAirline} Flow Demand</th>
                          <th>Comp Total Demand</th>
                          <th>Comp Local Demand</th>
                          <th>Comp Flow Demand</th>
                          <th>Market Total Demand</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fvSelectedOdBreakupRows.map((row) => (
                          <tr key={`fv-od-demand-modal-${row.od}`}>
                            <td><strong>{row.od}</strong></td>
                            <td>{renderFvNumericCell(row.hostTotalDemand, "totalDemand", 1)}</td>
                            <td>{renderFvNumericCell(row.hostLocalDemand, "localDemand", 1)}</td>
                            <td>{renderFvNumericCell(row.hostFlowDemand, "flowDemand", 1)}</td>
                            <td>{renderFvNumericCell(row.compTotalDemand, "totalDemand", 1)}</td>
                            <td>{renderFvNumericCell(row.compLocalDemand, "localDemand", 1)}</td>
                            <td>{renderFvNumericCell(row.compFlowDemand, "flowDemand", 1)}</td>
                            <td>{renderFvNumericCell(row.marketTotalDemand, "totalDemand", 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
              {fvSelectedFlight.isHost ? (
                fvFlowRows.length > 0 ? (
                  <Table
                    columns={[
                      { key: "label", label: "OD", render: (v) => <strong>{v}</strong> },
                      { key: "flow_orig", label: "Orig" },
                      { key: "flow_dest", label: "Dest" },
                      { key: "flow_pax_est", label: "Pax", render: (v) => formatNumber(v, 1) },
                      { key: "flow_revenue_est", label: "Revenue", render: (v) => formatNumber(v, 0) },
                    ]}
                    rows={fvFlowRows}
                    emptyMessage="No flow OD data found."
                  />
                ) : (
                  <div className="empty-state">No flow OD contributors for this flight.</div>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}



