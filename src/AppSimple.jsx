import React, { useEffect, useMemo, useState } from "react";
import initSqlJs from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { Badge, Group, Paper, ScrollArea, Select, SimpleGrid, Slider, Stack, Table as MantineTable, Text, Title } from "@mantine/core";
import initialBundle from "./generated/dashboard_bundle.json";
import { buildRouteWaterfallContributions, computeDiagnosticsDataset, defaultDiagnosticsConfig } from "./experiments/calibrationDiagnostics";

const tabs = [
  { id: "summary", label: "Network", icon: "🌐" },
  { id: "flightView", label: "Flight View", icon: "✈️" },
  { id: "odView", label: "O&D View", icon: "🧭" },
  { id: "experiment", label: "Experiment", icon: "🧪" },
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
            <span className="nsc-split-sep">·</span>
            <span className="nsc-flow-val">{formatNumber(totalFlowPax, 0)}</span>
          </div>
          <SplitBar localPct={localPaxPct} flowPct={flowPaxPct} />
        </div>
        <div className="nsc-split">
          <div className="nsc-split-label">Revenue Mix <span style={{ fontSize: "0.72rem", fontWeight: 400, color: "var(--text-secondary)" }}>(all host ODs)</span></div>
          <div className="nsc-split-nums">
            <span className="nsc-local-val">{formatNumber(totalLocalRevenue, 0)}</span>
            <span className="nsc-split-sep">·</span>
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
  return String(freq || "").split("").filter((c) => c !== ".").length;
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

function ExperimentSankey({ rows, hostAirline, mlSignals }) {
  const [segmentFilters, setSegmentFilters] = useState({
    normal: true,
    highOpp: true,
    flowIncrease: true,
    localIncrease: true,
    elapsedChange: true,
  });

  const model = useMemo(() => {
    const base = (rows || [])
      .map((r) => {
        const totalPax = Number(r.totalPax || (Number(r.localPax || 0) + Number(r.flowPax || 0)));
        const totalRevenue = Number(r.totalRevenue || (Number(r.localRevenue || 0) + Number(r.flowRevenue || 0)));
        const flowShare = totalPax > 0 ? (Number(r.flowPax || 0) / totalPax) * 100 : 0;
        const localShare = totalPax > 0 ? (Number(r.localPax || 0) / totalPax) * 100 : 0;
        const avgFare = totalPax > 0 ? totalRevenue / totalPax : 0;
        const flowShift = Number(r.flowApmPct || 0) - Number(r.flowPddPct || 0);
        const elapsedTimeDeltaPct = Number(r.elapsedTimeDeltaPct || 0);
        return {
          ...r,
          totalPax,
          totalRevenue,
          flowShare,
          localShare,
          avgFare,
          flowShift,
          elapsedTimeDeltaPct,
          absPaxDiffPct: Number(r.absPaxDiffPct || 0),
          absPlfDiffPct: Number(r.absPlfDiffPct || 0),
          loadFactorPct: Number(r.loadFactorPct || 0),
        };
      })
      .filter((r) => r.totalPax > 0)
      .sort((a, b) => b.totalPax - a.totalPax);

    if (!base.length) {
      return { nodesLeft: [], nodesRight: [], links: [], top: [], totals: { pax: 0, revenue: 0 }, segmentCounts: {} };
    }

    const toMeanStd = (vals) => {
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      return { mean, std: Math.sqrt(variance) || 1 };
    };

    const flowMs = toMeanStd(base.map((r) => r.flowShare));
    const paxDiffMs = toMeanStd(base.map((r) => r.absPaxDiffPct));
    const plfDiffMs = toMeanStd(base.map((r) => r.absPlfDiffPct));
    const fareMs = toMeanStd(base.map((r) => r.avgFare));

    const enriched = base.map((r) => {
      const zFlow = Math.abs((r.flowShare - flowMs.mean) / flowMs.std);
      const zPax = Math.abs((r.absPaxDiffPct - paxDiffMs.mean) / paxDiffMs.std);
      const zPlf = Math.abs((r.absPlfDiffPct - plfDiffMs.mean) / plfDiffMs.std);
      const zFare = Math.abs((r.avgFare - fareMs.mean) / fareMs.std);
      const anomalyScore = Math.min(100, ((zFlow + zPax + zPlf + zFare) / 4) * 40);
      const opportunityScore = Math.min(
        100,
        r.flowShare * 0.4 + Math.min(100, r.absPaxDiffPct) * 0.28 + Math.min(100, r.absPlfDiffPct * 4) * 0.17 + Math.max(0, 100 - r.loadFactorPct) * 0.15,
      );
      const upliftRevenueEst = Math.round(r.totalRevenue * (opportunityScore / 100) * 0.08);
      const segment = {
        normal: opportunityScore <= 55 && anomalyScore <= 45,
        highOpp: opportunityScore > 55,
        flowIncrease: r.flowShift >= 5,
        localIncrease: r.localShare >= 60,
        elapsedChange: Math.abs(r.elapsedTimeDeltaPct) >= 8,
      };
      return { ...r, anomalyScore, opportunityScore, upliftRevenueEst, segment };
    });

    const segmentCounts = {
      normal: enriched.filter((r) => r.segment.normal).length,
      highOpp: enriched.filter((r) => r.segment.highOpp).length,
      flowIncrease: enriched.filter((r) => r.segment.flowIncrease).length,
      localIncrease: enriched.filter((r) => r.segment.localIncrease).length,
      elapsedChange: enriched.filter((r) => r.segment.elapsedChange).length,
    };

    const activeKeys = Object.keys(segmentFilters).filter((k) => segmentFilters[k]);
    const filtered = activeKeys.length
      ? enriched.filter((r) => activeKeys.some((k) => r.segment[k]))
      : enriched;

    const linksRaw = filtered.slice(0, 48).map((r) => ({
      source: normalizeCode(r.orig),
      target: normalizeCode(r.dest),
      value: r.totalPax,
      anomaly: r.anomalyScore,
      opportunity: r.opportunityScore,
      flowShift: r.flowShift,
      localShare: r.localShare,
      elapsedTimeDeltaPct: r.elapsedTimeDeltaPct,
    }));

    const leftTotals = new Map();
    const rightTotals = new Map();
    for (const l of linksRaw) {
      leftTotals.set(l.source, (leftTotals.get(l.source) || 0) + l.value);
      rightTotals.set(l.target, (rightTotals.get(l.target) || 0) + l.value);
    }

    const nodesLeft = [...leftTotals.entries()].map(([id, value]) => ({ id, value })).sort((a, b) => b.value - a.value);
    const nodesRight = [...rightTotals.entries()].map(([id, value]) => ({ id, value })).sort((a, b) => b.value - a.value);
    const top = filtered.slice().sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 10);
    const totals = {
      pax: filtered.reduce((s, r) => s + r.totalPax, 0),
      revenue: filtered.reduce((s, r) => s + r.totalRevenue, 0),
    };

    const weightedMean = (arr, valFn, wtFn) => {
      const w = arr.reduce((s, x) => s + wtFn(x), 0) || 1;
      return arr.reduce((s, x) => s + valFn(x) * wtFn(x), 0) / w;
    };
    const baseForRec = filtered.length ? filtered : enriched;
    const flowShiftW = weightedMean(baseForRec, (r) => r.flowShift, (r) => r.totalPax);
    const elapsedDeltaW = weightedMean(baseForRec, (r) => r.elapsedTimeDeltaPct, (r) => r.totalPax);
    const fareDevW = weightedMean(baseForRec, (r) => ((r.avgFare - fareMs.mean) / fareMs.std), (r) => r.totalPax);
    const plfGapW = weightedMean(baseForRec, (r) => r.absPlfDiffPct, (r) => r.totalPax);
    const paxGapW = weightedMean(baseForRec, (r) => r.absPaxDiffPct, (r) => r.totalPax);
    const clip = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
    const confidence = Math.min(0.95, 0.45 + (baseForRec.length / 80));
    const heuristicRecommendations = [
      {
        coeff: "beta_flow_connectivity",
        delta: Number((clip(flowShiftW / 20) * 0.14).toFixed(3)),
        confidence,
        reason: "Align model flow utility with observed APM vs PDD flow-share drift.",
      },
      {
        coeff: "beta_elapsed_time",
        delta: Number((clip(-elapsedDeltaW / 15) * 0.12).toFixed(3)),
        confidence,
        reason: "Adjust elapsed-time penalty using host-vs-market elapsed change signal.",
      },
      {
        coeff: "beta_fare_sensitivity",
        delta: Number((clip(-fareDevW / 2) * 0.11).toFixed(3)),
        confidence,
        reason: "Correct fare response where yield deviation and share movement diverge.",
      },
      {
        coeff: "beta_service_quality",
        delta: Number((clip((paxGapW + plfGapW * 3) / 120) * 0.09).toFixed(3)),
        confidence,
        reason: "Reduce residual demand/LF mismatch likely driven by service-quality underfit.",
      },
    ];

    return { nodesLeft, nodesRight, links: linksRaw, top, totals, segmentCounts, heuristicRecommendations };
  }, [rows, segmentFilters]);

  const coefficientRecommendations = useMemo(() => {
    const recs = Array.isArray(mlSignals?.recommendations) ? mlSignals.recommendations : [];
    if (recs.length) return recs;
    return model.heuristicRecommendations || [];
  }, [mlSignals, model.heuristicRecommendations]);

  const sankey = useMemo(() => {
    const width = 980;
    const height = 460;
    const nodeW = 16;
    const pad = 8;

    const layoutColumn = (nodes, x) => {
      const total = nodes.reduce((s, n) => s + n.value, 0) || 1;
      const usable = height - pad * (nodes.length - 1);
      const scale = usable / total;
      let y = 0;
      return {
        byId: new Map(
          nodes.map((n) => {
            const h = Math.max(8, n.value * scale);
            const item = { ...n, x, y, h };
            y += h + pad;
            return [n.id, item];
          }),
        ),
        scale,
      };
    };

    const left = layoutColumn(model.nodesLeft, 0);
    const right = layoutColumn(model.nodesRight, width - nodeW);
    const outOffset = new Map();
    const inOffset = new Map();

    const links = model.links
      .map((l) => {
        const s = left.byId.get(l.source);
        const t = right.byId.get(l.target);
        if (!s || !t) return null;
        const w = Math.max(1.2, l.value * Math.min(left.scale, right.scale));
        const so = outOffset.get(s.id) || 0;
        const to = inOffset.get(t.id) || 0;
        const sy = s.y + so + w / 2;
        const ty = t.y + to + w / 2;
        outOffset.set(s.id, so + w);
        inOffset.set(t.id, to + w);
        const c1x = width * 0.35;
        const c2x = width * 0.65;
        const d = `M ${s.x + nodeW} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${t.x} ${ty}`;
        return { ...l, d, w };
      })
      .filter(Boolean);

    return { width, height, nodeW, left: [...left.byId.values()], right: [...right.byId.values()], links };
  }, [model]);

  if (!model.links.length) return <div className="empty-state">No routes available for experiment.</div>;

  const segmentButtons = [
    { key: "normal", label: "Normal Flow" },
    { key: "highOpp", label: "High Opp Route" },
    { key: "flowIncrease", label: "Flow Increase" },
    { key: "localIncrease", label: "Local Increase" },
    { key: "elapsedChange", label: "Elapsed Time Change" },
  ];

  return (
    <div className="exp-grid">
      <div className="exp-panel">
        <div className="exp-head">
          <h3>Network Flow Sankey (Experiment)</h3>
          <p>ML-style anomaly and opportunity scoring from OD demand, flow mix, fare, and calibration deltas.</p>
        </div>
        <div className="exp-filters">
          {segmentButtons.map((b) => (
            <button
              key={b.key}
              className={segmentFilters[b.key] ? "exp-filter active" : "exp-filter"}
              onClick={() => setSegmentFilters((prev) => ({ ...prev, [b.key]: !prev[b.key] }))}
            >
              {b.label}
              <span>{model.segmentCounts[b.key] || 0}</span>
            </button>
          ))}
        </div>
        <svg className="exp-sankey" viewBox={`0 0 ${sankey.width} ${sankey.height}`} preserveAspectRatio="xMidYMid meet">
          {sankey.links.map((l, i) => (
            <path
              key={`l-${i}`}
              d={l.d}
              stroke={l.opportunity > 55 ? "#d97706" : (l.flowShift >= 5 ? "#0ea5e9" : "#2065d1")}
              strokeOpacity={0.34 + Math.min(0.52, l.anomaly / 180)}
              strokeWidth={l.w}
              fill="none"
              strokeLinecap="round"
            />
          ))}
          {sankey.left.map((n) => (
            <g key={`ln-${n.id}`}>
              <rect x={n.x} y={n.y} width={sankey.nodeW} height={n.h} rx="3" fill="#2065d1" opacity="0.85" />
              <text x={n.x + sankey.nodeW + 6} y={n.y + n.h / 2} dominantBaseline="middle" className="exp-node-label">{n.id}</text>
            </g>
          ))}
          {sankey.right.map((n) => (
            <g key={`rn-${n.id}`}>
              <rect x={n.x} y={n.y} width={sankey.nodeW} height={n.h} rx="3" fill="#0ea5e9" opacity="0.85" />
              <text x={n.x - 6} y={n.y + n.h / 2} textAnchor="end" dominantBaseline="middle" className="exp-node-label">{n.id}</text>
            </g>
          ))}
        </svg>
        <div className="exp-legend">
          <span><i className="exp-dot exp-blue" /> Normal flow</span>
          <span><i className="exp-dot exp-amber" /> High opportunity route</span>
          <span><i className="exp-dot exp-cyan" /> Flow increase signal</span>
          <span>Total Pax: <strong>{formatNumber(model.totals.pax, 0)}</strong></span>
          <span>Total Revenue: <strong>{formatNumber(model.totals.revenue, 0)}</strong></span>
        </div>
      </div>
      <div className="exp-panel">
        <div className="exp-head">
          <h3>Top Opportunity Routes</h3>
          <p>Unsupervised score using flow-share skew, calibration gaps, fare deviation, and LF slack.</p>
        </div>
        <div className="exp-table-wrap">
          <table className="exp-table">
            <thead>
              <tr>
                <th>OD</th>
                <th>Opportunity</th>
                <th>Anomaly</th>
                <th>Flow %</th>
                <th>Est Uplift</th>
              </tr>
            </thead>
            <tbody>
              {model.top.map((r) => (
                <tr key={r.od}>
                  <td><strong>{r.od}</strong></td>
                  <td>{formatPct(r.opportunityScore, 1)}</td>
                  <td>{formatPct(r.anomalyScore, 1)}</td>
                  <td>{formatPct(r.flowShare, 1)}</td>
                  <td>{formatNumber(r.upliftRevenueEst, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="exp-head" style={{ marginTop: "6px" }}>
          <h3>Logit Coefficient Suggestions (MLE Signals)</h3>
          <p>
            {Array.isArray(mlSignals?.recommendations) && mlSignals.recommendations.length
              ? `Ridge model from workset residuals (R² ${formatNumber((Number(mlSignals?.r2 || 0) * 100), 1)}%). Suggested deltas are not auto-applied.`
              : "Fallback heuristic deltas from weighted residual signals in current workset (not auto-applied)."}
          </p>
        </div>
        <div className="exp-table-wrap">
          <table className="exp-table">
            <thead>
              <tr>
                <th>Coefficient</th>
                <th>Baseline</th>
                <th>Suggested Delta</th>
                <th>Suggested Value</th>
                <th>Confidence</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {coefficientRecommendations.map((r) => (
                <tr key={r.coeff}>
                  <td><strong>{r.coeff}</strong></td>
                  <td>{r.baseline != null ? Number(r.baseline).toFixed(4) : "\u2014"}</td>
                  <td style={{ color: r.delta >= 0 ? "#0284c7" : "#b45309" }}>{r.delta >= 0 ? "+" : ""}{r.delta.toFixed(3)}</td>
                  <td>{r.suggested != null ? Number(r.suggested).toFixed(4) : "\u2014"}</td>
                  <td>{(Number(r.confidence || 0) * 100).toFixed(0)}%</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ErrorHeatmap({ rows }) {
  const top = rows.slice().sort((a, b) => Math.abs(b.percentage_error) - Math.abs(a.percentage_error)).slice(0, 140);
  const origins = [...new Set(top.map((r) => r.origin))].slice(0, 20);
  const destinations = [...new Set(top.map((r) => r.destination))].slice(0, 20);
  const xStep = 28;
  const yStep = 22;
  const width = Math.max(360, destinations.length * xStep + 120);
  const height = Math.max(220, origins.length * yStep + 100);
  const idxMap = new Map();
  for (const r of top) idxMap.set(`${r.origin}|${r.destination}`, r);
  const colorFor = (v) => {
    const cap = Math.max(-0.45, Math.min(0.45, Number(v || 0)));
    if (cap >= 0) return `rgba(220, 38, 38, ${0.15 + Math.abs(cap) * 1.5})`;
    return `rgba(2, 132, 199, ${0.15 + Math.abs(cap) * 1.5})`;
  };
  if (!top.length) return <div className="empty-state">No route data for heatmap.</div>;
  return (
    <div className="diag-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="diag-svg" width={width} height={height}>
        <text x="12" y="20" className="diag-axis-label">Origin</text>
        <text x={width - 148} y={20} className="diag-axis-label">Destination</text>
        {origins.map((o, i) => <text key={o} x="8" y={55 + i * yStep} className="diag-tick">{o}</text>)}
        {destinations.map((d, j) => <text key={d} x={96 + j * xStep} y="40" className="diag-tick" transform={`rotate(-35 ${96 + j * xStep} 40)`}>{d}</text>)}
        {origins.map((o, i) =>
          destinations.map((d, j) => {
            const row = idxMap.get(`${o}|${d}`);
            const val = row ? row.percentage_error : 0;
            return (
              <rect
                key={`${o}-${d}`}
                x={80 + j * xStep}
                y={46 + i * yStep}
                width={xStep - 2}
                height={yStep - 2}
                fill={row ? colorFor(val) : "rgba(148, 163, 184, 0.12)"}
                stroke="rgba(148, 163, 184, 0.2)"
              />
            );
          }),
        )}
      </svg>
    </div>
  );
}

function ScatterPlot({ rows, xKey, yKey, xLabel, yLabel }) {
  const data = rows.filter((r) => Number.isFinite(Number(r[xKey])) && Number.isFinite(Number(r[yKey])));
  if (!data.length) return <div className="empty-state">Not enough data for scatter.</div>;
  const xMin = Math.min(...data.map((r) => Number(r[xKey])));
  const xMax = Math.max(...data.map((r) => Number(r[xKey])));
  const yMin = Math.min(...data.map((r) => Number(r[yKey])));
  const yMax = Math.max(...data.map((r) => Number(r[yKey])));
  const width = 420;
  const height = 250;
  const pad = 34;
  const scaleX = (x) => pad + ((x - xMin) / ((xMax - xMin) || 1)) * (width - pad * 2);
  const scaleY = (y) => height - pad - ((y - yMin) / ((yMax - yMin) || 1)) * (height - pad * 2);
  return (
    <div className="diag-svg-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="diag-svg" width={width} height={height}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="diag-axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="diag-axis" />
        <text x={width / 2 - 44} y={height - 8} className="diag-axis-label">{xLabel}</text>
        <text x={8} y={16} className="diag-axis-label">{yLabel}</text>
        {data.map((r) => (
          <circle key={r.route_id} cx={scaleX(Number(r[xKey]))} cy={scaleY(Number(r[yKey]))} r="3.1" fill={Math.abs(Number(r.percentage_error || 0)) > 0.3 ? "#dc2626" : "#0284c7"} opacity="0.85" />
        ))}
      </svg>
    </div>
  );
}

function CompetitiveShareBars({ route }) {
  const rows = route?.market_split || [];
  if (!rows.length) return <div className="empty-state">No airline share split found for this route.</div>;
  return (
    <div className="diag-share-bars">
      {rows.slice(0, 8).map((r) => (
        <div key={r.airline} className="diag-share-row">
          <div className="diag-share-airline">{r.airline}</div>
          <div className="diag-share-track">
            <div className="diag-share-pred" style={{ width: `${Math.max(0, Math.min(100, Number(r.predicted_share || 0) * 100))}%` }} />
            <div className="diag-share-actual" style={{ width: `${Math.max(0, Math.min(100, Number(r.actual_share || 0) * 100))}%` }} />
          </div>
          <div className="diag-share-num">{formatPct(Number(r.predicted_share || 0) * 100, 1)} / {formatPct(Number(r.actual_share || 0) * 100, 1)}</div>
        </div>
      ))}
      <div className="diag-mini-note">Predicted / Actual share (Actual proxied from demand-share where required)</div>
    </div>
  );
}

function WaterfallApprox({ route }) {
  if (!route) return <div className="empty-state">Select a route for decomposition.</div>;
  const parts = buildRouteWaterfallContributions(route);
  const maxAbs = Math.max(...parts.map((p) => Math.abs(Number(p.value || 0))), 1);
  return (
    <div className="diag-waterfall">
      {parts.map((p) => (
        <div key={p.key} className="diag-wf-row">
          <div className="diag-wf-label">{p.label}</div>
          <div className="diag-wf-bar-wrap">
            <div className={`diag-wf-bar ${Number(p.value || 0) >= 0 ? "pos" : "neg"}`} style={{ width: `${Math.max(2, Math.abs(Number(p.value || 0)) / maxAbs * 100)}%` }} />
          </div>
          <div className="diag-wf-val">{formatNumber(p.value, 1)}</div>
        </div>
      ))}
      <div className="diag-mini-note">Approximate decomposition (transparent proxy, not exact logistic attribution).</div>
    </div>
  );
}

function CalibrationDiagnosticsPanel({ odRows, bundle, hostAirline }) {
  const [warningPct, setWarningPct] = useState(defaultDiagnosticsConfig.warningPctError);
  const [criticalPct, setCriticalPct] = useState(defaultDiagnosticsConfig.criticalPctError);
  const [alphaBlend, setAlphaBlend] = useState(defaultDiagnosticsConfig.alphaBlend);
  const [selectedRoute, setSelectedRoute] = useState("");
  const [airlineFilter, setAirlineFilter] = useState("ALL");
  const config = useMemo(() => ({ ...defaultDiagnosticsConfig, warningPctError: warningPct, criticalPctError: criticalPct, alphaBlend }), [warningPct, criticalPct, alphaBlend]);

  const diagnostics = useMemo(() => {
    try {
      return computeDiagnosticsDataset({
        odRows,
        level2Rows: bundle?.level2_od_airline_share_summary || [],
        priorRows: bundle?.route_calibration_priors || [],
        mlSignals: bundle?.ml_signals || null,
        hostAirline,
        config,
      });
    } catch (error) {
      return {
        routes: [],
        flagged: [],
        tables: { overpredicted: [], underpredicted: [], shareMisalloc: [] },
        summary: { before: { mape: 0, wmape: 0, rmse: 0 }, after: { mape: 0, wmape: 0, rmse: 0 } },
        correctedRows: [],
        routeLevelModelSuggestions: [],
        segmentLevelModelSuggestions: [],
        overallCoeffSuggestions: [],
        renderError: String(error?.message || error || "Unknown diagnostics error"),
      };
    }
  }, [odRows, bundle, hostAirline, config]);

  const routesFiltered = useMemo(() => {
    const rows = diagnostics.routes || [];
    if (airlineFilter === "ALL") return rows;
    return rows.filter((r) => String(r.airline || "") === airlineFilter);
  }, [diagnostics.routes, airlineFilter]);
  const routeForDrill = useMemo(() => routesFiltered.find((r) => r.route_id === selectedRoute) || routesFiltered[0] || null, [routesFiltered, selectedRoute]);
  const summary = diagnostics.summary || {};

  useEffect(() => {
    if (!routesFiltered.length) return;
    if (!selectedRoute || !routesFiltered.some((r) => r.route_id === selectedRoute)) {
      setSelectedRoute(routesFiltered[0].route_id);
    }
  }, [routesFiltered, selectedRoute]);

  return (
    <Stack className="diag-root" gap="sm">
      {diagnostics.renderError ? (
        <Paper withBorder radius="md" p="md">
          <Title order={4}>Diagnostics Render Warning</Title>
          <Text c="dimmed" mt={6}>
            Diagnostics fallback mode is active for this workset: {diagnostics.renderError}
          </Text>
        </Paper>
      ) : null}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
        <Paper withBorder radius="md" p="sm">
          <Text size="xs" fw={600}>Warning Threshold ({formatPct(warningPct * 100, 0)})</Text>
          <Slider min={0.05} max={0.3} step={0.01} value={warningPct} onChange={setWarningPct} />
        </Paper>
        <Paper withBorder radius="md" p="sm">
          <Text size="xs" fw={600}>Critical Threshold ({formatPct(criticalPct * 100, 0)})</Text>
          <Slider min={0.15} max={0.6} step={0.01} value={criticalPct} onChange={setCriticalPct} />
        </Paper>
        <Paper withBorder radius="md" p="sm">
          <Text size="xs" fw={600}>Alpha Blend ({alphaBlend.toFixed(2)})</Text>
          <Slider min={0.3} max={0.95} step={0.01} value={alphaBlend} onChange={setAlphaBlend} />
        </Paper>
        <Paper withBorder radius="md" p="sm">
          <Select
            label="Airline"
            data={[{ value: "ALL", label: "All" }, { value: hostAirline, label: hostAirline }]}
            value={airlineFilter}
            onChange={(v) => setAirlineFilter(v || "ALL")}
          />
        </Paper>
        <Paper withBorder radius="md" p="sm">
          <Select
            label="Route Drilldown"
            searchable
            data={routesFiltered.map((r) => ({ value: r.route_id, label: r.route_id }))}
            value={selectedRoute || null}
            onChange={(v) => setSelectedRoute(v || "")}
          />
        </Paper>
      </SimpleGrid>

      <Group grow>
        <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">MAPE</Text><Title order={4}>{formatPct(Number(summary?.before?.mape || 0) * 100, 1)}</Title></Paper>
        <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">WMAPE</Text><Title order={4}>{formatPct(Number(summary?.before?.wmape || 0) * 100, 1)}</Title></Paper>
        <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">RMSE</Text><Title order={4}>{formatNumber(summary?.before?.rmse || 0, 1)}</Title></Paper>
        <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">After WMAPE</Text><Title order={4}>{formatPct(Number(summary?.after?.wmape || 0) * 100, 1)}</Title></Paper>
        <Paper withBorder radius="md" p="sm"><Text size="xs" c="dimmed">Flagged Routes</Text><Title order={4}>{(diagnostics.flagged || []).length}</Title></Paper>
      </Group>

      <div className="diag-grid two">
        <div className="diag-card"><h3>O&D Error Heatmap</h3><ErrorHeatmap rows={routesFiltered} /></div>
        <div className="diag-card"><h3>Competitive Misallocation ({routeForDrill?.route_id || "\u2014"})</h3><CompetitiveShareBars route={routeForDrill} /></div>
      </div>

      <div className="diag-grid three">
        <div className="diag-card"><h3>Residual vs Distance</h3><ScatterPlot rows={routesFiltered} xKey="distance" yKey="percentage_error" xLabel="Distance" yLabel="% Error" /></div>
        <div className="diag-card"><h3>Residual vs Actual Pax</h3><ScatterPlot rows={routesFiltered} xKey="actual_pax" yKey="percentage_error" xLabel="Actual Pax" yLabel="% Error" /></div>
        <div className="diag-card"><h3>Residual vs Market Share</h3><ScatterPlot rows={routesFiltered} xKey="predicted_market_share" yKey="share_error" xLabel="Pred Share" yLabel="Share Error" /></div>
      </div>

      <div className="diag-grid two">
        <div className="diag-card">
          <h3>Route Decomposition ({routeForDrill?.route_id || "\u2014"})</h3>
          <WaterfallApprox route={routeForDrill} />
        </div>
        <div className="diag-card">
          <h3>Fix Recommendations</h3>
          <div className="diag-recs">
            {(routeForDrill?.recommendations || []).map((r, idx) => (
              <div key={idx} className="diag-rec-item">
                <div><strong>Reason:</strong> {r.reason}</div>
                <div><strong>Action:</strong> {r.action}</div>
                <div><strong>Track:</strong> {r.metric}</div>
                <div><strong>Confidence:</strong> {(Number(r.confidence || 0) * 100).toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="diag-grid two">
        <Paper withBorder radius="md" p="sm" className="diag-card">
          <Title order={4} mb={8}>Top Over/Under Predicted</Title>
          <ScrollArea h={360}>
            <MantineTable striped highlightOnHover withTableBorder withColumnBorders>
              <MantineTable.Thead><MantineTable.Tr><MantineTable.Th>Route</MantineTable.Th><MantineTable.Th>% Error</MantineTable.Th><MantineTable.Th>Type</MantineTable.Th><MantineTable.Th>Severity</MantineTable.Th></MantineTable.Tr></MantineTable.Thead>
              <MantineTable.Tbody>
                {[...(diagnostics.tables?.overpredicted || []).slice(0, 8), ...(diagnostics.tables?.underpredicted || []).slice(0, 8)].map((r) => (
                  <MantineTable.Tr key={`${r.route_id}-${r.percentage_error}`}>
                    <MantineTable.Td><button className="diag-link-btn" onClick={() => setSelectedRoute(r.route_id)}>{r.route_id}</button></MantineTable.Td>
                    <MantineTable.Td>{formatPct(Number(r.percentage_error || 0) * 100, 1)}</MantineTable.Td>
                    <MantineTable.Td>{r.abnormality_type}</MantineTable.Td>
                    <MantineTable.Td><Badge color={r.severity === "critical" ? "red" : r.severity === "warning" ? "yellow" : "green"} variant="light">{r.severity}</Badge></MantineTable.Td>
                  </MantineTable.Tr>
                ))}
              </MantineTable.Tbody>
            </MantineTable>
          </ScrollArea>
        </Paper>
        <Paper withBorder radius="md" p="sm" className="diag-card">
          <Title order={4} mb={8}>Logit Suggestions: Overall / Segment / Route</Title>
          <ScrollArea h={360}>
            <MantineTable striped highlightOnHover withTableBorder withColumnBorders>
              <MantineTable.Thead><MantineTable.Tr><MantineTable.Th>Level</MantineTable.Th><MantineTable.Th>Entity</MantineTable.Th><MantineTable.Th>Coeff</MantineTable.Th><MantineTable.Th>Delta</MantineTable.Th></MantineTable.Tr></MantineTable.Thead>
              <MantineTable.Tbody>
                {(diagnostics.overallCoeffSuggestions || []).slice(0, 6).map((r) => (
                  <MantineTable.Tr key={`ov-${r.coeff}`}><MantineTable.Td>Overall</MantineTable.Td><MantineTable.Td>All</MantineTable.Td><MantineTable.Td>{r.coeff}</MantineTable.Td><MantineTable.Td>{r.delta >= 0 ? "+" : ""}{Number(r.delta || 0).toFixed(4)}</MantineTable.Td></MantineTable.Tr>
                ))}
                {(diagnostics.segmentLevelModelSuggestions || []).slice(0, 8).flatMap((s) =>
                  (s.coeff_suggestions || []).slice(0, 2).map((c) => (
                    <MantineTable.Tr key={`sg-${s.segment}-${c.coeff}`}><MantineTable.Td>Segment</MantineTable.Td><MantineTable.Td>{s.segment}</MantineTable.Td><MantineTable.Td>{c.coeff}</MantineTable.Td><MantineTable.Td>{c.delta >= 0 ? "+" : ""}{Number(c.delta || 0).toFixed(4)}</MantineTable.Td></MantineTable.Tr>
                  )),
                )}
                {(diagnostics.routeLevelModelSuggestions || []).slice(0, 10).flatMap((r) =>
                  (r.coeff_suggestions || []).slice(0, 1).map((c) => (
                    <MantineTable.Tr key={`rt-${r.od}-${c.coeff}`}><MantineTable.Td>Route</MantineTable.Td><MantineTable.Td>{r.od}</MantineTable.Td><MantineTable.Td>{c.coeff}</MantineTable.Td><MantineTable.Td>{c.delta >= 0 ? "+" : ""}{Number(c.delta || 0).toFixed(4)}</MantineTable.Td></MantineTable.Tr>
                  )),
                )}
              </MantineTable.Tbody>
            </MantineTable>
          </ScrollArea>
        </Paper>
      </div>
    </Stack>
  );
}

const QSI_METRICS = [
  { key: "share",    label: "Share (%)",                      isRelative: false, note: null },
  { key: "nstops",   label: "No of Nonstops",                 isRelative: false, note: null },
  { key: "cncts",    label: "No of Single Online Connections", isRelative: false, note: null },
  { key: "elapScore",label: "Elapsed Time",                   isRelative: true,  note: "derived: market-relative speed advantage" },
  { key: "opp",      label: "OPP",                            isRelative: true,  note: "derived: log frequency ratio vs market avg" },
  { key: "service",  label: "Service",                        isRelative: true,  note: "N/A — requires external model parameters" },
  { key: "equipment",label: "Equipment",                      isRelative: true,  note: "N/A — requires external model parameters" },
  { key: "alnPref",  label: "Airline Preference",             isRelative: true,  note: "N/A — requires survey data" },
  { key: "metroPref",label: "Metro Preference",               isRelative: true,  note: "N/A — requires survey data" },
  { key: "sr",       label: "Service Ratio",                  isRelative: true,  note: "N/A — requires external model parameters" },
  { key: "tow",      label: "TOW",                            isRelative: true,  note: "N/A — requires external model parameters" },
  { key: "relFare",  label: "Relative Fare",                  isRelative: true,  note: "derived: airline yield vs market avg yield" },
  { key: "rsqm",     label: "RSQM",                          isRelative: true,  note: "N/A — residual from demand model" },
];

function QsiBarChart({ qsiRows }) {
  if (!qsiRows.length) return <div className="empty-state">No QSI data available.</div>;
  const colors = PIE_COLORS;
  return (
    <div className="qsi-chart">
      <div className="qsi-header-row">
        <div className="qsi-metric-col" />
        {qsiRows.map((r, i) => (
          <div key={r.code} className="qsi-airline-header" style={{ color: colors[i % colors.length] }}>{r.code}</div>
        ))}
      </div>
      {QSI_METRICS.map((m) => {
        const vals = qsiRows.map((r) => r[m.key] || 0);
        const maxAbs = Math.max(...vals.map(Math.abs), 0.001);
        const allZero = vals.every((v) => v === 0);
        return (
          <div key={m.key} className={`qsi-metric-row ${allZero && m.note ? "qsi-na" : ""}`}>
            <div className="qsi-metric-label">
              <span>{m.label}</span>
              {m.note ? <span className="qsi-note" title={m.note}>ⓘ</span> : null}
            </div>
            <div className="qsi-bars-col">
              {qsiRows.map((r, i) => {
                const v = r[m.key] || 0;
                const pct = Math.abs(v) / maxAbs * 85;
                const isNeg = v < 0;
                const color = colors[i % colors.length];
                const fmt = m.key === "share" ? `${formatNumber(v, 2)}%` : formatNumber(v, 2);
                return (
                  <div key={r.code} className="qsi-bar-line">
                    {m.isRelative ? (
                      <div className="qsi-relative-track">
                        <div className="qsi-neg-half">
                          {isNeg ? <div className="qsi-fill" style={{ width: `${pct}%`, background: color, opacity: allZero ? 0.25 : 1 }} /> : null}
                        </div>
                        <div className="qsi-center-tick" />
                        <div className="qsi-pos-half">
                          {!isNeg ? <div className="qsi-fill" style={{ width: `${pct}%`, background: color, opacity: allZero ? 0.25 : 1 }} /> : null}
                        </div>
                      </div>
                    ) : (
                      <div className="qsi-pos-track">
                        <div className="qsi-fill" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    )}
                    <span className="qsi-val" style={{ color: allZero && m.note ? "var(--text-secondary)" : "var(--text-primary)" }}>
                      {allZero && m.note ? "—" : fmt}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="qsi-footnote">ⓘ = derived from itinerary/flight data · — = requires external model parameters</div>
    </div>
  );
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
    const groups = new Map();
    const marketOd = od.replace("-", "");
    for (const row of itineraryRows) {
      const aln = String(row["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
      const stops = Number(row["Stops"] || 0);
      const freq = countFreqDays(row["Freq"]);
      const demand = Number(row["Total Demand"] || 0);
      const traffic = Number(row["Total Traffic"] || 0);
      const revenue = Number(row["Pax Revenue($)"] || 0);
      const g = groups.get(aln) || { aln, market: marketOd, nstps: 0, thrus: 0, cncts: 0, demand: 0, traffic: 0, revenue: 0 };
      if (stops === 0) g.nstps += freq; else g.cncts += freq;
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
      marketSize: mktDemand,
      demandShare: (r.demand / mktDemand) * 100,
      trafficShare: (r.traffic / mktTraffic) * 100,
      revenueShare: (r.revenue / mktRevenue) * 100,
    }));
  }, [itineraryRows, od]);

  const qsiRows = useMemo(() => {
    const alnMap = new Map();
    for (const row of itineraryRows) {
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
    for (const row of flightRows) {
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
  }, [itineraryRows, flightRows]);

  return (
    <div className="od-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="od-modal">
        <div className="od-modal-header">
          <div>
            <h3>{od} — Market Detail</h3>
            <p>Airline shares · host vs competitors · local/flow mix · direct vs connecting</p>
          </div>
          <button className="od-close-btn" onClick={onClose}>✕</button>
        </div>
        {status === "loading" ? <div className="loading">Loading market data…</div> : (
          <div className="od-modal-body">
            <div className="od-modal-grid">
              <div className="chart-card">
                <div className="chart-head"><h3>Airline Market Share</h3><p>All carriers — share of total traffic</p></div>
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
                        <td>{formatNumber(r.demand, 1)}</td>
                        <td>0.0</td>
                        <td>{formatPct(r.demandShare, 2)}</td>
                        <td>{formatNumber(r.traffic, 1)}</td>
                        <td>{formatNumber(r.traffic, 1)}</td>
                        <td>0.0</td>
                        <td>{formatPct(r.trafficShare, 2)}</td>
                        <td>{formatNumber(r.revenue, 0)}</td>
                        <td>{formatNumber(r.revenue, 0)}</td>
                        <td>0.0</td>
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
                        <td>{r["Connect Point 1"] === "*" ? "—" : r["Connect Point 1"]}</td>
                        <td>{r["Minimum Connect Time 1"] || "—"}</td>
                        <td>{r["Connect Time 1"] || "—"}</td>
                        <td>{r["Flt Desg (Seg2)"] === "*" ? "—" : r["Flt Desg (Seg2)"]}</td>
                        <td>{r["Connect Point 2"] === "*" ? "—" : (r["Connect Point 2"] || "—")}</td>
                        <td>{r["Minimum Connect Time 2"] || "—"}</td>
                        <td>{r["Connect Time 2"] || "—"}</td>
                        <td>{r["Flt Desg (Seg3)"] === "*" ? "—" : (r["Flt Desg (Seg3)"] || "—")}</td>
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

            <div className="od-table-section">
              <div className="od-table-section-head">
                <h4>Competitive Position (QSI Factors)</h4>
                <p>Derived metrics from itinerary &amp; flight data · metrics marked — require external model parameters</p>
              </div>
              <div style={{ padding: "16px" }}>
                <QsiBarChart qsiRows={qsiRows} />
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
  const [selectedOd, setSelectedOd] = useState("");
  const [flightReportRows, setFlightReportRows] = useState([]);
  const [itineraryRows, setItineraryRows] = useState([]);
  const [reportStatus, setReportStatus] = useState("loading");
  const [networkClickedOd, setNetworkClickedOd] = useState(null);
  const [odDetailFlightRows, setOdDetailFlightRows] = useState([]);
  const [odDetailItineraryRows, setOdDetailItineraryRows] = useState([]);
  const [odDetailStatus, setOdDetailStatus] = useState("idle");
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

  const dataBasePath = `/data/worksets/${worksetId}`;

  const odOptions = useMemo(() => (bundle?.level1_host_od_summary || []).map((row) => `${row.orig}-${row.dest}`), [bundle]);

  useEffect(() => {
    if (!odOptions.length) {
      if (selectedOd) setSelectedOd("");
      return;
    }
    if (!selectedOd || !odOptions.includes(selectedOd)) {
      setSelectedOd(odOptions[0]);
    }
  }, [odOptions, selectedOd]);

  const hostPax = (bundle?.level1_host_od_summary || []).reduce((sum, row) => sum + Number(row.apm_weekly_pax_est || row.weekly_pax_est || 0), 0);
  const hostSeats = (bundle?.level1_host_od_summary || []).reduce((sum, row) => sum + Number(row.weekly_seats_est || 0), 0);
  const avgLoadFactor = hostSeats ? (hostPax / hostSeats) * 100 : 0;
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
        localRevenue: 0,
        flowRevenue: 0,
        totalRevenue: 0,
      };
      current.flights += 1;
      current.weeklyDepartures += Number(row.weekly_departures || 0);
      current.localPax += Number(row.spill_local_pax_est || 0);
      current.flowPax += Number(row.spill_flow_pax_est || 0);
      current.totalPax += Number(row.spill_total_pax_est || 0);
      current.localRevenue += Number(row.spill_local_revenue_est || 0);
      current.flowRevenue += Number(row.spill_flow_revenue_est || 0);
      current.totalRevenue += Number(row.spill_total_revenue_est || 0);
      grouped.set(key, current);
    }
    const rows = [...grouped.values()].map((row) => {
      const level1 = level1ByOd.get(row.od);
      const level2 = level2ByOd.get(row.od);
      const marketElapsed = level2?.marketTraffic ? level2.marketElapsedWeighted / level2.marketTraffic : 0;
      const hostElapsed = level2?.hostTraffic ? level2.hostElapsedWeighted / level2.hostTraffic : 0;
      const elapsedTimeDeltaPct = marketElapsed > 0 ? ((hostElapsed - marketElapsed) / marketElapsed) * 100 : 0;
      const demandDenominator = row.totalPax || row.localPax + row.flowPax || 1;
      const revDenominator = row.totalRevenue || row.localRevenue + row.flowRevenue || 1;
      return {
        ...row,
        weeklyPax: Number(level1?.weekly_pax_est || row.totalPax || 0),
        weeklySeats: Number(level1?.weekly_seats_est || 0),
        loadFactorPct: Number(level1?.apm_load_factor_pct_est || level1?.load_factor_pct_est || 0),
        absPaxDiffPct: Number(level1?.abs_total_pax_diff_pct_est || 0),
        absPlfDiffPct: Number(level1?.abs_plf_diff_pct_est || 0),
        flowPddPct: Number(level1?.flow_pdd_pct_est || 0),
        flowApmPct: Number(level1?.flow_apm_pct_est || 0),
        hostSharePct: Number(level1?.host_share_of_market_demand_pct_est || 0),
        predictedMarketSharePct: Number(level2?.hostTrafficSharePct || level1?.host_share_of_market_demand_pct_est || 0),
        actualMarketSharePct: Number(level2?.hostDemandSharePct || 0),
        elapsedTimeDeltaPct,
        localDemandPct: (row.localPax / demandDenominator) * 100,
        flowDemandPct: (row.flowPax / demandDenominator) * 100,
        localRevenuePct: (row.localRevenue / revDenominator) * 100,
        flowRevenuePct: (row.flowRevenue / revDenominator) * 100,
      };
    });
    rows.sort((left, right) => right.totalRevenue - left.totalRevenue);
    return rows;
  }, [bundle]);

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
      "flowPddPct",
      "flowApmPct",
      "absPaxDiffPct",
      "absPlfDiffPct",
      "localRevenue",
      "flowRevenue",
    ];
    const scales = {};
    for (const key of keys) {
      const values = odNetworkRowsFiltered
        .map((row) => Number(row[key]))
        .filter((value) => Number.isFinite(value));
      const max = values.length ? Math.max(...values.map((value) => Math.abs(value))) : 0;
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

  const hostAirline = bundle?.profile?.host_airline || "";
  const networkClickedOdRow = networkClickedOd ? odNetworkRows.find((r) => r.od === networkClickedOd) ?? null : null;

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
  const fvHostFlights = useMemo(() =>
    dedupeBy((bundle?.level3_host_flight_summary || [])
      .filter((r) => {
        const orig = normalizeCode(r.orig);
        const dest = normalizeCode(r.dest);
        return (!fvOrig || orig === fvOrig) && (!fvDest || dest === fvDest);
      })
      .map((r) => {
        const weeklyDeps = Number(r.weekly_departures || 0);
        const seatsPerDep = Number(r.avg_seats_per_departure || 0);
        const observedPax = Number(r.weekly_pax_est || 0);
        const weeklySeats = seatsPerDep * weeklyDeps;
        const lfFromObserved = weeklySeats > 0 ? (observedPax / weeklySeats) * 100 : 0;
        const reportedLf = Number(r.load_factor_pct_est ?? 0);
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
        totalPax: r.spill_total_pax_est,
        localPax: r.spill_local_pax_est,
        flowPax: r.spill_flow_pax_est,
        loadFactor: Number.isFinite(reportedLf) && reportedLf > 0 ? reportedLf : lfFromObserved,
        weeklySeats,
        revenue: r.spill_total_revenue_est,
        avgFare: r.spill_avg_total_fare_est,
      };
      }), (r) => r.key),
  [bundle, fvOrig, fvDest, hostAirline]);

  // Flight View: competitor flights (from fetched data for selected OD)
  const fvCompFlights = useMemo(() =>
    dedupeBy(fvCompFlightRows
      .filter((r) => {
        const aln = String(r["Flt Desg"] || "").trim().split(" ")[0];
        return aln !== hostAirline;
      })
      .map((r) => {
        const weeklyDeps = countFreqDays(r["Freq"]);
        const weeklySeats = Number(r["Seats"] || 0);
        const seatsPerDep = weeklyDeps > 0 ? weeklySeats / weeklyDeps : weeklySeats;
        const observedPax = Number(r["Total Traffic"] || 0);
        const lfFromObserved = weeklySeats > 0 ? (observedPax / weeklySeats) * 100 : 0;
        return {
        isHost: false,
        key: `comp-${r["Flt Desg"]}-${r["Dept Sta"]}-${r["Arvl Sta"]}`,
        airline: String(r["Flt Desg"] || "").trim().split(" ")[0],
        flightNumber: String(r["Flt Desg"] || "").trim(),
        orig: normalizeCode(r["Dept Sta"]), dest: normalizeCode(r["Arvl Sta"]),
        freq: r["Freq"],
        weeklyDeps,
        equipment: r["Subfleet"],
        seatsPerDep,
        deptTime: r["Dept Time"], arvlTime: r["Arvl Time"], elapTime: r["Elap Time"],
        observedPax,
        totalPax: null, localPax: null, flowPax: null,
        loadFactor: lfFromObserved,
        weeklySeats,
        revenue: Number(r["Pax Revenue($)"] || 0),
        avgFare: null,
      };
      }), (r) => r.key),
  [fvCompFlightRows, hostAirline]);

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

  const fvHostRows = useMemo(() => fvFilteredFlights.filter((f) => f.isHost), [fvFilteredFlights]);
  const fvCompRows = useMemo(() => fvFilteredFlights.filter((f) => !f.isHost), [fvFilteredFlights]);

  const fvKpiCards = useMemo(() => {
    const hostFlights = fvHostRows.length;
    const compFlights = fvCompRows.length;
    const hostObservedPax = fvHostRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
    const compObservedPax = fvCompRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
    const hostRevenue = fvHostRows.reduce((sum, f) => sum + Number(f.revenue || 0), 0);
    const compRevenue = fvCompRows.reduce((sum, f) => sum + Number(f.revenue || 0), 0);
    const hostLfAvg = (() => {
      const seats = fvHostRows.reduce((sum, f) => sum + Number(f.weeklySeats || (Number(f.seatsPerDep || 0) * Number(f.weeklyDeps || 0))), 0);
      const pax = fvHostRows.reduce((sum, f) => sum + Number(f.observedPax || 0), 0);
      return seats > 0 ? (pax / seats) * 100 : 0;
    })();
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
      { id: "lf", label: "Avg LF %", host: hostLfAvg, comp: compLfAvg, format: (v) => formatPct(v, 1), accent: false },
      { id: "revenue", label: "Revenue", host: hostRevenue, comp: compRevenue, format: (v) => formatNumber(v, 0), accent: true },
      { id: "fare", label: "Avg Fare", host: hostFareAvg, comp: compFareAvg, format: (v) => formatNumber(v, 0), accent: false },
    ];
  }, [fvHostRows, fvCompRows]);

  const fvNumericScales = useMemo(() => {
    const keys = ["seatsPerDep", "observedPax", "loadFactor", "totalPax", "localPax", "flowPax", "revenue", "avgFare"];
    const scales = {};
    for (const key of keys) {
      const values = fvFilteredFlights
        .map((row) => Number(row[key]))
        .filter((value) => Number.isFinite(value));
      const max = values.length ? Math.max(...values.map((value) => Math.abs(value))) : 0;
      scales[key] = { max };
    }
    return scales;
  }, [fvFilteredFlights]);

  const renderFvNumericCell = (value, key, digits = 1, isPct = false, allowNull = false) => {
    if ((value == null || value === "") && allowNull) return "—";
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

  const fvSelectedFlight = selectedFlightKey ? fvFilteredFlights.find((f) => f.key === selectedFlightKey) ?? null : null;

  // Flow OD rows for the selected host flight
  const fvFlowRows = useMemo(() => {
    if (!fvSelectedFlight?.isHost) return [];
    return (bundle?.flight_spill_breakdown || [])
      .filter((r) => r.flight_number === fvSelectedFlight.flightNumber && r.flight_orig === fvSelectedFlight.orig && r.flight_dest === fvSelectedFlight.dest)
      .filter((r) => Number(r.flow_pax_est || 0) > 0 || Number(r.flow_revenue_est || 0) > 0)
      .map((r) => ({ ...r, label: `${r.flow_orig}–${r.flow_dest}` }))
      .sort((a, b) => Number(b.flow_pax_est || 0) - Number(a.flow_pax_est || 0));
  }, [fvSelectedFlight, bundle]);

  // O&D View: market summary rows
  const odViewMarketRows = useMemo(() => {
    const level2Rows = (bundle?.level2_od_airline_share_summary || [])
      .filter((r) => `${r.orig}-${r.dest}` === selectedOd)
      .map((r) => {
        const traffic = Number(r.total_traffic_est || 0);
        const revenue = Number(r.total_revenue_est || 0);
        return {
          aln: String(r.carrier || "").trim() || "?",
          nstops: Number(r.nonstop_itinerary_count || 0),
          cncts: Number(r.single_connect_itinerary_count || 0),
          demand: Number(r.total_demand_est || 0),
          traffic,
          revenue,
          demandShare: Number(r.demand_share_pct_est || 0),
          trafficShare: Number(r.traffic_share_pct_est || 0),
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
  }, [bundle, itineraryRows, selectedOd]);

  const odViewHostRow = odViewMarketRows.find((r) => r.aln === hostAirline) ?? null;
  const odViewMarketSize = odViewMarketRows.reduce((s, r) => s + r.demand, 0);
  const odViewTotalRevenue = odViewMarketRows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="app-shell app-shell-vision">
      <aside className="sidebar">
        <div className="sidebar-brand"><div><div className="eyebrow">Airline Insights</div><strong>{hostAirline || "—"}</strong></div></div>
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
          avgLoadFactor={avgLoadFactor}
          totalLocalPax={totalLocalPax}
          totalFlowPax={totalFlowPax}
          totalLocalRevenue={totalLocalRevenue}
          totalFlowRevenue={totalFlowRevenue}
        />
      </aside>
      <main className="main-shell">
        <div className="folder-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={tab.id === activeTab ? "folder-tab active" : "folder-tab"}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="folder-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <section className="panel panel-vision">
          {activeTab === "summary" ? <div className="tab-content">
            {reportStatus === "loading" ? <div className="loading">Loading selected OD report data…</div> : null}
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
                { key: "localPax", label: "Local Pax", render: (value) => renderNetworkNumericCell(value, "localPax", 1) },
                { key: "flowPax", label: "Flow Pax", render: (value) => renderNetworkNumericCell(value, "flowPax", 1) },
                { key: "mix", label: "Demand/Revenue Mix", render: (_, row) => <MixFusion demandLocalPct={row.localDemandPct} demandFlowPct={row.flowDemandPct} revenueLocalPct={row.localRevenuePct} revenueFlowPct={row.flowRevenuePct} /> },
                { key: "flowPddPct", label: "Flow PDD %", render: (value) => renderNetworkNumericCell(value, "flowPddPct", 1, true) },
                { key: "flowApmPct", label: "Flow APM %", render: (value) => renderNetworkNumericCell(value, "flowApmPct", 1, true) },
                { key: "absPaxDiffPct", label: "Abs Pax Diff %", render: (value) => renderNetworkNumericCell(value, "absPaxDiffPct", 1, true) },
                { key: "absPlfDiffPct", label: "Abs LF Diff pts", render: (value) => renderNetworkNumericCell(value, "absPlfDiffPct", 1) },
                { key: "localRevenue", label: "Local Revenue", render: (value) => renderNetworkNumericCell(value, "localRevenue", 0) },
                { key: "flowRevenue", label: "Flow Revenue", render: (value) => renderNetworkNumericCell(value, "flowRevenue", 0) },
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
        <span className="fv-comp-hint">Competitor data loaded for {fvOrig}–{fvDest}</span>
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
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Airline</th><th>Flight #</th><th>Orig</th><th>Dest</th>
              <th>Freq</th><th>Wkly Deps</th><th>A/C</th><th>Seats/Dep</th>
              <th>Dept</th><th>Arvl</th><th>Elap</th>
              <th>Obs Pax</th><th>LF %</th>
              <th>Spill Total</th><th>Local Pax</th><th>Flow Pax</th>
              <th>Revenue</th><th>Avg Fare</th>
            </tr>
          </thead>
          <tbody>
            {fvFilteredFlights.length === 0 ? (
              <tr><td colSpan={18} style={{ textAlign: "center", padding: "24px", color: "var(--text-secondary)", fontStyle: "italic" }}>No flights match the selected filters.</td></tr>
            ) : fvFilteredFlights.map((f) => (
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
                <td className="mono">{f.freq || "—"}</td>
                <td>{formatNumber(f.weeklyDeps, 0)}</td>
                <td>{f.equipment || "—"}</td>
                <td>{renderFvNumericCell(f.seatsPerDep, "seatsPerDep", 0)}</td>
                <td>{f.deptTime || "—"}</td>
                <td>{f.arvlTime || "—"}</td>
                <td>{f.elapTime || "—"}</td>
                <td>{renderFvNumericCell(f.observedPax, "observedPax", 1)}</td>
                <td>{renderFvNumericCell(f.loadFactor, "loadFactor", 1, true)}</td>
                <td>{f.isHost ? renderFvNumericCell(f.totalPax, "totalPax", 1) : "—"}</td>
                <td>{f.isHost ? renderFvNumericCell(f.localPax, "localPax", 1) : "—"}</td>
                <td>{f.isHost ? renderFvNumericCell(f.flowPax, "flowPax", 1) : "—"}</td>
                <td>{renderFvNumericCell(f.revenue, "revenue", 0)}</td>
                <td>{f.avgFare != null ? renderFvNumericCell(f.avgFare, "avgFare", 0, false, true) : "—"}</td>
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
    {reportStatus === "loading" ? <div className="loading">Loading O&D data…</div> : null}

    {/* KPI Cards */}
    <div className="odv-kpi-strip">
      <div className="odv-kpi-card accent">
        <div className="odv-kpi-label">Market Size</div>
        <div className="odv-kpi-value">{formatNumber(odViewMarketSize, 1)}</div>
        <div className="odv-kpi-sub">Total demand (all carriers)</div>
      </div>
      <div className="odv-kpi-card host">
        <div className="odv-kpi-label">{hostAirline} Demand Share</div>
        <div className="odv-kpi-value">{odViewHostRow ? formatPct(odViewHostRow.demandShare, 1) : "—"}</div>
        <div className="odv-kpi-sub">{odViewHostRow ? formatNumber(odViewHostRow.demand, 1) + " pax" : "No data"}</div>
      </div>
      <div className="odv-kpi-card host">
        <div className="odv-kpi-label">{hostAirline} Traffic Share</div>
        <div className="odv-kpi-value">{odViewHostRow ? formatPct(odViewHostRow.trafficShare, 1) : "—"}</div>
        <div className="odv-kpi-sub">{odViewHostRow ? formatNumber(odViewHostRow.traffic, 1) + " boarded" : "No data"}</div>
      </div>
      <div className="odv-kpi-card host">
        <div className="odv-kpi-label">{hostAirline} Revenue Share</div>
        <div className="odv-kpi-value">{odViewHostRow ? formatPct(odViewHostRow.revenueShare, 1) : "—"}</div>
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

    {/* Market Summary Table */}
    <div className="odv-section">
      <div className="odv-section-head">
        <h3>Market Report — {selectedOd}</h3>
        <p>Competitive share breakdown by carrier · Pax itinerary view</p>
      </div>
      <div className="table-shell odv-table-shell">
        <table>
          <thead>
            <tr>
              <th>Airline</th>
              <th># Nonstops</th><th># Connections</th>
              <th>Total Demand</th><th>Demand Share %</th>
              <th>Total Traffic</th><th>Traffic Share %</th>
              <th>Pax Revenue</th><th>Revenue Share %</th>
              <th>Avg Fare</th>
            </tr>
          </thead>
          <tbody>
            {odViewMarketRows.length === 0 ? (
              <tr><td colSpan={10} style={{ textAlign: "center", padding: "24px", color: "var(--text-secondary)", fontStyle: "italic" }}>Select an OD to view market data.</td></tr>
            ) : odViewMarketRows.map((r, i) => (
              <tr key={i} className={r.aln === hostAirline ? "odv-host-row" : ""}>
                <td><strong style={{ color: r.aln === hostAirline ? "var(--accent-light)" : "var(--text-primary)" }}>{r.aln}</strong>{r.aln === hostAirline ? <span className="odv-host-badge">HOST</span> : null}</td>
                <td>{r.nstops}</td><td>{r.cncts}</td>
                <td>{formatNumber(r.demand, 1)}</td>
                <td>
                  <div className="odv-share-cell">
                    <div className="odv-share-bar" style={{ width: `${Math.min(r.demandShare, 100)}%`, background: r.aln === hostAirline ? "var(--accent)" : "var(--border-color)" }} />
                    <span>{formatPct(r.demandShare, 1)}</span>
                  </div>
                </td>
                <td>{formatNumber(r.traffic, 1)}</td>
                <td>
                  <div className="odv-share-cell">
                    <div className="odv-share-bar" style={{ width: `${Math.min(r.trafficShare, 100)}%`, background: r.aln === hostAirline ? "var(--accent)" : "var(--border-color)" }} />
                    <span>{formatPct(r.trafficShare, 1)}</span>
                  </div>
                </td>
                <td>{formatNumber(r.revenue, 0)}</td>
                <td>
                  <div className="odv-share-cell">
                    <div className="odv-share-bar" style={{ width: `${Math.min(r.revenueShare, 100)}%`, background: r.aln === hostAirline ? "var(--success)" : "var(--border-color)" }} />
                    <span>{formatPct(r.revenueShare, 1)}</span>
                  </div>
                </td>
                <td>{formatNumber(r.avgFare, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {/* Itinerary Table */}
    <div className="odv-section">
      <div className="odv-section-head">
        <h3>Itineraries — {selectedOd}</h3>
        <p>All itineraries in this market including connections · click row for detail</p>
      </div>
      <div className="table-shell odv-table-shell">
        <table>
          <thead>
            <tr>
              <th>Airline</th>
              <th>Flt (Seg1)</th><th>Cnct Pt 1</th><th>Flt (Seg2)</th><th>Cnct Pt 2</th><th>Flt (Seg3)</th>
              <th>Stops</th><th>Freq</th><th>Dept</th><th>Arvl</th><th>Elap</th>
              <th>Demand</th><th>Traffic</th><th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {itineraryRows.length === 0 ? (
              <tr><td colSpan={14} style={{ textAlign: "center", padding: "24px", color: "var(--text-secondary)", fontStyle: "italic" }}>No itinerary data for this OD.</td></tr>
            ) : itineraryRows.map((r, i) => {
              const aln = String(r["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
              const isHost = aln === hostAirline;
              return (
                <tr key={i} className={`${Number(r["Stops"] || 0) > 0 ? "itin-connecting" : ""} ${isHost ? "odv-host-row" : ""}`}>
                  <td><strong style={{ color: isHost ? "var(--accent-light)" : "var(--text-primary)" }}>{aln}</strong></td>
                  <td>{r["Flt Desg (Seg1)"]}</td>
                  <td>{r["Connect Point 1"] === "*" ? "—" : r["Connect Point 1"] || "—"}</td>
                  <td>{r["Flt Desg (Seg2)"] === "*" ? "—" : r["Flt Desg (Seg2)"] || "—"}</td>
                  <td>{r["Connect Point 2"] === "*" ? "—" : r["Connect Point 2"] || "—"}</td>
                  <td>{r["Flt Desg (Seg3)"] === "*" ? "—" : r["Flt Desg (Seg3)"] || "—"}</td>
                  <td>{r["Stops"]}</td>
                  <td className="mono">{r["Freq"]}</td>
                  <td>{r["Dept Time"]}</td><td>{r["Arvl Time"]}</td><td>{r["Elap Time"]}</td>
                  <td>{formatNumber(r["Total Demand"], 1)}</td>
                  <td>{formatNumber(r["Total Traffic"], 1)}</td>
                  <td>{formatNumber(r["Pax Revenue($)"], 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
) : null}
          {activeTab === "experiment" ? (
  <div className="tab-content">
    <ExperimentSankey
      rows={odNetworkRows}
      hostAirline={hostAirline}
      mlSignals={bundle?.ml_signals || null}
    />
    <CalibrationDiagnosticsPanel
      odRows={odNetworkRowsFiltered.length ? odNetworkRowsFiltered : odNetworkRows}
      bundle={bundle}
      hostAirline={hostAirline}
    />
  </div>
) : null}
        </section>
      </main>
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
                    ? `${hostAirline} ${fvSelectedFlight.flightNumber} — Flow OD Breakdown`
                    : `${fvSelectedFlight.flightNumber} — Flight Details`}
                </h3>
                <p>
                  {fvSelectedFlight.orig} → {fvSelectedFlight.dest} ·{" "}
                  {fvSelectedFlight.isHost ? "Host flight · local & flow pax breakdown" : "Competitor flight · operational metrics"}
                </p>
              </div>
              <button className="od-close-btn" onClick={() => setSelectedFlightKey(null)}>✕</button>
            </div>
            <div className="od-modal-body">
              <div className="fv-detail-stats">
                {fvSelectedFlight.isHost ? (
                  <>
                    <div className="fv-ds"><span>Total Spill Pax</span><strong>{formatNumber(fvSelectedFlight.totalPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Local Pax</span><strong>{formatNumber(fvSelectedFlight.localPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Flow Pax</span><strong>{formatNumber(fvSelectedFlight.flowPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Flow %</span><strong>{fvSelectedFlight.totalPax > 0 ? formatPct((fvSelectedFlight.flowPax / fvSelectedFlight.totalPax) * 100, 1) : "—"}</strong></div>
                    <div className="fv-ds"><span>Load Factor</span><strong>{formatPct(fvSelectedFlight.loadFactor, 1)}</strong></div>
                    <div className="fv-ds"><span>Revenue</span><strong>{formatNumber(fvSelectedFlight.revenue, 0)}</strong></div>
                  </>
                ) : (
                  <>
                    <div className="fv-ds"><span>Weekly Deps</span><strong>{formatNumber(fvSelectedFlight.weeklyDeps, 0)}</strong></div>
                    <div className="fv-ds"><span>A/C Type</span><strong>{fvSelectedFlight.equipment || "—"}</strong></div>
                    <div className="fv-ds"><span>Seats/Dep</span><strong>{formatNumber(fvSelectedFlight.seatsPerDep, 0)}</strong></div>
                    <div className="fv-ds"><span>Observed Pax</span><strong>{formatNumber(fvSelectedFlight.observedPax, 1)}</strong></div>
                    <div className="fv-ds"><span>Load Factor</span><strong>{formatPct(fvSelectedFlight.loadFactor, 1)}</strong></div>
                    <div className="fv-ds"><span>Revenue</span><strong>{formatNumber(fvSelectedFlight.revenue, 0)}</strong></div>
                  </>
                )}
              </div>
              {fvSelectedFlight.isHost ? (
                fvFlowRows.length > 0 ? (
                  <Table
                    columns={[
                      { key: "label", label: "Flow OD", render: (v) => <strong>{v}</strong> },
                      { key: "flow_orig", label: "Flow Orig" },
                      { key: "flow_dest", label: "Flow Dest" },
                      { key: "flow_pax_est", label: "Flow Pax", render: (v) => formatNumber(v, 1) },
                      { key: "flow_revenue_est", label: "Flow Revenue", render: (v) => formatNumber(v, 0) },
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
