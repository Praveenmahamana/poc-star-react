import React, { useEffect, useMemo, useState } from "react";
import initialBundle from "./generated/dashboard_bundle.json";

const tabs = [
  { id: "summary", label: "Network" },
  { id: "flight", label: "Flight View" },
  { id: "flightReport", label: "Flight Report" },
  { id: "itineraryReport", label: "Itinerary Report" },
  { id: "preferences", label: "Preferences" },
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

function ScheduleHeatmap({ rows, title }) {
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const bucketLabels = ["00-03", "04-07", "08-11", "12-15", "16-19", "20-23"];
  const matrix = bucketLabels.map((bucket) =>
    dayLabels.map((_, dayIndex) => rows.reduce((sum, row) => sum + (timeBucketLabel(row["Dept Time"]) === bucket && activeDaysFromFreq(row["Freq"]).includes(dayIndex) ? 1 : 0), 0)),
  );
  const maxValue = Math.max(...matrix.flat(), 1);
  return (
    <div className="chart-card">
      <div className="chart-head"><h3>{title}</h3><p>Weekly frequency by departure time and weekday.</p></div>
      {!rows.length ? <div className="empty-state">No rows available.</div> : null}
      {rows.length ? <div className="heatmap-shell">
        <div className="heatmap-grid heatmap-header"><div />{dayLabels.map((day) => <div key={day} className="heatmap-axis-label">{day}</div>)}</div>
        {bucketLabels.map((bucket, rowIndex) => (
          <div key={bucket} className="heatmap-grid">
            <div className="heatmap-axis-label">{bucket}</div>
            {matrix[rowIndex].map((value, colIndex) => (
              <div key={`${bucket}-${colIndex}`} className="heatmap-cell" style={{ background: `rgba(32, 101, 209, ${0.08 + (value / maxValue) * 0.72})` }}>
                {value ? formatNumber(value, 0) : ""}
              </div>
            ))}
          </div>
        ))}
      </div> : null}
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

  // Workset state
  const defaultWorksetId = initialBundle?.profile?.workset || "WORKSET12061";
  const [bundle, setBundle] = useState(initialBundle);
  const [worksets, setWorksets] = useState([{ id: defaultWorksetId, label: defaultWorksetId }]);
  const [worksetId, setWorksetId] = useState(defaultWorksetId);
  const [worksetLoading, setWorksetLoading] = useState(false);

  // Preference data
  const [alnPrefData, setAlnPrefData] = useState([]);
  const [alliancePrefData, setAlliancePrefData] = useState([]);
  const [relfarePrefData, setRelfarePrefData] = useState([]);

  // Load worksets index once
  useEffect(() => {
    fetchJson("/data/worksets/index.json")
      .then((data) => { if (Array.isArray(data) && data.length) setWorksets(data); })
      .catch(() => { /* keep default */ });
  }, []);

  // When workset changes, load bundle + preferences
  useEffect(() => {
    if (worksetId === defaultWorksetId) {
      setBundle(initialBundle);
    } else {
      setWorksetLoading(true);
      fetchJson(`/data/worksets/${worksetId}/bundle.json`)
        .then((data) => { setBundle(data); setWorksetLoading(false); })
        .catch(() => setWorksetLoading(false));
    }
    Promise.all([
      fetchJson(`/data/worksets/${worksetId}/alnPref.json`).catch(() => []),
      fetchJson(`/data/worksets/${worksetId}/alliancePref.json`).catch(() => []),
      fetchJson(`/data/worksets/${worksetId}/relfarePref.json`).catch(() => []),
    ]).then(([a, al, r]) => { setAlnPrefData(a); setAlliancePrefData(al); setRelfarePrefData(r); });
  }, [worksetId]);

  const dataBasePath = `/data/worksets/${worksetId}`;

  const odOptions = useMemo(() => (bundle?.level1_host_od_summary || []).map((row) => `${row.orig}-${row.dest}`), [bundle]);
  const [selectedOrig, selectedDest] = selectedOd.split("-");
  const flightRows = (bundle?.level3_host_flight_summary || []).filter((row) => row.orig === selectedOrig && row.dest === selectedDest);
  const flowRows = (bundle?.flight_spill_breakdown || []).filter((row) => row.flight_orig === selectedOrig && row.flight_dest === selectedDest);
  const primaryFlight = [...flightRows].sort((left, right) => Number(right.spill_total_pax_est || 0) - Number(left.spill_total_pax_est || 0))[0];
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
  const odDemandContributionRows = null;
  const odRevenueContributionRows = null;

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
  const hostFlightReportRows = flightReportRows.filter((row) => String(row["Flt Desg"] || "").trim().startsWith(`${hostAirline} `));
  const competitorFlightReportRows = flightReportRows.filter((row) => !String(row["Flt Desg"] || "").trim().startsWith(`${hostAirline} `));
  const networkClickedOdRow = networkClickedOd ? odNetworkRows.find((r) => r.od === networkClickedOd) ?? null : null;

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
            {activeTab !== "summary" ? (
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
            <div className="two-column-grid">
              <ScheduleHeatmap rows={hostFlightReportRows} title={`Host weekly departure heatmap (${selectedOd})`} />
              <ScheduleHeatmap rows={competitorFlightReportRows} title={`Competitor weekly departure heatmap (${selectedOd})`} />
            </div>
          </div> : null}

          {activeTab === "flight" ? <div className="tab-content">
            <SectionHeading title={`Flight View: ${selectedOd}`} subtitle="Host flight-level view with spill-adjusted metrics." />
            <div className="tile-grid five-up">
              <Tile label="Observed Leg Pax" value={primaryFlight ? formatNumber(primaryFlight.weekly_pax_est, 1) : "NA"} sub="From BASEDATA" accent />
              <Tile label="Spill Total Pax" value={primaryFlight ? formatNumber(primaryFlight.spill_total_pax_est, 1) : "NA"} sub="Local plus flow" />
              <Tile label="Spill Local Pax" value={primaryFlight ? formatNumber(primaryFlight.spill_local_pax_est, 1) : "NA"} sub="Local contribution" />
              <Tile label="Spill Flow Pax" value={primaryFlight ? formatNumber(primaryFlight.spill_flow_pax_est, 1) : "NA"} sub="Flow contribution" />
              <Tile label="Spill LF" value={primaryFlight ? formatPct(primaryFlight.spill_load_factor_pct_est, 1) : "NA"} sub="Spill-adjusted LF" />
            </div>
            <Table
              columns={[
                { key: "flight_number", label: "Flight" },
                { key: "weekly_departures", label: "Wkly Deps", render: (value) => formatNumber(value, 0) },
                { key: "weekly_pax_est", label: "Observed Pax", render: (value) => formatNumber(value, 1) },
                { key: "spill_total_pax_est", label: "Spill Total Pax", render: (value) => formatNumber(value, 1) },
                { key: "spill_local_pax_est", label: "Local Pax", render: (value) => formatNumber(value, 1) },
                { key: "spill_flow_pax_est", label: "Flow Pax", render: (value) => formatNumber(value, 1) },
              ]}
              rows={flightRows}
              emptyMessage="No host flight rows found for this directional OD."
            />
            <Table
              columns={[
                { key: "label", label: "Flow OD" },
                { key: "flow_pax_est", label: "Flow Pax", render: (value) => formatNumber(value, 1) },
                { key: "flow_revenue_est", label: "Flow Revenue", render: (value) => formatNumber(value, 0) },
              ]}
              rows={primaryFlight ? flowRows.filter((row) => row.flight_number === primaryFlight.flight_number).map((row) => ({ ...row, label: `${row.flow_orig}-${row.flow_dest}` })) : []}
              emptyMessage="No spill flow contributors for the primary host flight."
            />
          </div> : null}

          {activeTab === "flightReport" ? <div className="tab-content">
            <SectionHeading title={`Flight Report: ${selectedOd}`} subtitle="OD-level flight report table." />
            <Table
              columns={[
                { key: "Dept Sta", label: "Dept Sta" },
                { key: "Arvl Sta", label: "Arvl Sta" },
                { key: "Flt Desg", label: "Flt Desg" },
                { key: "Freq", label: "Freq" },
                { key: "Dept Time", label: "Dept Time" },
                { key: "Arvl Time", label: "Arvl Time" },
                { key: "Elap Time", label: "Elap Time" },
                { key: "Subfleet", label: "Subfleet" },
                { key: "Seats", label: "Seats", render: (value) => formatNumber(value, 0) },
                { key: "Distance(km)", label: "Distance", render: (value) => formatNumber(value, 0) },
                { key: "Total Demand", label: "Total Demand", render: (value) => formatNumber(value, 2) },
                { key: "Total Traffic", label: "Total Traffic", render: (value) => formatNumber(value, 2) },
                { key: "Lcl Demand (Mktd)", label: "Local Demand", render: (value) => formatNumber(value, 2) },
                { key: "Lcl Traffic", label: "Local Traffic", render: (value) => formatNumber(value, 2) },
                { key: "Load Factor (%)", label: "LF %", render: (value) => formatPct(value, 1) },
                { key: "Pax Revenue($)", label: "Pax Revenue", render: (value) => formatNumber(value, 0) },
                { key: "Total Revenue($)", label: "Total Revenue", render: (value) => formatNumber(value, 0) },
                { key: "Total Yield(Cents per RPk)", label: "Yield", render: (value) => formatNumber(value, 1) },
              ]}
              rows={flightReportRows}
              emptyMessage="No flight report rows were generated for this OD."
            />
          </div> : null}

          {activeTab === "itineraryReport" ? <div className="tab-content">
            <SectionHeading title={`Itinerary Report: ${selectedOd}`} subtitle="OD-level itinerary report table plus simple connection diagnostics." />
            <Table
              columns={[
                { key: "Dept Arp", label: "Dept Arp" },
                { key: "Arvl Arp", label: "Arvl Arp" },
                { key: "Flt Desg (Seg1)", label: "Flt Desg (Seg1)" },
                { key: "Connect Point 1", label: "Connect Point 1" },
                { key: "Minimum Connect Time 1", label: "Min Connect 1" },
                { key: "Connect Time 1", label: "Connect Time 1" },
                { key: "Flt Desg (Seg2)", label: "Flt Desg (Seg2)" },
                { key: "Stops", label: "Stops", render: (value) => formatNumber(value, 0) },
                { key: "Freq", label: "Freq" },
                { key: "Elap Time", label: "Elap Time" },
                { key: "Total Demand", label: "Total Demand", render: (value) => formatNumber(value, 2) },
                { key: "Total Traffic", label: "Total Traffic", render: (value) => formatNumber(value, 2) },
                { key: "Pax Revenue($)", label: "Pax Revenue", render: (value) => formatNumber(value, 0) },
              ]}
              rows={itineraryRows}
              emptyMessage="No itinerary report rows were generated for this OD."
            />
            <Table
              columns={[
                { key: "label", label: "Connection Itinerary" },
                { key: "slack1", label: "Slack 1", render: (value) => (value === null ? "NA" : `${value >= 0 ? "+" : ""}${formatNumber(value, 0)} min`) },
              ]}
              rows={itineraryRows.filter((row) => Number(row["Stops"] || 0) > 0).map((row) => ({ ...row, label: `${row["Flt Desg (Seg1)"]} + ${row["Flt Desg (Seg2)"]}`, slack1: computeSlack(row["Connect Time 1"], row["Minimum Connect Time 1"]) }))}
              emptyMessage="No connecting itineraries were generated for this OD."
            />
          </div> : null}

          {activeTab === "preferences" ? <div className="tab-content">
            <SectionHeading title="Workset Preferences" subtitle={`Preference parameters loaded for workset ${worksetId}.`} />

            <div className="pref-section">
              <h3 className="pref-section-title">Relative Fare Preferences <span className="pref-count">({relfarePrefData.length} rows)</span></h3>
              <p className="pref-section-desc">Airline-specific fare adjustment factors by O&amp;D and entity. HOVAL/LOVAL = high/low pax value; HRVAL/LRVAL = high/low revenue value.</p>
              {relfarePrefData.length ? (
                <div className="pref-table-wrap">
                  <table className="pref-table">
                    <thead><tr>
                      <th>Org Lvl</th><th>Org</th><th>Dest Lvl</th><th>Dest</th><th>Entity</th>
                      <th>Airline</th><th>Day Qtr</th><th>Hi Pax Val</th><th>Lo Pax Val</th><th>Hi Rev Val</th><th>Lo Rev Val</th>
                    </tr></thead>
                    <tbody>{relfarePrefData.map((r, i) => (
                      <tr key={i}>
                        <td>{r["ORGLVL"]}</td><td>{r["ORG"]}</td><td>{r["DESTLVL"]}</td><td>{r["DEST"]}</td><td>{r["ENTNM"]}</td>
                        <td><strong>{r["ALN"]}</strong></td><td>{r["DAYQTR"]}</td>
                        <td className="pref-val">{r["HOVAL"]}</td><td className="pref-val">{r["LOVAL"]}</td>
                        <td className="pref-val">{r["HRVAL"]}</td><td className="pref-val">{r["LRVAL"]}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="pref-empty">No relative fare preference data found for this workset.</div>}
            </div>

            <div className="pref-section">
              <h3 className="pref-section-title">Airline Preferences <span className="pref-count">({alnPrefData.length} rows)</span></h3>
              <p className="pref-section-desc">Airline preference factors by O&amp;D, entity, and connection type. HOVAL/LOVAL = high/low pax value; HRVAL/LRVAL = high/low revenue value.</p>
              {alnPrefData.length ? (
                <div className="pref-table-wrap">
                  <table className="pref-table">
                    <thead><tr>
                      <th>Org Lvl</th><th>Org</th><th>Dest Lvl</th><th>Dest</th><th>Entity</th>
                      <th>Connect Lvl</th><th>Connect Code</th><th>Airline</th>
                      <th>Hi Pax Val</th><th>Lo Pax Val</th><th>Hi Rev Val</th><th>Lo Rev Val</th>
                    </tr></thead>
                    <tbody>{alnPrefData.map((r, i) => (
                      <tr key={i}>
                        <td>{r["ORGLVL"]}</td><td>{r["ORG"]}</td><td>{r["DESTLVL"]}</td><td>{r["DEST"]}</td><td>{r["ENTNM"]}</td>
                        <td>{r["CONNECTLVL"]}</td><td>{r["CONNECTCODE"]}</td><td><strong>{r["ALN"]}</strong></td>
                        <td className="pref-val">{r["HOVAL"]}</td><td className="pref-val">{r["LOVAL"]}</td>
                        <td className="pref-val">{r["HRVAL"]}</td><td className="pref-val">{r["LRVAL"]}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="pref-empty">No airline preference data found for this workset.</div>}
            </div>

            <div className="pref-section">
              <h3 className="pref-section-title">Alliance Preferences <span className="pref-count">({alliancePrefData.length} rows)</span></h3>
              <p className="pref-section-desc">Alliance preference scores for nonstop (NSTOP), connecting (CONN), and interline (INTR) service by geography and entity. H/L = high/low pax; HR/LR = high/low revenue.</p>
              {alliancePrefData.length ? (
                <div className="pref-table-wrap">
                  <table className="pref-table">
                    <thead><tr>
                      <th>Alliance</th><th>Org Lvl</th><th>Org</th><th>Dest Lvl</th><th>Dest</th><th>Entity</th>
                      <th>HO Nstop</th><th>LO Nstop</th><th>HR Nstop</th><th>LR Nstop</th>
                      <th>HO Conn</th><th>LO Conn</th><th>HR Conn</th><th>LR Conn</th>
                      <th>HO Intr</th><th>LO Intr</th><th>HR Intr</th><th>LR Intr</th>
                    </tr></thead>
                    <tbody>{alliancePrefData.map((r, i) => (
                      <tr key={i}>
                        <td><strong>{r["ALLNCENM"]}</strong></td>
                        <td>{r["ORGLVL"]}</td><td>{r["ORG"]}</td><td>{r["DESTLVL"]}</td><td>{r["DEST"]}</td><td>{r["ENTNM"]}</td>
                        <td className="pref-val">{r["HONSTOP"]}</td><td className="pref-val">{r["LONSTOP"]}</td>
                        <td className="pref-val">{r["HRNSTOP"]}</td><td className="pref-val">{r["LRNSTOP"]}</td>
                        <td className="pref-val">{r["HOCONN"]}</td><td className="pref-val">{r["LOCONN"]}</td>
                        <td className="pref-val">{r["HRCONN"]}</td><td className="pref-val">{r["LRCONN"]}</td>
                        <td className="pref-val">{r["HOINTR"]}</td><td className="pref-val">{r["LOINTR"]}</td>
                        <td className="pref-val">{r["HRINTR"]}</td><td className="pref-val">{r["LRINTR"]}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="pref-empty">No alliance preference data found for this workset.</div>}
            </div>
          </div> : null}
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
    </div>
  );
}
