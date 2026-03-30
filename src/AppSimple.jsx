import React, { useEffect, useMemo, useState } from "react";
import initialBundle from "./generated/dashboard_bundle.json";

const tabs = [
  { id: "summary", label: "Network" },
  { id: "flightView", label: "Flight View" },
  { id: "odView", label: "O&D View" },
];

function formatNumber(value, digits = 0) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(num);
}

function formatPct(value, digits = 1) {
  return `${formatNumber(value, digits)}%`;
}

function parseClockToMinutes(value) {
  const text = String(value || "").trim();
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const [hours, mins] = text.split(":").map(Number);
  return hours * 60 + mins;
}

function computeSlack(actual, minimum) {
  const actualMinutes = parseClockToMinutes(actual);
  const minimumMinutes = parseClockToMinutes(minimum);
  return actualMinutes !== null && minimumMinutes !== null ? actualMinutes - minimumMinutes : null;
}

function fetchJson(path) {
  return fetch(path).then((response) => {
    if (!response.ok) throw new Error(path);
    return response.json();
  });
}

function activeDaysFromFreq(freq) {
  return String(freq || "").split("").map((char, index) => ({ char, index })).filter((item) => item.char !== ".").map((item) => item.index);
}

function parseElapsedToMinutes(elap) {
  const parts = String(elap || "0:0").split(":").map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function timeBucketLabel(hhmm) {
  const text = String(hhmm || "");
  const hour = Number(text.split(":")[0] || 0);
  if (hour < 4) return "00-03";
  if (hour < 8) return "04-07";
  if (hour < 12) return "08-11";
  if (hour < 16) return "12-15";
  if (hour < 20) return "16-19";
  return "20-23";
}

function Tile({ label, value, sub, accent = false }) {
  return (
    <div className={`tile ${accent ? "tile-accent" : ""}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-subtext">{sub}</div>
    </div>
  );
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

function SectionHeading({ title, subtitle }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function NetworkScorecard({ hostAirline, hostPax, hostSeats, avgLoadFactor, totalLocalPax, totalFlowPax, totalLocalRevenue, totalFlowRevenue }) {
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
  let angle = -Math.PI / 2;
  const paths = slices
    .filter((s) => s.value > 0)
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
  const [selectedOd, setSelectedOd] = useState("BLR-KLH");
  const [flightReportRows, setFlightReportRows] = useState([]);
  const [itineraryRows, setItineraryRows] = useState([]);
  const [reportStatus, setReportStatus] = useState("loading");
  const [networkClickedOd, setNetworkClickedOd] = useState(null);
  const [odDetailFlightRows, setOdDetailFlightRows] = useState([]);
  const [odDetailItineraryRows, setOdDetailItineraryRows] = useState([]);
  const [odDetailStatus, setOdDetailStatus] = useState("idle");

  // Flight View state
  const [fvOrig, setFvOrig] = useState("");
  const [fvDest, setFvDest] = useState("");
  const [fvAirlineFilter, setFvAirlineFilter] = useState("all");
  const [selectedFlightKey, setSelectedFlightKey] = useState(null);
  const [fvCompFlightRows, setFvCompFlightRows] = useState([]);

  // Workset state
  const defaultWorksetId = initialBundle?.profile?.workset || "WORKSET12061";
  const [bundle, setBundle] = useState(initialBundle);
  const [worksets, setWorksets] = useState([{ id: defaultWorksetId, label: defaultWorksetId }]);
  const [worksetId, setWorksetId] = useState(defaultWorksetId);
  const [worksetLoading, setWorksetLoading] = useState(false);

  // Load worksets index once
  useEffect(() => {
    fetchJson("/data/worksets/index.json")
      .then((data) => { if (Array.isArray(data) && data.length) setWorksets(data); })
      .catch(() => { /* keep default */ });
  }, []);

  // When workset changes, load bundle
  useEffect(() => {
    if (worksetId === defaultWorksetId) {
      setBundle(initialBundle);
    } else {
      setWorksetLoading(true);
      fetchJson(`/data/worksets/${worksetId}/bundle.json`)
        .then((data) => { setBundle(data); setWorksetLoading(false); })
        .catch(() => setWorksetLoading(false));
    }
  }, [worksetId]);

  const dataBasePath = `/data/worksets/${worksetId}`;

  const odOptions = useMemo(() => (bundle?.level1_host_od_summary || []).map((row) => `${row.orig}-${row.dest}`), [bundle]);
  const hostPax = (bundle?.level1_host_od_summary || []).reduce((sum, row) => sum + Number(row.weekly_pax_est || 0), 0);
  const hostSeats = (bundle?.level1_host_od_summary || []).reduce((sum, row) => sum + Number(row.weekly_seats_est || 0), 0);
  const avgLoadFactor = hostSeats ? (hostPax / hostSeats) * 100 : 0;
  const odNetworkRows = useMemo(() => {
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
      const demandDenominator = row.totalPax || row.localPax + row.flowPax || 1;
      const revDenominator = row.totalRevenue || row.localRevenue + row.flowRevenue || 1;
      return {
        ...row,
        localDemandPct: (row.localPax / demandDenominator) * 100,
        flowDemandPct: (row.flowPax / demandDenominator) * 100,
        localRevenuePct: (row.localRevenue / revDenominator) * 100,
        flowRevenuePct: (row.flowRevenue / revDenominator) * 100,
      };
    });
    rows.sort((left, right) => right.totalRevenue - left.totalRevenue);
    return rows;
  }, [bundle]);
  const totalLocalPax = odNetworkRows.reduce((sum, row) => sum + row.localPax, 0);
  const totalFlowPax = odNetworkRows.reduce((sum, row) => sum + row.flowPax, 0);
  const totalLocalRevenue = odNetworkRows.reduce((sum, row) => sum + row.localRevenue, 0);
  const totalFlowRevenue = odNetworkRows.reduce((sum, row) => sum + row.flowRevenue, 0);

  useEffect(() => {
    let cancelled = false;
    setReportStatus("loading");
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
    return () => { cancelled = true; };
  }, [selectedOd, dataBasePath]);

  useEffect(() => {
    if (!networkClickedOd) return;
    let cancelled = false;
    setOdDetailStatus("loading");
    setOdDetailFlightRows([]);
    setOdDetailItineraryRows([]);
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
    return () => { cancelled = true; };
  }, [networkClickedOd]);

  const hostAirline = bundle?.profile?.host_airline || "";
  const networkClickedOdRow = networkClickedOd ? odNetworkRows.find((r) => r.od === networkClickedOd) ?? null : null;

  // Load competitor flights for Flight View when origin+dest both selected
  useEffect(() => {
    if (!fvOrig || !fvDest) { setFvCompFlightRows([]); return; }
    const od = `${fvOrig}-${fvDest}`;
    let cancelled = false;
    fetchJson(`${dataBasePath}/flight-report-db/${od}.json`)
      .then((data) => { if (!cancelled) setFvCompFlightRows(data); })
      .catch(() => { if (!cancelled) setFvCompFlightRows([]); });
    return () => { cancelled = true; };
  }, [fvOrig, fvDest, dataBasePath]);

  // Flight View: unique origins from all host flights
  const fvOrigOptions = useMemo(() =>
    [...new Set((bundle?.level3_host_flight_summary || []).map((r) => r.orig))].sort(),
  [bundle]);

  // Flight View: destinations filtered by selected origin
  const fvDestOptions = useMemo(() => {
    const all = bundle?.level3_host_flight_summary || [];
    const dests = fvOrig
      ? [...new Set(all.filter((r) => r.orig === fvOrig).map((r) => r.dest))]
      : [...new Set(all.map((r) => r.dest))];
    return dests.sort();
  }, [bundle, fvOrig]);

  // Flight View: host flights (from bundle, filtered)
  const fvHostFlights = useMemo(() =>
    (bundle?.level3_host_flight_summary || [])
      .filter((r) => (!fvOrig || r.orig === fvOrig) && (!fvDest || r.dest === fvDest))
      .map((r) => ({
        isHost: true,
        key: `${hostAirline}-${r.flight_number}-${r.orig}-${r.dest}`,
        airline: hostAirline,
        flightNumber: r.flight_number,
        orig: r.orig, dest: r.dest,
        freq: null,
        weeklyDeps: r.weekly_departures,
        equipment: r.equipment,
        seatsPerDep: r.avg_seats_per_departure,
        deptTime: null, arvlTime: null, elapTime: null,
        observedPax: r.weekly_pax_est,
        totalPax: r.spill_total_pax_est,
        localPax: r.spill_local_pax_est,
        flowPax: r.spill_flow_pax_est,
        loadFactor: r.load_factor_pct_est,
        revenue: r.spill_total_revenue_est,
        avgFare: r.spill_avg_total_fare_est,
      })),
  [bundle, fvOrig, fvDest, hostAirline]);

  // Flight View: competitor flights (from fetched data for selected OD)
  const fvCompFlights = useMemo(() =>
    fvCompFlightRows
      .filter((r) => {
        const aln = String(r["Flt Desg"] || "").trim().split(" ")[0];
        return aln !== hostAirline;
      })
      .map((r) => ({
        isHost: false,
        key: `comp-${r["Flt Desg"]}-${r["Dept Sta"]}-${r["Arvl Sta"]}`,
        airline: String(r["Flt Desg"] || "").trim().split(" ")[0],
        flightNumber: String(r["Flt Desg"] || "").trim(),
        orig: r["Dept Sta"], dest: r["Arvl Sta"],
        freq: r["Freq"],
        weeklyDeps: countFreqDays(r["Freq"]),
        equipment: r["Subfleet"],
        seatsPerDep: Number(r["Seats"] || 0),
        deptTime: r["Dept Time"], arvlTime: r["Arvl Time"], elapTime: r["Elap Time"],
        observedPax: Number(r["Total Traffic"] || 0),
        totalPax: null, localPax: null, flowPax: null,
        loadFactor: Number(r["Load Factor (%)"] || 0),
        revenue: Number(r["Pax Revenue($)"] || 0),
        avgFare: null,
      })),
  [fvCompFlightRows, hostAirline]);

  // Flight View: combined and filtered
  const fvFilteredFlights = useMemo(() => {
    let result = [];
    if (fvAirlineFilter !== "competitors") result = [...fvHostFlights];
    if (fvAirlineFilter !== "host") result = [...result, ...fvCompFlights];
    return result.sort((a, b) => {
      if (a.isHost && !b.isHost) return -1;
      if (!a.isHost && b.isHost) return 1;
      return (a.orig + a.dest + a.flightNumber).localeCompare(b.orig + b.dest + b.flightNumber);
    });
  }, [fvHostFlights, fvCompFlights, fvAirlineFilter]);

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
      g.demand += demand; g.traffic += traffic; g.revenue += revenue;
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
      mktDemand, mktTraffic, mktRevenue,
    }));
  }, [itineraryRows]);

  const odViewHostRow = odViewMarketRows.find((r) => r.aln === hostAirline) ?? null;
  const odViewMarketSize = odViewMarketRows.reduce((s, r) => s + r.demand, 0);
  const odViewTotalRevenue = odViewMarketRows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="app-shell app-shell-vision">
      <aside className="sidebar">
        <div className="sidebar-brand"><div><div className="eyebrow">Airline Insights</div><strong>{hostAirline || "—"} Ops Studio</strong></div></div>
        <nav className="tabs sidebar-tabs">
          {tabs.map((tab) => <button key={tab.id} className={tab.id === activeTab ? "tab active" : "tab"} onClick={() => setActiveTab(tab.id)}><span>{tab.label}</span></button>)}
        </nav>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div><div className="eyebrow">Command view</div><h1>{tabs.find((tab) => tab.id === activeTab)?.label}{worksetLoading ? <span className="workset-loading-badge">Loading…</span> : null}</h1></div>
          <div className="topbar-controls">
            {worksets.length > 1 ? (
              <div className="selector-wrap">
                <label htmlFor="workset-selector">Workset</label>
                <select id="workset-selector" value={worksetId} onChange={(e) => { setWorksetId(e.target.value); setNetworkClickedOd(null); }}>
                  {worksets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </div>
            ) : null}
            {activeTab === "odView" ? (
              <div className="selector-wrap topbar-selector">
                <label htmlFor="od-selector">Selected OD</label>
                <select id="od-selector" value={selectedOd} onChange={(event) => setSelectedOd(event.target.value)}>
                  {odOptions.map((od) => <option key={od} value={od}>{od}</option>)}
                </select>
              </div>
            ) : null}
          </div>
        </header>

        <NetworkScorecard
          hostAirline={hostAirline}
          hostPax={hostPax}
          hostSeats={hostSeats}
          avgLoadFactor={avgLoadFactor}
          totalLocalPax={totalLocalPax}
          totalFlowPax={totalFlowPax}
          totalLocalRevenue={totalLocalRevenue}
          totalFlowRevenue={totalFlowRevenue}
        />

        <section className="panel panel-vision">
          {activeTab === "summary" ? <div className="tab-content">
            {reportStatus === "loading" ? <div className="loading">Loading selected OD report data…</div> : null}
            <Table
              columns={[
                { key: "od", label: "OD", render: (value) => <strong>{value}</strong> },
                { key: "weeklyDepartures", label: "Wkly Deps", render: (value) => formatNumber(value, 0) },
                { key: "localPax", label: "Local Pax", render: (value) => formatNumber(value, 1) },
                { key: "flowPax", label: "Flow Pax", render: (value) => formatNumber(value, 1) },
                { key: "demandMix", label: "Demand Mix", render: (_, row) => <SplitBar localPct={row.localDemandPct} flowPct={row.flowDemandPct} /> },
                { key: "localRevenue", label: "Local Revenue", render: (value) => formatNumber(value, 0) },
                { key: "flowRevenue", label: "Flow Revenue", render: (value) => formatNumber(value, 0) },
                { key: "revenueMix", label: "Revenue Mix", render: (_, row) => <SplitBar localPct={row.localRevenuePct} flowPct={row.flowRevenuePct} /> },
              ]}
              rows={odNetworkRows}
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
        <select className="fv-filter-select" value={fvOrig} onChange={(e) => { setFvOrig(e.target.value); setFvDest(""); setSelectedFlightKey(null); }}>
          <option value="">All Origins</option>
          {fvOrigOptions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="fv-filter-item">
        <label className="fv-filter-label">Destination</label>
        <select className="fv-filter-select" value={fvDest} onChange={(e) => { setFvDest(e.target.value); setSelectedFlightKey(null); }}>
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
        <div className="fv-kpi-card">
          <div className="fv-kpi-label">{hostAirline} Flights</div>
          <div className="fv-kpi-value">{fvFilteredFlights.filter((f) => f.isHost).length}</div>
        </div>
        <div className="fv-kpi-card">
          <div className="fv-kpi-label">Competitor Flights</div>
          <div className="fv-kpi-value">{fvFilteredFlights.filter((f) => !f.isHost).length}</div>
        </div>
        <div className="fv-kpi-card">
          <div className="fv-kpi-label">{hostAirline} Weekly Pax</div>
          <div className="fv-kpi-value">{formatNumber(fvFilteredFlights.filter((f) => f.isHost).reduce((s, f) => s + (f.totalPax || 0), 0), 1)}</div>
        </div>
        <div className="fv-kpi-card">
          <div className="fv-kpi-label">{hostAirline} Local Pax</div>
          <div className="fv-kpi-value">{formatNumber(fvFilteredFlights.filter((f) => f.isHost).reduce((s, f) => s + (f.localPax || 0), 0), 1)}</div>
        </div>
        <div className="fv-kpi-card">
          <div className="fv-kpi-label">{hostAirline} Flow Pax</div>
          <div className="fv-kpi-value">{formatNumber(fvFilteredFlights.filter((f) => f.isHost).reduce((s, f) => s + (f.flowPax || 0), 0), 1)}</div>
        </div>
        <div className="fv-kpi-card accent">
          <div className="fv-kpi-label">{hostAirline} Revenue</div>
          <div className="fv-kpi-value">{formatNumber(fvFilteredFlights.filter((f) => f.isHost).reduce((s, f) => s + (f.revenue || 0), 0), 0)}</div>
        </div>
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
                <td>{f.orig}</td><td>{f.dest}</td>
                <td className="mono">{f.freq || "—"}</td>
                <td>{formatNumber(f.weeklyDeps, 0)}</td>
                <td>{f.equipment || "—"}</td>
                <td>{formatNumber(f.seatsPerDep, 0)}</td>
                <td>{f.deptTime || "—"}</td>
                <td>{f.arvlTime || "—"}</td>
                <td>{f.elapTime || "—"}</td>
                <td>{formatNumber(f.observedPax, 1)}</td>
                <td>{formatPct(f.loadFactor, 1)}</td>
                <td>{f.isHost ? formatNumber(f.totalPax, 1) : "—"}</td>
                <td>{f.isHost ? formatNumber(f.localPax, 1) : "—"}</td>
                <td>{f.isHost ? formatNumber(f.flowPax, 1) : "—"}</td>
                <td>{formatNumber(f.revenue, 0)}</td>
                <td>{f.avgFare != null ? formatNumber(f.avgFare, 0) : "—"}</td>
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
      <div className="table-shell">
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
      <div className="table-shell">
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
