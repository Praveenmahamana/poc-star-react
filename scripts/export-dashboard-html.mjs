/**
 * export-dashboard-html.mjs
 * Generates dist/dashboard-export.html — a fully self-contained interactive
 * HTML file with all 3 tabs: Network, Flight View, O&D View.
 * No server, no internet connection required — open directly in a browser.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const worksetsDir = resolve(appRoot, "public", "data", "worksets");
const indexPath = resolve(worksetsDir, "index.json");

if (!existsSync(indexPath)) { console.error("Run: npm run sync-data first."); process.exit(1); }
const worksetIndex = JSON.parse(readFileSync(indexPath, "utf8"));
if (!worksetIndex.length) { console.error("No worksets."); process.exit(1); }

const ws = worksetIndex[worksetIndex.length - 1];
const wDir = resolve(worksetsDir, ws.id);
const bundle = JSON.parse(readFileSync(resolve(wDir, "bundle.json"), "utf8"));

const flightDbDir = resolve(wDir, "flight-report-db");
const itinDbDir = resolve(wDir, "itinerary-report-db");
const odList = existsSync(resolve(flightDbDir, "index.json"))
  ? JSON.parse(readFileSync(resolve(flightDbDir, "index.json"), "utf8")) : [];

const allFlightData = {}, allItinData = {};
for (const od of odList) {
  const fp = resolve(flightDbDir, `${od}.json`);
  if (existsSync(fp)) allFlightData[od] = JSON.parse(readFileSync(fp, "utf8"));
  const ip = resolve(itinDbDir, `${od}.json`);
  if (existsSync(ip)) allItinData[od] = JSON.parse(readFileSync(ip, "utf8"));
}

// ── Pre-compute OD network rows ──────────────────────────────────────────────
const host = bundle.profile.host_airline;
const grouped = new Map();
for (const row of bundle.level3_host_flight_summary || []) {
  const key = `${row.orig}-${row.dest}`;
  const cur = grouped.get(key) || { od: key, orig: row.orig, dest: row.dest, weeklyDeps: 0, localPax: 0, flowPax: 0, totalPax: 0, localRev: 0, flowRev: 0, totalRev: 0 };
  cur.weeklyDeps += Number(row.weekly_departures || 0);
  cur.localPax += Number(row.spill_local_pax_est || 0);
  cur.flowPax += Number(row.spill_flow_pax_est || 0);
  cur.totalPax += Number(row.spill_total_pax_est || 0);
  cur.localRev += Number(row.spill_local_revenue_est || 0);
  cur.flowRev += Number(row.spill_flow_revenue_est || 0);
  cur.totalRev += Number(row.spill_total_revenue_est || 0);
  grouped.set(key, cur);
}
const odNetworkRows = [...grouped.values()].map((r) => {
  const d = r.totalPax || 1, rv = r.totalRev || 1;
  return { ...r, localDemandPct: (r.localPax / d) * 100, flowDemandPct: (r.flowPax / d) * 100, localRevPct: (r.localRev / rv) * 100, flowRevPct: (r.flowRev / rv) * 100 };
}).sort((a, b) => b.totalRev - a.totalRev);

// ── Pre-compute host flight rows for Flight View ─────────────────────────────
const hostFlightRows = (bundle.level3_host_flight_summary || []).map(r => ({
  isHost: true,
  key: `${host}-${r.flight_number}-${r.orig}-${r.dest}`,
  airline: host,
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
}));

const spillBreakdown = bundle.flight_spill_breakdown || [];

// ── KPI aggregations ─────────────────────────────────────────────────────────
const hostPax = (bundle.level1_host_od_summary || []).reduce((s, r) => s + Number(r.weekly_pax_est || 0), 0);
const hostSeats = (bundle.level1_host_od_summary || []).reduce((s, r) => s + Number(r.weekly_seats_est || 0), 0);
const avgLF = hostSeats ? (hostPax / hostSeats) * 100 : 0;
const totalLocalPax = odNetworkRows.reduce((s, r) => s + r.localPax, 0);
const totalFlowPax = odNetworkRows.reduce((s, r) => s + r.flowPax, 0);
const totalLocalRev = odNetworkRows.reduce((s, r) => s + r.localRev, 0);
const totalFlowRev = odNetworkRows.reduce((s, r) => s + r.flowRev, 0);

const PIE_COLORS = ["#2065d1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#06b6d4","#84cc16","#6366f1"];

// ── Node-side helpers ────────────────────────────────────────────────────────
function fmtN(v, d = 0) {
  return Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtPct(v, d = 1) { return `${fmtN(v, d)}%`; }
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function splitBarHtml(lp, fp) {
  const l = Math.max(0, Number(lp || 0)), f = Math.max(0, Number(fp || 0));
  return `<div class="split-bar-wrap"><div class="split-bar"><div class="split-local" style="width:${l}%"></div><div class="split-flow" style="width:${f}%"></div></div><div class="split-legend"><span>Local ${fmtPct(l)}</span><span>Flow ${fmtPct(f)}</span></div></div>`;
}

// ── Pre-render HTML fragments ────────────────────────────────────────────────
function scorecardHtml() {
  const lf = Math.min(avgLF, 100);
  const tPax = (totalLocalPax + totalFlowPax) || 1, tRev = (totalLocalRev + totalFlowRev) || 1;
  const lPaxPct = (totalLocalPax / tPax) * 100, fPaxPct = (totalFlowPax / tPax) * 100;
  const lRevPct = (totalLocalRev / tRev) * 100, fRevPct = (totalFlowRev / tRev) * 100;
  return `<div class="net-scorecard">
    <div class="nsc-group">
      <div class="nsc-kpi"><div class="nsc-kpi-label">Weekly Pax</div><div class="nsc-kpi-value">${fmtN(hostPax)}</div><div class="nsc-kpi-sub">Est. demand capture</div></div>
      <div class="nsc-kpi"><div class="nsc-kpi-label">Weekly Seats</div><div class="nsc-kpi-value">${fmtN(hostSeats)}</div><div class="nsc-kpi-sub">Scheduled capacity</div></div>
      <div class="nsc-kpi"><div class="nsc-kpi-label">Load Factor</div><div class="nsc-kpi-value accent">${fmtPct(avgLF)}</div><div class="nsc-lf-track"><div class="nsc-lf-fill" style="width:${lf}%"></div></div></div>
    </div>
    <div class="nsc-divider-v"></div>
    <div class="nsc-group">
      <div class="nsc-split"><div class="nsc-split-label">Demand Mix <small>(all host ODs)</small></div><div class="nsc-split-nums"><span class="nsc-local-val">${fmtN(totalLocalPax)}</span><span class="nsc-split-sep">·</span><span class="nsc-flow-val">${fmtN(totalFlowPax)}</span></div>${splitBarHtml(lPaxPct, fPaxPct)}</div>
      <div class="nsc-split"><div class="nsc-split-label">Revenue Mix <small>(all host ODs)</small></div><div class="nsc-split-nums"><span class="nsc-local-val">${fmtN(totalLocalRev)}</span><span class="nsc-split-sep">·</span><span class="nsc-flow-val">${fmtN(totalFlowRev)}</span></div>${splitBarHtml(lRevPct, fRevPct)}</div>
    </div>
  </div>`;
}

function networkTableHtml() {
  const rows = odNetworkRows.map(r => `
    <tr class="row-clickable" data-od="${esc(r.od)}">
      <td><strong>${esc(r.od)}</strong></td>
      <td>${fmtN(r.weeklyDeps)}</td>
      <td>${fmtN(r.localPax, 1)}</td>
      <td>${fmtN(r.flowPax, 1)}</td>
      <td>${splitBarHtml(r.localDemandPct, r.flowDemandPct)}</td>
      <td>${fmtN(r.localRev)}</td>
      <td>${fmtN(r.flowRev)}</td>
      <td>${splitBarHtml(r.localRevPct, r.flowRevPct)}</td>
    </tr>`).join("");
  return `<div class="table-shell">
    <table>
      <thead><tr>
        <th>OD</th><th>Wkly Deps</th><th>Local Pax</th><th>Flow Pax</th><th>Demand Mix</th>
        <th>Local Revenue</th><th>Flow Revenue</th><th>Revenue Mix</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function hostFlightRowsHtml() {
  return hostFlightRows.map(f => {
    const tPax = Number(f.totalPax || 0), lPax = Number(f.localPax || 0);
    const flPax = Number(f.flowPax || 0), rev = Number(f.revenue || 0);
    return `<tr class="fv-host-row row-clickable"
      data-key="${esc(f.key)}" data-orig="${esc(f.orig)}" data-dest="${esc(f.dest)}"
      data-ishost="true" data-totalpax="${tPax}" data-localpax="${lPax}"
      data-flowpax="${flPax}" data-revenue="${rev}">
      <td><strong style="color:var(--accent-light)">${esc(f.airline)}</strong></td>
      <td>${esc(String(f.flightNumber || ""))}</td>
      <td>${esc(f.orig)}</td>
      <td>${esc(f.dest)}</td>
      <td class="mono">—</td>
      <td>${fmtN(f.weeklyDeps, 0)}</td>
      <td>${esc(f.equipment || "—")}</td>
      <td>${fmtN(f.seatsPerDep, 0)}</td>
      <td>—</td><td>—</td><td>—</td>
      <td>${fmtN(f.observedPax, 1)}</td>
      <td>${fmtPct(f.loadFactor, 1)}</td>
      <td>${fmtN(f.totalPax, 1)}</td>
      <td>${fmtN(f.localPax, 1)}</td>
      <td>${fmtN(f.flowPax, 1)}</td>
      <td>${fmtN(f.revenue, 0)}</td>
      <td>${f.avgFare != null ? fmtN(f.avgFare, 0) : "—"}</td>
    </tr>`;
  }).join("");
}

function odSelectOptionsHtml() {
  return odNetworkRows.map(r => `<option value="${esc(r.od)}">${esc(r.od)}</option>`).join("");
}

// ── CSS ──────────────────────────────────────────────────────────────────────
const css = `
:root{
  --bg-app:#f1f5f9;--bg-card:#ffffff;--bg-card-hover:#f8fafc;--bg-elevated:#f1f5f9;
  --border-color:#e2e8f0;--text-primary:#0f172a;--text-secondary:#64748b;
  --accent:#0ea5e9;--accent-light:#0284c7;--accent-glow:rgba(14,165,233,0.12);--accent-muted:rgba(14,165,233,0.08);
  --success:#10b981;--success-muted:rgba(16,185,129,.12);
  --danger:#ef4444;--danger-muted:rgba(239,68,68,.12);
  font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color:var(--text-primary);background:var(--bg-app);
}
*{box-sizing:border-box}body{margin:0;background:var(--bg-app);color:var(--text-primary)}
h1,h2,h3,h4,h5,h6{margin:0}
/* ── App Shell ── */
.app-shell-vision{display:flex;min-height:100vh;background:var(--bg-app)}
.sidebar{width:200px;min-width:180px;background:#0f172a;color:#fff;display:flex;flex-direction:column;flex-shrink:0}
.sidebar-brand{padding:20px 16px 16px;border-bottom:1px solid rgba(255,255,255,.08)}
.sidebar-brand .eyebrow{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.4);margin-bottom:4px}
.sidebar-brand strong{font-size:.9rem;font-weight:700;color:#fff;line-height:1.3;display:block}
.sidebar-tabs{display:flex;flex-direction:column;padding:12px 8px;gap:2px}
.tab{background:none;border:none;color:rgba(255,255,255,.6);padding:10px 12px;text-align:left;border-radius:7px;cursor:pointer;font-size:.82rem;font-weight:500;transition:all .15s}
.tab:hover{background:rgba(255,255,255,.08);color:#fff}
.tab.active{background:rgba(14,165,233,.2);color:#38bdf8;font-weight:600}
.main-shell{flex:1;display:flex;flex-direction:column;min-width:0;overflow-y:auto}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:18px 28px 14px;border-bottom:1px solid var(--border-color);background:#fff;flex-shrink:0}
.topbar .eyebrow{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:2px}
.topbar h1{margin:0;font-size:1.25rem;font-weight:700;letter-spacing:-.02em}
.topbar-controls{display:flex;align-items:center;gap:12px}
.selector-wrap{display:flex;flex-direction:column;gap:3px}
.selector-wrap label{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)}
.selector-wrap select{padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;font-size:.82rem;background:var(--bg-elevated);color:var(--text-primary);min-width:140px;cursor:pointer}
.panel-vision{padding:20px 24px;flex:1}
.tab-content{animation:fadeIn .18s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
/* ── Eyebrow ── */
.eyebrow{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:2px}
/* ── Scorecard ── */
.net-scorecard{display:flex;align-items:center;gap:0;background:#fff;border:1px solid var(--border-color);border-radius:12px;padding:14px 20px;margin:16px 24px 0;flex-wrap:wrap}
.nsc-group{display:flex;align-items:center;gap:24px;flex:1;min-width:240px}
.nsc-divider-v{width:1px;background:var(--border-color);align-self:stretch;margin:0 16px}
.nsc-kpi{min-width:80px}
.nsc-kpi-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)}
.nsc-kpi-value{font-size:1.45rem;font-weight:700;letter-spacing:-.03em;color:var(--text-primary);line-height:1.1}
.nsc-kpi-value.accent{color:var(--accent-light)}
.nsc-kpi-sub{font-size:.65rem;color:var(--text-secondary);margin-top:1px}
.nsc-lf-track{height:4px;background:var(--bg-elevated);border-radius:2px;margin-top:6px;overflow:hidden;width:80px}
.nsc-lf-fill{height:100%;background:var(--accent);border-radius:2px}
.nsc-split{min-width:160px}
.nsc-split-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:4px}
.nsc-split-label small{font-size:.63rem;font-weight:400;text-transform:none;letter-spacing:0}
.nsc-split-nums{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.nsc-local-val{font-size:.9rem;font-weight:700;color:#2065d1}
.nsc-flow-val{font-size:.9rem;font-weight:700;color:#10b981}
.nsc-split-sep{color:var(--text-secondary);font-size:.8rem}
/* ── Split bar ── */
.split-bar-wrap{display:flex;flex-direction:column;gap:4px}
.split-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--bg-elevated)}
.split-local{background:#2065d1}
.split-flow{background:#10b981}
.split-legend{display:flex;justify-content:space-between;font-size:.68rem;color:var(--text-secondary)}
/* ── Tables ── */
.table-section{background:#fff;border:1px solid var(--border-color);border-radius:12px;overflow:hidden;margin-bottom:20px}
.table-section-head{padding:14px 18px;border-bottom:1px solid var(--border-color);background:var(--bg-elevated)}
.table-section-head h3{margin:0 0 2px;font-size:.92rem;font-weight:600}
.table-section-head p{margin:0;font-size:.73rem;color:var(--text-secondary)}
.table-shell{overflow-x:auto}
.table-shell table{width:100%;border-collapse:collapse;font-size:.82rem}
.table-shell thead tr{background:var(--bg-elevated)}
.table-shell th{padding:10px 12px;text-align:left;font-size:.7rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border-color);white-space:nowrap}
.table-shell td{padding:9px 12px;border-bottom:1px solid var(--border-color);color:var(--text-primary);white-space:nowrap}
.table-shell tr:last-child td{border-bottom:none}
.row-clickable{cursor:pointer;transition:background .15s}
.row-clickable:hover td{background:var(--bg-card-hover)}
.row-selected td{background:rgba(32,101,209,.06)!important}
/* ── OD Modal ── */
.od-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;z-index:1000;overflow-y:auto}
.od-modal{background:#fff;border-radius:16px;width:100%;max-width:1100px;box-shadow:0 24px 80px rgba(0,0,0,.25);animation:modalIn .22s ease}
@keyframes modalIn{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:none}}
.od-modal-header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--border-color)}
.od-modal-header h3{margin:0 0 4px;font-size:1.15rem;font-weight:700}
.od-modal-header p{margin:0;font-size:.78rem;color:var(--text-secondary)}
.od-close-btn{background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-secondary);padding:4px 8px;border-radius:6px;line-height:1;flex-shrink:0}
.od-close-btn:hover{background:var(--bg-elevated);color:var(--text-primary)}
.od-modal-body{padding:20px 24px;display:flex;flex-direction:column;gap:20px;max-height:80vh;overflow-y:auto}
.od-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.chart-card{background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:10px;padding:16px}
.chart-head h3{margin:0 0 2px;font-size:.88rem;font-weight:600}
.chart-head p{margin:0 0 12px;font-size:.72rem;color:var(--text-secondary)}
.pie-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.pie-legend{display:flex;flex-direction:column;gap:5px;font-size:.75rem;flex:1;min-width:100px}
.pie-legend-item{display:flex;align-items:center;gap:6px}
.pie-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.pie-label{flex:1;color:var(--text-primary)}
.pie-pct{font-weight:600;color:var(--text-secondary);font-variant-numeric:tabular-nums}
.breakdown-list{display:flex;flex-direction:column;gap:6px;font-size:.8rem;margin-top:8px}
.breakdown-item{display:flex;align-items:center;gap:8px}
.breakdown-item span:first-child{flex:1;color:var(--text-secondary)}
.breakdown-item strong{font-variant-numeric:tabular-nums}
.breakdown-pct{color:var(--text-secondary);font-size:.72rem}
.breakdown-divider{height:1px;background:var(--border-color);margin:4px 0}
.breakdown-section-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)}
.od-table-section{background:#fff;border:1px solid var(--border-color);border-radius:10px;overflow:hidden}
.od-table-section-head{padding:12px 16px;border-bottom:1px solid var(--border-color);background:var(--bg-elevated)}
.od-table-section-head h4{margin:0 0 2px;font-size:.88rem;font-weight:600}
.od-table-section-head p{margin:0;font-size:.72rem;color:var(--text-secondary)}
.od-table-scroll{overflow-x:auto;max-height:340px;overflow-y:auto}
.od-data-table{width:100%;border-collapse:collapse;font-size:.75rem;white-space:nowrap}
.od-data-table thead tr{background:var(--bg-elevated);position:sticky;top:0;z-index:1}
.od-data-table th{padding:8px 10px;text-align:left;font-size:.68rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border-color)}
.od-data-table td{padding:6px 10px;border-bottom:1px solid var(--border-color);color:var(--text-primary)}
.od-data-table tr:last-child td{border-bottom:none}
.od-data-table tr:hover td{background:var(--bg-card-hover)}
.od-table-empty{text-align:center;color:var(--text-secondary);font-style:italic;padding:20px}
.itin-connecting td{background:rgba(245,158,11,.04)}
/* ── QSI ── */
.qsi-chart{font-size:.78rem}
.qsi-header-row{display:flex;margin-bottom:6px}
.qsi-metric-col{width:200px;flex-shrink:0}
.qsi-airline-header{flex:1;text-align:center;font-weight:700;font-size:.8rem;padding:2px}
.qsi-metric-row{display:flex;align-items:center;padding:4px 0;border-bottom:1px solid var(--border-color)}
.qsi-metric-row.qsi-na{opacity:.5}
.qsi-metric-label{width:200px;flex-shrink:0;display:flex;align-items:center;gap:4px;color:var(--text-secondary);font-size:.75rem}
.qsi-note{font-size:.7rem;cursor:help;color:var(--accent)}
.qsi-bars-col{flex:1;display:flex;flex-direction:column;gap:3px}
.qsi-bar-line{display:flex;align-items:center;gap:6px}
.qsi-relative-track{display:flex;flex:1;height:12px;gap:1px}
.qsi-neg-half{flex:1;display:flex;justify-content:flex-end;align-items:center}
.qsi-pos-half{flex:1;display:flex;align-items:center}
.qsi-center-tick{width:2px;height:14px;background:var(--border-color);flex-shrink:0}
.qsi-pos-track{flex:1;height:12px;background:var(--bg-elevated);border-radius:2px;overflow:hidden}
.qsi-fill{height:100%;border-radius:2px}
.qsi-val{font-size:.7rem;font-variant-numeric:tabular-nums;width:55px;text-align:right;flex-shrink:0}
.qsi-footnote{margin-top:8px;font-size:.68rem;color:var(--text-secondary);font-style:italic;border-top:1px dashed var(--border-color);padding-top:6px}
/* ── Flight View ── */
.fv-filter-bar{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:14px 16px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;margin-bottom:16px}
.fv-filter-item{display:flex;flex-direction:column;gap:4px}
.fv-filter-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)}
.fv-filter-select{padding:6px 10px;border:1px solid var(--border-color);border-radius:6px;font-size:.82rem;background:var(--bg-elevated);color:var(--text-primary);min-width:130px;cursor:pointer}
.fv-clear-btn{padding:7px 14px;background:var(--danger-muted);color:var(--danger);border:1px solid var(--danger);border-radius:6px;font-size:.78rem;font-weight:600;cursor:pointer;align-self:flex-end}
.fv-comp-hint{font-size:.72rem;color:var(--text-secondary);font-style:italic;align-self:flex-end;padding-bottom:6px}
.fv-kpi-strip{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.fv-kpi-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:10px 14px;flex:1;min-width:110px}
.fv-kpi-card.accent{border-color:var(--accent);background:var(--accent-muted)}
.fv-kpi-label{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary);margin-bottom:2px}
.fv-kpi-value{font-size:1.2rem;font-weight:700;color:var(--text-primary)}
.fv-kpi-card.accent .fv-kpi-value{color:var(--accent-light)}
.fv-host-row td{background:rgba(32,101,209,.03)}
.fv-comp-row td{background:transparent}
.fv-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;z-index:1000;overflow-y:auto}
.fv-modal{background:#fff;border-radius:16px;width:100%;max-width:900px;box-shadow:0 24px 80px rgba(0,0,0,.25);animation:modalIn .22s ease}
.fv-detail-stats{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:var(--bg-elevated);border-radius:8px}
.fv-ds{display:flex;flex-direction:column;gap:2px}
.fv-ds span{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)}
.fv-ds strong{font-size:1.05rem;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums}
/* ── O&D View ── */
.odv-kpi-strip{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.odv-kpi-card{background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;padding:14px 18px;flex:1;min-width:130px}
.odv-kpi-card.accent{background:rgba(14,165,233,.08);border-color:var(--accent)}
.odv-kpi-card.host{background:rgba(32,101,209,.04);border-color:rgba(32,101,209,.3)}
.odv-kpi-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:4px}
.odv-kpi-value{font-size:1.45rem;font-weight:700;color:var(--text-primary);line-height:1.1}
.odv-kpi-card.accent .odv-kpi-value{color:var(--accent-light)}
.odv-kpi-card.host .odv-kpi-value{color:#2065d1}
.odv-kpi-sub{font-size:.68rem;color:var(--text-secondary);margin-top:2px}
.odv-section{background:var(--bg-card);border:1px solid var(--border-color);border-radius:10px;overflow:hidden;margin-bottom:20px}
.odv-section-head{padding:14px 18px;border-bottom:1px solid var(--border-color);background:var(--bg-elevated)}
.odv-section-head h3{margin:0 0 2px;font-size:.92rem;font-weight:600}
.odv-section-head p{margin:0;font-size:.73rem;color:var(--text-secondary)}
.odv-host-row td{background:rgba(32,101,209,.04)!important}
.odv-host-badge{display:inline-block;margin-left:6px;padding:1px 5px;background:var(--accent);color:#fff;border-radius:3px;font-size:.6rem;font-weight:700;letter-spacing:.05em;vertical-align:middle}
.odv-share-cell{display:flex;align-items:center;gap:8px;min-width:100px}
.odv-share-bar{height:8px;border-radius:4px;min-width:2px;flex-shrink:0}
/* ── Misc ── */
.loading{padding:24px;text-align:center;color:var(--text-secondary);font-style:italic}
.empty-state{padding:24px;text-align:center;color:var(--text-secondary);font-style:italic}
.mono{font-family:monospace;font-size:.8rem;letter-spacing:.04em}
@media(max-width:700px){.od-modal-grid{grid-template-columns:1fr}.nsc-group{gap:12px}.sidebar{width:160px}}
`;

// ── HTML Template ────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ws.label)} — ${esc(host)} Airline Dashboard</title>
<style>${css}</style>
</head>
<body>
<div class="app-shell app-shell-vision">

  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="eyebrow">Airline Insights</div>
      <strong>${esc(host)} Ops Studio</strong>
    </div>
    <nav class="tabs sidebar-tabs">
      <button class="tab active" data-tab="network">Network</button>
      <button class="tab" data-tab="flightView">Flight View</button>
      <button class="tab" data-tab="odView">O&amp;D View</button>
    </nav>
  </aside>

  <main class="main-shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Command view</div>
        <h1 id="topbar-title">Network</h1>
      </div>
      <div class="topbar-controls">
        <div id="od-selector-wrap" class="selector-wrap" style="display:none">
          <label for="od-select">Selected OD</label>
          <select id="od-select">${odSelectOptionsHtml()}</select>
        </div>
      </div>
    </header>

    ${scorecardHtml()}

    <section class="panel panel-vision">

      <!-- Network Tab -->
      <div id="tab-network" class="tab-content">
        <div class="table-section">
          <div class="table-section-head">
            <h3>Host Network Portfolio</h3>
            <p>Click any row to see OD detail — market share, demand mix, itineraries, and competitive metrics</p>
          </div>
          ${networkTableHtml()}
        </div>
      </div>

      <!-- Flight View Tab -->
      <div id="tab-flightView" class="tab-content" style="display:none">
        <div class="fv-filter-bar">
          <div class="fv-filter-item">
            <span class="fv-filter-label">Origin</span>
            <select id="fv-orig-select" class="fv-filter-select">
              <option value="">All Origins</option>
            </select>
          </div>
          <div class="fv-filter-item">
            <span class="fv-filter-label">Destination</span>
            <select id="fv-dest-select" class="fv-filter-select">
              <option value="">All Destinations</option>
            </select>
          </div>
          <div class="fv-filter-item">
            <span class="fv-filter-label">Show</span>
            <select id="fv-show-select" class="fv-filter-select">
              <option value="all">All Airlines</option>
              <option value="host">${esc(host)} only</option>
              <option value="competitors">Competitors only</option>
            </select>
          </div>
          <button id="fv-clear-btn" class="fv-clear-btn" style="display:none">Clear filters</button>
          <span id="fv-comp-hint" class="fv-comp-hint">Select Origin + Destination to load competitor flights</span>
        </div>

        <div id="fv-kpi-strip" class="fv-kpi-strip"></div>

        <div class="table-shell">
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
            <tbody id="fv-tbody">
              ${hostFlightRowsHtml()}
            </tbody>
          </table>
        </div>
      </div>

      <!-- O&D View Tab -->
      <div id="tab-odView" class="tab-content" style="display:none">
        <div id="odv-kpi-strip" class="odv-kpi-strip"></div>
        <div id="odv-market-section"></div>
        <div id="odv-itin-section"></div>
      </div>

    </section>
  </main>
</div>

<!-- OD Detail Modal (Network tab) -->
<div id="od-modal-backdrop" class="od-modal-backdrop" style="display:none">
  <div class="od-modal">
    <div class="od-modal-header">
      <div><h3 id="od-modal-title">OD Detail</h3><p>Airline shares · host vs competitors · local/flow mix · direct vs connecting</p></div>
      <button class="od-close-btn" id="od-modal-close">&#x2715;</button>
    </div>
    <div class="od-modal-body" id="od-modal-body"><div class="loading">Loading…</div></div>
  </div>
</div>

<!-- Flight View Modal -->
<div id="fv-modal-backdrop" class="fv-modal-backdrop" style="display:none">
  <div class="fv-modal">
    <div class="od-modal-header">
      <div><h3 id="fv-modal-title"></h3><p id="fv-modal-subtitle"></p></div>
      <button class="od-close-btn" id="fv-modal-close">&#x2715;</button>
    </div>
    <div class="od-modal-body" id="fv-modal-body"></div>
  </div>
</div>

<script>
// ── Inlined data constants ───────────────────────────────────────────────────
var HOST_AIRLINE = ${JSON.stringify(host)};
var OD_NETWORK_ROWS = ${JSON.stringify(odNetworkRows)};
var HOST_FLIGHT_ROWS = ${JSON.stringify(hostFlightRows)};
var FLIGHT_DATA = ${JSON.stringify(allFlightData)};
var ITIN_DATA = ${JSON.stringify(allItinData)};
var SPILL_BREAKDOWN = ${JSON.stringify(spillBreakdown)};
var PIE_COLORS = ${JSON.stringify(PIE_COLORS)};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtN(v, d) {
  d = (d === undefined) ? 0 : d;
  return Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtPct(v, d) { return fmtN(v, d === undefined ? 1 : d) + "%"; }
function countFreqDays(freq) { return String(freq || "").split("").filter(function(c) { return c !== "."; }).length; }
function parseElap(s) { var p = String(s || "0:0").split(":").map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }
function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function splitBarHtml(lp, fp) {
  var l = Math.max(0, Number(lp || 0)), f = Math.max(0, Number(fp || 0));
  return '<div class="split-bar-wrap"><div class="split-bar">'
    + '<div class="split-local" style="width:' + l + '%"></div>'
    + '<div class="split-flow" style="width:' + f + '%"></div>'
    + '</div><div class="split-legend"><span>Local ' + fmtPct(l) + '</span><span>Flow ' + fmtPct(f) + '</span></div></div>';
}

function pieChartSvg(slices, size) {
  size = size || 150;
  var total = slices.reduce(function(s, x) { return s + x.value; }, 0);
  if (!total) return "<em>No data</em>";
  var cx = size / 2, cy = size / 2, r = size * 0.42, angle = -Math.PI / 2;
  var paths = slices.filter(function(s) { return s.value > 0; }).map(function(sl, i) {
    var frac = sl.value / total, start = angle, end = angle + frac * 2 * Math.PI; angle = end;
    var x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    var x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    var col = PIE_COLORS[i % PIE_COLORS.length];
    var d = "M" + cx + "," + cy + " L" + x1 + "," + y1 + " A" + r + "," + r + " 0 " + (frac > .5 ? 1 : 0) + " 1 " + x2 + "," + y2 + " Z";
    return { d: d, col: col, label: sl.label, pct: frac * 100 };
  });
  var svgPaths = paths.map(function(p) {
    return '<path d="' + p.d + '" fill="' + p.col + '" stroke="#fff" stroke-width="1.5"/>';
  }).join("");
  var legend = paths.map(function(p) {
    return '<div class="pie-legend-item"><span class="pie-dot" style="background:' + p.col + '"></span>'
      + '<span class="pie-label">' + escHtml(p.label) + '</span>'
      + '<span class="pie-pct">' + fmtPct(p.pct) + '</span></div>';
  }).join("");
  return '<div class="pie-wrap"><svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '">'
    + svgPaths + '</svg><div class="pie-legend">' + legend + '</div></div>';
}

function qsiChartHtml(qsiRows) {
  if (!qsiRows.length) return '<div class="empty-state">No QSI data</div>';
  var metrics = [
    { key: "share", label: "Share (%)", rel: false, note: null },
    { key: "nstops", label: "No of Nonstops", rel: false, note: null },
    { key: "cncts", label: "No of Connections", rel: false, note: null },
    { key: "elapScore", label: "Elapsed Time", rel: true, note: "market-relative speed advantage" },
    { key: "opp", label: "OPP", rel: true, note: "log frequency ratio vs market avg" },
    { key: "service", label: "Service", rel: true, note: "N/A — requires external model params" },
    { key: "equipment", label: "Equipment", rel: true, note: "N/A — requires external model params" },
    { key: "alnPref", label: "Airline Preference", rel: true, note: "N/A — requires survey data" },
    { key: "metroPref", label: "Metro Preference", rel: true, note: "N/A — requires survey data" },
    { key: "sr", label: "Service Ratio", rel: true, note: "N/A — requires external model params" },
    { key: "tow", label: "TOW", rel: true, note: "N/A — requires external model params" },
    { key: "relFare", label: "Relative Fare", rel: true, note: "airline yield vs market avg yield" },
    { key: "rsqm", label: "RSQM", rel: true, note: "N/A — residual from demand model" }
  ];
  var header = qsiRows.map(function(r, i) {
    return '<div class="qsi-airline-header" style="color:' + PIE_COLORS[i % PIE_COLORS.length] + '">' + escHtml(r.code) + '</div>';
  }).join("");
  var metricRows = metrics.map(function(m) {
    var vals = qsiRows.map(function(r) { return r[m.key] || 0; });
    var maxAbs = Math.max.apply(null, vals.map(Math.abs).concat([0.001]));
    var allZero = vals.every(function(v) { return v === 0; });
    var bars = qsiRows.map(function(r, i) {
      var v = r[m.key] || 0, pct = Math.abs(v) / maxAbs * 85, isNeg = v < 0, col = PIE_COLORS[i % PIE_COLORS.length];
      var fmt = m.key === "share" ? fmtPct(v, 2) : fmtN(v, 2);
      var opacity = allZero ? ".25" : "1";
      var bar;
      if (m.rel) {
        var negFill = isNeg ? '<div class="qsi-fill" style="width:' + pct + '%;background:' + col + ';opacity:' + opacity + '"></div>' : "";
        var posFill = !isNeg ? '<div class="qsi-fill" style="width:' + pct + '%;background:' + col + ';opacity:' + opacity + '"></div>' : "";
        bar = '<div class="qsi-relative-track"><div class="qsi-neg-half">' + negFill + '</div>'
          + '<div class="qsi-center-tick"></div>'
          + '<div class="qsi-pos-half">' + posFill + '</div></div>';
      } else {
        bar = '<div class="qsi-pos-track"><div class="qsi-fill" style="width:' + pct + '%;background:' + col + '"></div></div>';
      }
      var dispVal = (allZero && m.note) ? "&mdash;" : fmt;
      var valColor = (allZero && m.note) ? "var(--text-secondary)" : "var(--text-primary)";
      return '<div class="qsi-bar-line">' + bar + '<span class="qsi-val" style="color:' + valColor + '">' + dispVal + '</span></div>';
    }).join("");
    var naClass = (allZero && m.note) ? " qsi-na" : "";
    var noteHtml = m.note ? '<span class="qsi-note" title="' + escHtml(m.note) + '">\u24d8</span>' : "";
    return '<div class="qsi-metric-row' + naClass + '">'
      + '<div class="qsi-metric-label"><span>' + m.label + '</span>' + noteHtml + '</div>'
      + '<div class="qsi-bars-col">' + bars + '</div></div>';
  }).join("");
  return '<div class="qsi-chart"><div class="qsi-header-row"><div class="qsi-metric-col"></div>' + header + '</div>'
    + metricRows
    + '<div class="qsi-footnote">\u24d8 = derived from data &middot; &mdash; = requires external model parameters</div></div>';
}

// ── Network OD Modal ─────────────────────────────────────────────────────────
var activeOd = null;

function renderOdModal(od) {
  var flightRows = FLIGHT_DATA[od] || [];
  var itinRows = ITIN_DATA[od] || [];
  var odRow = null;
  for (var k = 0; k < OD_NETWORK_ROWS.length; k++) { if (OD_NETWORK_ROWS[k].od === od) { odRow = OD_NETWORK_ROWS[k]; break; } }

  // Chart 1: Airline market share (from itinerary data)
  var alnMap = {};
  for (var i = 0; i < itinRows.length; i++) {
    var code = String(itinRows[i]["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
    alnMap[code] = (alnMap[code] || 0) + Number(itinRows[i]["Total Traffic"] || 0);
  }
  var airlineSlices = Object.keys(alnMap).map(function(k) { return { label: k, value: alnMap[k] }; })
    .sort(function(a, b) { return b.value - a.value; });

  // Chart 2: Host vs competitors (from flight data)
  var hostTr = 0, compTr = 0;
  for (var i = 0; i < flightRows.length; i++) {
    var tr = Number(flightRows[i]["Total Traffic"] || 0);
    var fd = String(flightRows[i]["Flt Desg"] || "").trim();
    if (fd === HOST_AIRLINE || fd.indexOf(HOST_AIRLINE + " ") === 0) hostTr += tr; else compTr += tr;
  }
  var hvCSlices = [{ label: HOST_AIRLINE, value: hostTr }, { label: "Competitors", value: compTr }];
  var hvCTotal = (hostTr + compTr) || 1;
  var hvCBreakdown = hvCSlices.map(function(s) {
    return '<div class="breakdown-item"><span>' + escHtml(s.label) + '</span><strong>' + fmtN(s.value, 1) + '</strong><span class="breakdown-pct">' + fmtPct(s.value / hvCTotal * 100) + '</span></div>';
  }).join("");

  // Chart 3: Demand & Revenue Mix (host local/flow)
  var demRevHtml = '<div class="empty-state">No data</div>';
  if (odRow) {
    demRevHtml = '<div class="breakdown-list">'
      + '<div class="breakdown-section-label">Passengers</div>'
      + '<div class="breakdown-item"><span>Local Pax</span><strong>' + fmtN(odRow.localPax, 1) + '</strong><span class="breakdown-pct">' + fmtPct(odRow.localDemandPct) + '</span></div>'
      + '<div class="breakdown-item"><span>Flow Pax</span><strong>' + fmtN(odRow.flowPax, 1) + '</strong><span class="breakdown-pct">' + fmtPct(odRow.flowDemandPct) + '</span></div>'
      + splitBarHtml(odRow.localDemandPct, odRow.flowDemandPct)
      + '<div class="breakdown-divider"></div>'
      + '<div class="breakdown-section-label">Revenue</div>'
      + '<div class="breakdown-item"><span>Local Revenue</span><strong>' + fmtN(odRow.localRev) + '</strong><span class="breakdown-pct">' + fmtPct(odRow.localRevPct) + '</span></div>'
      + '<div class="breakdown-item"><span>Flow Revenue</span><strong>' + fmtN(odRow.flowRev) + '</strong><span class="breakdown-pct">' + fmtPct(odRow.flowRevPct) + '</span></div>'
      + splitBarHtml(odRow.localRevPct, odRow.flowRevPct)
      + '</div>';
  }

  // Chart 4: Direct vs Connecting (from itinerary data)
  var dirTr = 0, conTr = 0;
  for (var i = 0; i < itinRows.length; i++) {
    var v = Number(itinRows[i]["Total Traffic"] || 0);
    if (Number(itinRows[i]["Stops"] || 0) === 0) dirTr += v; else conTr += v;
  }
  var dcBreakdown = '<div class="breakdown-list" style="margin-top:12px">'
    + '<div class="breakdown-item"><span>Direct</span><strong>' + fmtN(dirTr, 1) + '</strong></div>'
    + '<div class="breakdown-item"><span>Connecting</span><strong>' + fmtN(conTr, 1) + '</strong></div>'
    + '</div>';

  // Market Summary table
  var mktGroups = {};
  var marketCode = od.replace("-", "");
  for (var i = 0; i < itinRows.length; i++) {
    var r = itinRows[i];
    var aln = String(r["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
    var stops = Number(r["Stops"] || 0), freq = countFreqDays(r["Freq"]);
    var dem = Number(r["Total Demand"] || 0), tr2 = Number(r["Total Traffic"] || 0), rev = Number(r["Pax Revenue($)"] || 0);
    if (!mktGroups[aln]) mktGroups[aln] = { aln: aln, market: marketCode, nstps: 0, cncts: 0, demand: 0, traffic: 0, revenue: 0 };
    if (stops === 0) mktGroups[aln].nstps += freq; else mktGroups[aln].cncts += freq;
    mktGroups[aln].demand += dem; mktGroups[aln].traffic += tr2; mktGroups[aln].revenue += rev;
  }
  var mktRows = Object.values(mktGroups).sort(function(a, b) { return b.demand - a.demand; });
  var mktDem = mktRows.reduce(function(s, r) { return s + r.demand; }, 0) || 1;
  var mktTr2 = mktRows.reduce(function(s, r) { return s + r.traffic; }, 0) || 1;
  var mktRev2 = mktRows.reduce(function(s, r) { return s + r.revenue; }, 0) || 1;
  var mktTableBody = mktRows.map(function(r) {
    return '<tr>'
      + '<td>' + escHtml(r.market) + '</td><td><strong>' + escHtml(r.aln) + '</strong></td>'
      + '<td>' + r.nstps + '</td><td>0</td><td>' + r.cncts + '</td>'
      + '<td>' + fmtN(mktDem, 1) + '</td><td>' + fmtN(r.demand, 1) + '</td><td>' + fmtN(r.demand, 1) + '</td><td>0.0</td><td>' + fmtPct(r.demand / mktDem * 100, 2) + '</td>'
      + '<td>' + fmtN(r.traffic, 1) + '</td><td>' + fmtN(r.traffic, 1) + '</td><td>0.0</td><td>' + fmtPct(r.traffic / mktTr2 * 100, 2) + '</td>'
      + '<td>' + fmtN(r.revenue) + '</td><td>' + fmtN(r.revenue) + '</td><td>0.0</td><td>' + fmtPct(r.revenue / mktRev2 * 100, 2) + '</td>'
      + '</tr>';
  }).join("");

  // Itinerary table
  var itinTableBody = itinRows.map(function(r) {
    var cls = Number(r["Stops"] || 0) > 0 ? ' class="itin-connecting"' : '';
    var cp1 = r["Connect Point 1"] === "*" ? "&mdash;" : escHtml(r["Connect Point 1"] || "&mdash;");
    var cp2 = r["Connect Point 2"] === "*" ? "&mdash;" : escHtml(r["Connect Point 2"] || "&mdash;");
    var seg2 = r["Flt Desg (Seg2)"] === "*" ? "&mdash;" : escHtml(r["Flt Desg (Seg2)"] || "&mdash;");
    var seg3 = r["Flt Desg (Seg3)"] === "*" ? "&mdash;" : escHtml(r["Flt Desg (Seg3)"] || "&mdash;");
    return '<tr' + cls + '>'
      + '<td>' + escHtml(r["Dept Arp"] || "") + '</td><td>' + escHtml(r["Arvl Arp"] || "") + '</td>'
      + '<td><strong>' + escHtml(r["Flt Desg (Seg1)"] || "") + '</strong></td>'
      + '<td>' + cp1 + '</td><td>' + escHtml(r["Minimum Connect Time 1"] || "&mdash;") + '</td><td>' + escHtml(r["Connect Time 1"] || "&mdash;") + '</td>'
      + '<td>' + seg2 + '</td><td>' + cp2 + '</td>'
      + '<td>' + escHtml(r["Minimum Connect Time 2"] || "&mdash;") + '</td><td>' + escHtml(r["Connect Time 2"] || "&mdash;") + '</td>'
      + '<td>' + seg3 + '</td><td>' + escHtml(String(r["Stops"] || 0)) + '</td>'
      + '<td>' + escHtml(String(r["Segs"] || "")) + '</td><td>' + escHtml(r["Freq"] || "") + '</td>'
      + '<td>' + escHtml(r["Dept Time"] || "&mdash;") + '</td><td>' + escHtml(r["Arvl Time"] || "&mdash;") + '</td><td>' + escHtml(r["Elap Time"] || "&mdash;") + '</td>'
      + '<td>' + fmtN(r["Total Demand"], 1) + '</td><td>' + fmtN(r["Total Traffic"], 1) + '</td><td>' + fmtN(r["Pax Revenue($)"]) + '</td>'
      + '</tr>';
  }).join("");

  // QSI rows
  var alnAgg = {};
  for (var i = 0; i < itinRows.length; i++) {
    var r = itinRows[i];
    var aln = String(r["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
    var stops = Number(r["Stops"] || 0), freq = countFreqDays(r["Freq"]), elap = parseElap(r["Elap Time"]);
    var dem = Number(r["Total Demand"] || 0), tr3 = Number(r["Total Traffic"] || 0);
    if (!alnAgg[aln]) alnAgg[aln] = { aln: aln, nstops: 0, cncts: 0, demand: 0, traffic: 0, elapW: 0 };
    if (stops === 0) alnAgg[aln].nstops += freq; else alnAgg[aln].cncts += freq;
    alnAgg[aln].demand += dem; alnAgg[aln].traffic += tr3; alnAgg[aln].elapW += elap * tr3;
  }
  var yldMap = {};
  for (var i = 0; i < flightRows.length; i++) {
    var r = flightRows[i];
    var aln = String(r["Flt Desg"] || "").trim().split(/\s+/)[0] || "?";
    if (!yldMap[aln]) yldMap[aln] = { traffic: 0, revenue: 0 };
    yldMap[aln].traffic += Number(r["Total Traffic"] || 0);
    yldMap[aln].revenue += Number(r["Pax Revenue($)"] || 0);
  }
  var alns = Object.values(alnAgg);
  var totDem = alns.reduce(function(s, a) { return s + a.demand; }, 0) || 1;
  var totTr3 = alns.reduce(function(s, a) { return s + a.traffic; }, 0) || 1;
  var mktElap = alns.reduce(function(s, a) { return s + a.elapW; }, 0) / totTr3 || 1;
  var mktYld = Object.values(yldMap).reduce(function(s, y) { return s + y.revenue; }, 0) / totTr3 || 1;
  var n = alns.length || 1, totFreq = alns.reduce(function(s, a) { return s + a.nstops + a.cncts; }, 0) || 1;
  var qsiRows = alns.map(function(a) {
    var share = (a.demand / totDem) * 100;
    var avgElap = a.traffic > 0 ? a.elapW / a.traffic : 0;
    var elapScore = mktElap > 0 ? ((mktElap - avgElap) / mktElap) * 100 : 0;
    var airlineFreq = a.nstops + a.cncts;
    var opp = airlineFreq > 0 ? Math.log(n * airlineFreq / totFreq) : 0;
    var yld = yldMap[a.aln], alnYld = yld && yld.traffic > 0 ? yld.revenue / yld.traffic : 0;
    var relFare = mktYld > 0 ? ((alnYld - mktYld) / mktYld) * 100 : 0;
    return { code: a.aln, share: share, nstops: a.nstops, cncts: a.cncts, elapScore: elapScore, opp: opp, relFare: relFare, service: 0, equipment: 0, alnPref: 0, metroPref: 0, sr: 0, tow: 0, rsqm: 0 };
  }).sort(function(x, y) { return y.share - x.share; });

  document.getElementById("od-modal-title").textContent = od + " \u2014 Market Detail";
  document.getElementById("od-modal-body").innerHTML =
    '<div class="od-modal-grid">'
    + '<div class="chart-card"><div class="chart-head"><h3>Airline Market Share</h3><p>All carriers &mdash; share of total traffic</p></div>' + pieChartSvg(airlineSlices) + '</div>'
    + '<div class="chart-card"><div class="chart-head"><h3>Host vs Competitors</h3><p>Host airline share vs market</p></div>' + pieChartSvg(hvCSlices, 140) + '<div class="breakdown-list" style="margin-top:10px">' + hvCBreakdown + '</div></div>'
    + '<div class="chart-card"><div class="chart-head"><h3>Demand &amp; Revenue Mix</h3><p>Local vs flow contribution (host)</p></div>' + demRevHtml + '</div>'
    + '<div class="chart-card"><div class="chart-head"><h3>Direct vs Connecting</h3><p>Traffic split by itinerary type</p></div>' + pieChartSvg([{ label: "Direct", value: dirTr }, { label: "Connecting", value: conTr }], 140) + dcBreakdown + '</div>'
    + '</div>'
    + '<div class="od-table-section"><div class="od-table-section-head"><h4>Market Summary by Airline</h4><p>Aggregated demand, traffic &amp; revenue share per carrier</p></div>'
    + '<div class="od-table-scroll"><table class="od-data-table"><thead><tr>'
    + '<th>Market</th><th>Airline</th><th>NStps</th><th>Thrus</th><th>Cncts</th>'
    + '<th>Mkt Size</th><th>Total Demand</th><th>Op Demand</th><th>NonOp Dem</th><th>Dem Share%</th>'
    + '<th>Total Traffic</th><th>Op Traffic</th><th>NonOp Tr</th><th>Tr Share%</th>'
    + '<th>Pax Revenue</th><th>Op Revenue</th><th>NonOp Rev</th><th>Rev Share%</th>'
    + '</tr></thead><tbody>' + (mktTableBody || '<tr><td colspan="18" class="od-table-empty">No data</td></tr>') + '</tbody></table></div></div>'
    + '<div class="od-table-section"><div class="od-table-section-head"><h4>Itinerary Report</h4><p>All itineraries for this OD including connections</p></div>'
    + '<div class="od-table-scroll"><table class="od-data-table"><thead><tr>'
    + '<th>Dept Arp</th><th>Arvl Arp</th><th>Flt Desg (Seg1)</th>'
    + '<th>Cnct Pt 1</th><th>Min Cnct 1</th><th>Cnct Time 1</th>'
    + '<th>Flt Desg (Seg2)</th><th>Cnct Pt 2</th><th>Min Cnct 2</th><th>Cnct Time 2</th>'
    + '<th>Flt Desg (Seg3)</th><th>Stops</th><th>Segs</th><th>Freq</th>'
    + '<th>Dept</th><th>Arvl</th><th>Elap</th>'
    + '<th>Demand</th><th>Traffic</th><th>Pax Rev</th>'
    + '</tr></thead><tbody>' + (itinTableBody || '<tr><td colspan="20" class="od-table-empty">No data</td></tr>') + '</tbody></table></div></div>'
    + '<div class="od-table-section"><div class="od-table-section-head"><h4>Competitive Position (QSI Factors)</h4><p>Derived metrics &middot; &mdash; requires external model parameters</p></div>'
    + '<div style="padding:16px">' + qsiChartHtml(qsiRows) + '</div></div>';
}

function openOdModal(od) {
  activeOd = od;
  document.getElementById("od-modal-backdrop").style.display = "flex";
  renderOdModal(od);
}

function closeOdModal() {
  document.getElementById("od-modal-backdrop").style.display = "none";
  activeOd = null;
  document.querySelectorAll(".row-selected").forEach(function(r) { r.classList.remove("row-selected"); });
}

// ── Flight View ──────────────────────────────────────────────────────────────
var fvOrig = "", fvDest = "", fvShow = "all";

function fvGetHostRows() { return Array.from(document.querySelectorAll("#fv-tbody .fv-host-row")); }
function fvGetCompRows() { return Array.from(document.querySelectorAll("#fv-tbody .fv-comp-row")); }

function fvUpdateClearBtn() {
  var btn = document.getElementById("fv-clear-btn");
  if (btn) btn.style.display = (fvOrig || fvDest || fvShow !== "all") ? "inline-block" : "none";
}

function fvUpdateHint() {
  var hint = document.getElementById("fv-comp-hint");
  if (!hint) return;
  if (fvOrig && fvDest) {
    var comp = fvGetCompRows().length;
    hint.textContent = comp > 0
      ? "Competitor data loaded for " + fvOrig + "\u2013" + fvDest + " (" + comp + " flights)"
      : "No competitor data for " + fvOrig + "\u2013" + fvDest;
  } else {
    hint.textContent = "Select Origin + Destination to load competitor flights";
  }
}

function fvApplyFilters() {
  fvGetHostRows().forEach(function(tr) {
    var origMatch = !fvOrig || tr.dataset.orig === fvOrig;
    var destMatch = !fvDest || tr.dataset.dest === fvDest;
    var showMatch = fvShow === "all" || fvShow === "host";
    tr.style.display = (origMatch && destMatch && showMatch) ? "" : "none";
  });
  fvGetCompRows().forEach(function(tr) {
    var showMatch = fvShow === "all" || fvShow === "competitors";
    tr.style.display = showMatch ? "" : "none";
  });
  fvUpdateKpis();
  fvUpdateClearBtn();
}

function fvUpdateKpis() {
  var hostRows = fvGetHostRows().filter(function(tr) { return tr.style.display !== "none"; });
  var compRows = fvGetCompRows().filter(function(tr) { return tr.style.display !== "none"; });
  var totalPax = 0, localPax = 0, flowPax = 0, revenue = 0;
  hostRows.forEach(function(tr) {
    totalPax += Number(tr.dataset.totalpax || 0);
    localPax += Number(tr.dataset.localpax || 0);
    flowPax += Number(tr.dataset.flowpax || 0);
    revenue += Number(tr.dataset.revenue || 0);
  });
  var strip = document.getElementById("fv-kpi-strip");
  if (!strip) return;
  var total = hostRows.length + compRows.length;
  if (total === 0) { strip.innerHTML = ""; return; }
  strip.innerHTML =
    '<div class="fv-kpi-card"><div class="fv-kpi-label">' + escHtml(HOST_AIRLINE) + ' Flights</div><div class="fv-kpi-value">' + hostRows.length + '</div></div>'
    + '<div class="fv-kpi-card"><div class="fv-kpi-label">Competitor Flights</div><div class="fv-kpi-value">' + compRows.length + '</div></div>'
    + '<div class="fv-kpi-card"><div class="fv-kpi-label">' + escHtml(HOST_AIRLINE) + ' Weekly Pax</div><div class="fv-kpi-value">' + fmtN(totalPax, 1) + '</div></div>'
    + '<div class="fv-kpi-card"><div class="fv-kpi-label">Local Pax</div><div class="fv-kpi-value">' + fmtN(localPax, 1) + '</div></div>'
    + '<div class="fv-kpi-card"><div class="fv-kpi-label">Flow Pax</div><div class="fv-kpi-value">' + fmtN(flowPax, 1) + '</div></div>'
    + '<div class="fv-kpi-card accent"><div class="fv-kpi-label">' + escHtml(HOST_AIRLINE) + ' Revenue</div><div class="fv-kpi-value">' + fmtN(revenue) + '</div></div>';
}

function fvPopulateOrig() {
  var origs = [];
  HOST_FLIGHT_ROWS.forEach(function(f) { if (origs.indexOf(f.orig) < 0) origs.push(f.orig); });
  origs.sort();
  var sel = document.getElementById("fv-orig-select");
  if (!sel) return;
  origs.forEach(function(o) {
    var opt = document.createElement("option"); opt.value = o; opt.textContent = o; sel.appendChild(opt);
  });
}

function fvPopulateDest(orig) {
  var rows = orig ? HOST_FLIGHT_ROWS.filter(function(f) { return f.orig === orig; }) : HOST_FLIGHT_ROWS;
  var dests = [];
  rows.forEach(function(f) { if (dests.indexOf(f.dest) < 0) dests.push(f.dest); });
  dests.sort();
  var sel = document.getElementById("fv-dest-select");
  if (!sel) return;
  while (sel.options.length > 1) sel.remove(1);
  dests.forEach(function(d) {
    var opt = document.createElement("option"); opt.value = d; opt.textContent = d; sel.appendChild(opt);
  });
}

function fvLoadCompetitors(orig, dest) {
  var tbody = document.getElementById("fv-tbody");
  fvGetCompRows().forEach(function(r) { r.remove(); });
  if (!orig || !dest) { fvUpdateHint(); fvUpdateKpis(); return; }
  var od = orig + "-" + dest;
  var flightRows = FLIGHT_DATA[od] || [];
  var compFlights = flightRows.filter(function(r) {
    var aln = String(r["Flt Desg"] || "").trim().split(/\s+/)[0];
    return aln !== HOST_AIRLINE;
  }).map(function(r) {
    return {
      isHost: false,
      key: "comp-" + String(r["Flt Desg"] || "") + "-" + String(r["Dept Sta"] || "") + "-" + String(r["Arvl Sta"] || ""),
      airline: String(r["Flt Desg"] || "").trim().split(/\s+/)[0],
      flightNumber: String(r["Flt Desg"] || "").trim(),
      orig: r["Dept Sta"] || orig, dest: r["Arvl Sta"] || dest,
      freq: r["Freq"],
      weeklyDeps: countFreqDays(r["Freq"]),
      equipment: r["Subfleet"],
      seatsPerDep: Number(r["Seats"] || 0),
      deptTime: r["Dept Time"], arvlTime: r["Arvl Time"], elapTime: r["Elap Time"],
      observedPax: Number(r["Total Traffic"] || 0),
      loadFactor: Number(r["Load Factor (%)"] || 0),
      revenue: Number(r["Pax Revenue($)"] || 0)
    };
  });
  var frag = document.createDocumentFragment();
  compFlights.forEach(function(f) {
    var tr = document.createElement("tr");
    tr.className = "fv-comp-row row-clickable";
    tr.dataset.key = f.key; tr.dataset.orig = f.orig; tr.dataset.dest = f.dest;
    tr.dataset.ishost = "false"; tr.dataset.totalpax = "0"; tr.dataset.localpax = "0";
    tr.dataset.flowpax = "0"; tr.dataset.revenue = String(f.revenue || 0);
    tr.innerHTML =
      '<td><strong>' + escHtml(f.airline) + '</strong></td>'
      + '<td>' + escHtml(f.flightNumber) + '</td>'
      + '<td>' + escHtml(f.orig) + '</td><td>' + escHtml(f.dest) + '</td>'
      + '<td class="mono">' + escHtml(f.freq || "\u2014") + '</td>'
      + '<td>' + fmtN(f.weeklyDeps, 0) + '</td>'
      + '<td>' + escHtml(f.equipment || "\u2014") + '</td>'
      + '<td>' + fmtN(f.seatsPerDep, 0) + '</td>'
      + '<td>' + escHtml(f.deptTime || "\u2014") + '</td>'
      + '<td>' + escHtml(f.arvlTime || "\u2014") + '</td>'
      + '<td>' + escHtml(f.elapTime || "\u2014") + '</td>'
      + '<td>' + fmtN(f.observedPax, 1) + '</td>'
      + '<td>' + fmtPct(f.loadFactor, 1) + '</td>'
      + '<td>\u2014</td><td>\u2014</td><td>\u2014</td>'
      + '<td>' + fmtN(f.revenue, 0) + '</td>'
      + '<td>\u2014</td>';
    tr.addEventListener("click", function() { fvOpenModal(f); });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  fvUpdateHint();
  fvApplyFilters();
}

function fvClearFilters() {
  fvOrig = ""; fvDest = ""; fvShow = "all";
  document.getElementById("fv-orig-select").value = "";
  document.getElementById("fv-dest-select").value = "";
  document.getElementById("fv-show-select").value = "all";
  fvPopulateDest("");
  fvGetCompRows().forEach(function(r) { r.remove(); });
  fvUpdateHint();
  fvApplyFilters();
}

// ── Flight View Modal ────────────────────────────────────────────────────────
function fvOpenModal(flight) {
  var title = document.getElementById("fv-modal-title");
  var subtitle = document.getElementById("fv-modal-subtitle");
  var body = document.getElementById("fv-modal-body");
  if (!title || !body) return;

  if (flight.isHost) {
    title.textContent = HOST_AIRLINE + " " + flight.flightNumber + " \u2014 Flow OD Breakdown";
    subtitle.textContent = flight.orig + " \u2192 " + flight.dest + " \u00b7 Host flight \u00b7 local & flow pax breakdown";
    var flowRows = SPILL_BREAKDOWN.filter(function(r) {
      return r.flight_number === flight.flightNumber && r.flight_orig === flight.orig && r.flight_dest === flight.dest
        && (Number(r.flow_pax_est || 0) > 0 || Number(r.flow_revenue_est || 0) > 0);
    }).sort(function(a, b) { return Number(b.flow_pax_est || 0) - Number(a.flow_pax_est || 0); });
    var tp = Number(flight.totalPax || 0);
    var fp = Number(flight.flowPax || 0);
    var statsHtml = '<div class="fv-detail-stats">'
      + '<div class="fv-ds"><span>Total Spill Pax</span><strong>' + fmtN(tp, 1) + '</strong></div>'
      + '<div class="fv-ds"><span>Local Pax</span><strong>' + fmtN(flight.localPax, 1) + '</strong></div>'
      + '<div class="fv-ds"><span>Flow Pax</span><strong>' + fmtN(fp, 1) + '</strong></div>'
      + '<div class="fv-ds"><span>Flow %</span><strong>' + (tp > 0 ? fmtPct(fp / tp * 100, 1) : "\u2014") + '</strong></div>'
      + '<div class="fv-ds"><span>Load Factor</span><strong>' + fmtPct(flight.loadFactor, 1) + '</strong></div>'
      + '<div class="fv-ds"><span>Revenue</span><strong>' + fmtN(flight.revenue, 0) + '</strong></div>'
      + '</div>';
    var flowTableHtml;
    if (flowRows.length > 0) {
      var flowBody = flowRows.map(function(r) {
        return '<tr><td><strong>' + escHtml(r.flow_orig + "\u2013" + r.flow_dest) + '</strong></td>'
          + '<td>' + escHtml(r.flow_orig) + '</td><td>' + escHtml(r.flow_dest) + '</td>'
          + '<td>' + fmtN(r.flow_pax_est, 1) + '</td>'
          + '<td>' + fmtN(r.flow_revenue_est, 0) + '</td></tr>';
      }).join("");
      flowTableHtml = '<div class="table-shell"><table>'
        + '<thead><tr><th>Flow OD</th><th>Flow Orig</th><th>Flow Dest</th><th>Flow Pax</th><th>Flow Revenue</th></tr></thead>'
        + '<tbody>' + flowBody + '</tbody></table></div>';
    } else {
      flowTableHtml = '<div class="empty-state">No flow OD contributors for this flight.</div>';
    }
    body.innerHTML = statsHtml + flowTableHtml;
  } else {
    title.textContent = flight.flightNumber + " \u2014 Flight Details";
    subtitle.textContent = flight.orig + " \u2192 " + flight.dest + " \u00b7 Competitor flight \u00b7 operational metrics";
    body.innerHTML = '<div class="fv-detail-stats">'
      + '<div class="fv-ds"><span>Weekly Deps</span><strong>' + fmtN(flight.weeklyDeps, 0) + '</strong></div>'
      + '<div class="fv-ds"><span>A/C Type</span><strong>' + escHtml(flight.equipment || "\u2014") + '</strong></div>'
      + '<div class="fv-ds"><span>Seats/Dep</span><strong>' + fmtN(flight.seatsPerDep, 0) + '</strong></div>'
      + '<div class="fv-ds"><span>Observed Pax</span><strong>' + fmtN(flight.observedPax, 1) + '</strong></div>'
      + '<div class="fv-ds"><span>Load Factor</span><strong>' + fmtPct(flight.loadFactor, 1) + '</strong></div>'
      + '<div class="fv-ds"><span>Revenue</span><strong>' + fmtN(flight.revenue, 0) + '</strong></div>'
      + '</div>';
  }
  document.getElementById("fv-modal-backdrop").style.display = "flex";
}

function closeFvModal() {
  document.getElementById("fv-modal-backdrop").style.display = "none";
}

// ── O&D View ─────────────────────────────────────────────────────────────────
function renderOdView(od) {
  var itinRows = ITIN_DATA[od] || [];
  var groups = {};
  for (var i = 0; i < itinRows.length; i++) {
    var r = itinRows[i];
    var aln = String(r["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
    var stops = Number(r["Stops"] || 0);
    var freq = countFreqDays(r["Freq"]);
    var demand = Number(r["Total Demand"] || 0);
    var traffic = Number(r["Total Traffic"] || 0);
    var revenue = Number(r["Pax Revenue($)"] || 0);
    if (!groups[aln]) groups[aln] = { aln: aln, nstops: 0, cncts: 0, demand: 0, traffic: 0, revenue: 0 };
    if (stops === 0) groups[aln].nstops += freq; else groups[aln].cncts += freq;
    groups[aln].demand += demand; groups[aln].traffic += traffic; groups[aln].revenue += revenue;
  }
  var mktRows = Object.values(groups).sort(function(a, b) { return b.demand - a.demand; });
  var mktDemand = mktRows.reduce(function(s, r) { return s + r.demand; }, 0) || 1;
  var mktTraffic = mktRows.reduce(function(s, r) { return s + r.traffic; }, 0) || 1;
  var mktRevenue = mktRows.reduce(function(s, r) { return s + r.revenue; }, 0) || 1;
  var mktRowsWithShare = mktRows.map(function(r) {
    return Object.assign({}, r, {
      demandShare: (r.demand / mktDemand) * 100,
      trafficShare: (r.traffic / mktTraffic) * 100,
      revenueShare: (r.revenue / mktRevenue) * 100,
      avgFare: r.traffic > 0 ? r.revenue / r.traffic : 0
    });
  });
  var hostRow = null;
  for (var k = 0; k < mktRowsWithShare.length; k++) {
    if (mktRowsWithShare[k].aln === HOST_AIRLINE) { hostRow = mktRowsWithShare[k]; break; }
  }
  var totalRevenue = mktRows.reduce(function(s, r) { return s + r.revenue; }, 0);
  var marketSize = mktRows.reduce(function(s, r) { return s + r.demand; }, 0);

  // KPI strip
  var kpiHtml =
    '<div class="odv-kpi-card accent"><div class="odv-kpi-label">Market Size</div><div class="odv-kpi-value">' + fmtN(marketSize, 1) + '</div><div class="odv-kpi-sub">Total demand (all carriers)</div></div>'
    + '<div class="odv-kpi-card host"><div class="odv-kpi-label">' + escHtml(HOST_AIRLINE) + ' Demand Share</div><div class="odv-kpi-value">' + (hostRow ? fmtPct(hostRow.demandShare, 1) : "\u2014") + '</div><div class="odv-kpi-sub">' + (hostRow ? fmtN(hostRow.demand, 1) + " pax" : "No data") + '</div></div>'
    + '<div class="odv-kpi-card host"><div class="odv-kpi-label">' + escHtml(HOST_AIRLINE) + ' Traffic Share</div><div class="odv-kpi-value">' + (hostRow ? fmtPct(hostRow.trafficShare, 1) : "\u2014") + '</div><div class="odv-kpi-sub">' + (hostRow ? fmtN(hostRow.traffic, 1) + " boarded" : "No data") + '</div></div>'
    + '<div class="odv-kpi-card host"><div class="odv-kpi-label">' + escHtml(HOST_AIRLINE) + ' Revenue Share</div><div class="odv-kpi-value">' + (hostRow ? fmtPct(hostRow.revenueShare, 1) : "\u2014") + '</div><div class="odv-kpi-sub">' + (hostRow ? fmtN(hostRow.revenue, 0) : "No data") + '</div></div>'
    + '<div class="odv-kpi-card"><div class="odv-kpi-label">Market Revenue</div><div class="odv-kpi-value">' + fmtN(totalRevenue, 0) + '</div><div class="odv-kpi-sub">All carriers combined</div></div>'
    + '<div class="odv-kpi-card"><div class="odv-kpi-label">Airlines in Market</div><div class="odv-kpi-value">' + mktRowsWithShare.length + '</div><div class="odv-kpi-sub">' + itinRows.length + ' itineraries</div></div>';
  document.getElementById("odv-kpi-strip").innerHTML = kpiHtml;

  // Market Summary table
  var mktTableBody = mktRowsWithShare.length === 0
    ? '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-secondary);font-style:italic">No market data for this OD.</td></tr>'
    : mktRowsWithShare.map(function(r) {
      var isHost = r.aln === HOST_AIRLINE;
      var hostBadge = isHost ? '<span class="odv-host-badge">HOST</span>' : "";
      var alnColor = isHost ? "var(--accent-light)" : "var(--text-primary)";
      var barBg = isHost ? "var(--accent)" : "var(--border-color)";
      var barBgRev = isHost ? "var(--success)" : "var(--border-color)";
      return '<tr class="' + (isHost ? "odv-host-row" : "") + '">'
        + '<td><strong style="color:' + alnColor + '">' + escHtml(r.aln) + '</strong>' + hostBadge + '</td>'
        + '<td>' + r.nstops + '</td><td>' + r.cncts + '</td>'
        + '<td>' + fmtN(r.demand, 1) + '</td>'
        + '<td><div class="odv-share-cell"><div class="odv-share-bar" style="width:' + Math.min(r.demandShare, 100) + '%;background:' + barBg + '"></div><span>' + fmtPct(r.demandShare, 1) + '</span></div></td>'
        + '<td>' + fmtN(r.traffic, 1) + '</td>'
        + '<td><div class="odv-share-cell"><div class="odv-share-bar" style="width:' + Math.min(r.trafficShare, 100) + '%;background:' + barBg + '"></div><span>' + fmtPct(r.trafficShare, 1) + '</span></div></td>'
        + '<td>' + fmtN(r.revenue, 0) + '</td>'
        + '<td><div class="odv-share-cell"><div class="odv-share-bar" style="width:' + Math.min(r.revenueShare, 100) + '%;background:' + barBgRev + '"></div><span>' + fmtPct(r.revenueShare, 1) + '</span></div></td>'
        + '<td>' + fmtN(r.avgFare, 0) + '</td>'
        + '</tr>';
    }).join("");

  var marketHtml = '<div class="odv-section">'
    + '<div class="odv-section-head"><h3>Market Report \u2014 ' + escHtml(od) + '</h3><p>Competitive share breakdown by carrier &middot; Pax itinerary view</p></div>'
    + '<div class="table-shell"><table>'
    + '<thead><tr><th>Airline</th><th># Nonstops</th><th># Connections</th><th>Total Demand</th><th>Demand Share %</th><th>Total Traffic</th><th>Traffic Share %</th><th>Pax Revenue</th><th>Revenue Share %</th><th>Avg Fare</th></tr></thead>'
    + '<tbody>' + mktTableBody + '</tbody></table></div></div>';
  document.getElementById("odv-market-section").innerHTML = marketHtml;

  // Itinerary table
  var itinTableBody = itinRows.length === 0
    ? '<tr><td colspan="14" style="text-align:center;padding:24px;color:var(--text-secondary);font-style:italic">No itinerary data for this OD.</td></tr>'
    : itinRows.map(function(r) {
      var aln = String(r["Flt Desg (Seg1)"] || "").trim().split(/\s+/)[0] || "?";
      var isHost = aln === HOST_AIRLINE;
      var isConn = Number(r["Stops"] || 0) > 0;
      var cls = (isConn ? "itin-connecting " : "") + (isHost ? "odv-host-row" : "");
      var cp1 = r["Connect Point 1"] === "*" ? "\u2014" : escHtml(r["Connect Point 1"] || "\u2014");
      var cp2 = r["Connect Point 2"] === "*" ? "\u2014" : escHtml(r["Connect Point 2"] || "\u2014");
      var seg2 = r["Flt Desg (Seg2)"] === "*" ? "\u2014" : escHtml(r["Flt Desg (Seg2)"] || "\u2014");
      var seg3 = r["Flt Desg (Seg3)"] === "*" ? "\u2014" : escHtml(r["Flt Desg (Seg3)"] || "\u2014");
      return '<tr class="' + cls + '">'
        + '<td><strong style="color:' + (isHost ? "var(--accent-light)" : "var(--text-primary)") + '">' + escHtml(aln) + '</strong></td>'
        + '<td>' + escHtml(r["Flt Desg (Seg1)"] || "") + '</td>'
        + '<td>' + cp1 + '</td><td>' + seg2 + '</td><td>' + cp2 + '</td><td>' + seg3 + '</td>'
        + '<td>' + escHtml(String(r["Stops"] || 0)) + '</td>'
        + '<td class="mono">' + escHtml(r["Freq"] || "") + '</td>'
        + '<td>' + escHtml(r["Dept Time"] || "\u2014") + '</td>'
        + '<td>' + escHtml(r["Arvl Time"] || "\u2014") + '</td>'
        + '<td>' + escHtml(r["Elap Time"] || "\u2014") + '</td>'
        + '<td>' + fmtN(r["Total Demand"], 1) + '</td>'
        + '<td>' + fmtN(r["Total Traffic"], 1) + '</td>'
        + '<td>' + fmtN(r["Pax Revenue($)"], 0) + '</td>'
        + '</tr>';
    }).join("");

  var itinHtml = '<div class="odv-section">'
    + '<div class="odv-section-head"><h3>Itineraries \u2014 ' + escHtml(od) + '</h3><p>All itineraries in this market including connections</p></div>'
    + '<div class="table-shell"><table>'
    + '<thead><tr><th>Airline</th><th>Flt (Seg1)</th><th>Cnct Pt 1</th><th>Flt (Seg2)</th><th>Cnct Pt 2</th><th>Flt (Seg3)</th><th>Stops</th><th>Freq</th><th>Dept</th><th>Arvl</th><th>Elap</th><th>Demand</th><th>Traffic</th><th>Revenue</th></tr></thead>'
    + '<tbody>' + itinTableBody + '</tbody></table></div></div>';
  document.getElementById("odv-itin-section").innerHTML = itinHtml;
}

// ── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  // Tab switching
  document.querySelectorAll(".tab[data-tab]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".tab[data-tab]").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll(".tab-content[id^='tab-']").forEach(function(p) { p.style.display = "none"; });
      var panel = document.getElementById("tab-" + btn.dataset.tab);
      if (panel) panel.style.display = "block";
      document.getElementById("topbar-title").textContent = btn.textContent;
      var odSel = document.getElementById("od-selector-wrap");
      if (odSel) odSel.style.display = btn.dataset.tab === "odView" ? "flex" : "none";
    });
  });

  // Network tab row clicks
  document.querySelectorAll("#tab-network .row-clickable").forEach(function(tr) {
    tr.addEventListener("click", function() {
      var od = tr.dataset.od;
      if (!od) return;
      if (od === activeOd) { closeOdModal(); return; }
      document.querySelectorAll(".row-selected").forEach(function(r) { r.classList.remove("row-selected"); });
      tr.classList.add("row-selected");
      openOdModal(od);
    });
  });

  // OD modal close
  document.getElementById("od-modal-close").addEventListener("click", closeOdModal);
  document.getElementById("od-modal-backdrop").addEventListener("click", function(e) {
    if (e.target === this) closeOdModal();
  });

  // Flight View: populate origin dropdown
  fvPopulateOrig();
  fvUpdateKpis();

  // Wire host row clicks
  document.querySelectorAll("#fv-tbody .fv-host-row").forEach(function(tr) {
    tr.addEventListener("click", function() {
      var key = tr.dataset.key;
      var flight = null;
      for (var i = 0; i < HOST_FLIGHT_ROWS.length; i++) {
        if (HOST_FLIGHT_ROWS[i].key === key) { flight = HOST_FLIGHT_ROWS[i]; break; }
      }
      if (flight) fvOpenModal(flight);
    });
  });

  // FV dropdowns
  document.getElementById("fv-orig-select").addEventListener("change", function(e) {
    fvOrig = e.target.value;
    fvDest = "";
    document.getElementById("fv-dest-select").value = "";
    fvPopulateDest(fvOrig);
    fvLoadCompetitors(fvOrig, fvDest);
    fvApplyFilters();
  });
  document.getElementById("fv-dest-select").addEventListener("change", function(e) {
    fvDest = e.target.value;
    fvLoadCompetitors(fvOrig, fvDest);
    fvApplyFilters();
  });
  document.getElementById("fv-show-select").addEventListener("change", function(e) {
    fvShow = e.target.value;
    fvApplyFilters();
  });
  document.getElementById("fv-clear-btn").addEventListener("click", fvClearFilters);

  // FV modal close
  document.getElementById("fv-modal-close").addEventListener("click", closeFvModal);
  document.getElementById("fv-modal-backdrop").addEventListener("click", function(e) {
    if (e.target === this) closeFvModal();
  });

  // O&D View: initial render + change handler
  var odSel = document.getElementById("od-select");
  if (odSel) {
    odSel.addEventListener("change", function(e) { renderOdView(e.target.value); });
    if (OD_NETWORK_ROWS.length > 0) renderOdView(OD_NETWORK_ROWS[0].od);
  }

  // Keyboard escape
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") { closeOdModal(); closeFvModal(); }
  });
})();
</script>
</body>
</html>`;

// ── Write output ─────────────────────────────────────────────────────────────
mkdirSync(resolve(appRoot, "dist"), { recursive: true });
const outPath = resolve(appRoot, "dist", "dashboard-export.html");
writeFileSync(outPath, html, "utf8");
const sizeKb = (html.length / 1024).toFixed(1);
console.log(`\n✅ Written: dist/dashboard-export.html (size: ${sizeKb} KB)`);
console.log(`   Host airline : ${host}`);
console.log(`   Workset      : ${ws.label}`);
console.log(`   ODs          : ${odNetworkRows.length} network rows`);
console.log(`   Host flights : ${hostFlightRows.length} flights`);
console.log(`   ODs with data: ${odList.length}`);
