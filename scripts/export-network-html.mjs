/**
 * export-network-html.mjs
 * Generates dist/network-export.html — a fully self-contained interactive
 * HTML file showing the Network tab dashboard (scorecard + OD table + OD detail modal).
 * No server, no internet connection required.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const worksetsDir = resolve(appRoot, "public", "data", "worksets");
const indexPath = resolve(worksetsDir, "index.json");

if (!existsSync(indexPath)) {
  console.error("No worksets/index.json found. Run: npm run build first.");
  process.exit(1);
}

const worksetIndex = JSON.parse(readFileSync(indexPath, "utf8"));
if (!worksetIndex.length) { console.error("No worksets available."); process.exit(1); }

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

// Pre-compute OD network rows from bundle (same logic as AppSimple.jsx)
const host = bundle.profile.host_airline;
const grouped = new Map();
for (const row of bundle.level3_host_flight_summary || []) {
  const key = `${row.orig}-${row.dest}`;
  const cur = grouped.get(key) || { od: key, orig: row.orig, dest: row.dest, flights: 0, weeklyDeps: 0, localPax: 0, flowPax: 0, totalPax: 0, localRev: 0, flowRev: 0, totalRev: 0 };
  cur.flights += 1;
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

const hostPax = (bundle.level1_host_od_summary || []).reduce((s, r) => s + Number(r.weekly_pax_est || 0), 0);
const hostSeats = (bundle.level1_host_od_summary || []).reduce((s, r) => s + Number(r.weekly_seats_est || 0), 0);
const avgLF = hostSeats ? (hostPax / hostSeats) * 100 : 0;
const totalLocalPax = odNetworkRows.reduce((s, r) => s + r.localPax, 0);
const totalFlowPax = odNetworkRows.reduce((s, r) => s + r.flowPax, 0);
const totalLocalRev = odNetworkRows.reduce((s, r) => s + r.localRev, 0);
const totalFlowRev = odNetworkRows.reduce((s, r) => s + r.flowRev, 0);

function fmtN(v, d = 0) {
  return Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtPct(v, d = 1) { return `${fmtN(v, d)}%`; }
function splitBarHtml(localPct, flowPct) {
  const l = Math.max(0, Number(localPct || 0)), f = Math.max(0, Number(flowPct || 0));
  return `<div class="split-bar-wrap"><div class="split-bar"><div class="split-local" style="width:${l}%"></div><div class="split-flow" style="width:${f}%"></div></div><div class="split-legend"><span>Local ${fmtPct(l)}</span><span>Flow ${fmtPct(f)}</span></div></div>`;
}

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
  const rows = odNetworkRows.map((r) => `
    <tr class="row-clickable" data-od="${r.od}">
      <td><strong>${r.od}</strong></td>
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
      <thead><tr><th>OD</th><th>Wkly Deps</th><th>Local Pax</th><th>Flow Pax</th><th>Demand Mix</th><th>Local Revenue</th><th>Flow Revenue</th><th>Revenue Mix</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

const PIE_COLORS = ["#2065d1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6","#f97316","#06b6d4","#84cc16","#6366f1"];

const css = `
:root{--bg-app:#f1f5f9;--bg-card:#fff;--bg-card-hover:#f8fafc;--bg-elevated:#f1f5f9;--border-color:#e2e8f0;--text-primary:#0f172a;--text-secondary:#64748b;--accent:#0ea5e9;--accent-light:#0284c7;--success:#10b981;--success-muted:rgba(16,185,129,.12);--danger:#ef4444;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--text-primary);background:var(--bg-app)}
*{box-sizing:border-box}body{margin:0;background:var(--bg-app);color:var(--text-primary)}
.app-shell{min-height:100vh;background:var(--bg-app);padding:0}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 32px 16px;border-bottom:1px solid var(--border-color);background:#fff}
.topbar-brand .eyebrow{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text-secondary);margin-bottom:2px}
.topbar-brand h1{margin:0;font-size:1.4rem;font-weight:700;letter-spacing:-.02em}
.topbar-meta{font-size:.78rem;color:var(--text-secondary)}
.main-content{padding:24px 32px}
/* Scorecard */
.net-scorecard{display:flex;align-items:center;gap:0;background:#fff;border:1px solid var(--border-color);border-radius:12px;padding:16px 24px;margin-bottom:24px;flex-wrap:wrap}
.nsc-group{display:flex;align-items:center;gap:28px;flex:1;min-width:280px}
.nsc-divider-v{width:1px;background:var(--border-color);align-self:stretch;margin:0 20px}
.nsc-kpi{min-width:90px}
.nsc-kpi-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary)}
.nsc-kpi-value{font-size:1.55rem;font-weight:700;letter-spacing:-.03em;color:var(--text-primary);line-height:1.1}
.nsc-kpi-value.accent{color:var(--accent-light)}
.nsc-kpi-sub{font-size:.68rem;color:var(--text-secondary);margin-top:1px}
.nsc-lf-track{height:4px;background:var(--bg-elevated);border-radius:2px;margin-top:6px;overflow:hidden;width:80px}
.nsc-lf-fill{height:100%;background:var(--accent);border-radius:2px;transition:width .4s}
.nsc-split{min-width:180px}
.nsc-split-label{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-secondary);margin-bottom:4px}
.nsc-split-label small{font-size:.65rem;font-weight:400;text-transform:none;letter-spacing:0}
.nsc-split-nums{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.nsc-local-val{font-size:.95rem;font-weight:700;color:#2065d1}
.nsc-flow-val{font-size:.95rem;font-weight:700;color:#10b981}
.nsc-split-sep{color:var(--text-secondary);font-size:.8rem}
/* Split bar */
.split-bar-wrap{display:flex;flex-direction:column;gap:4px}
.split-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--bg-elevated)}
.split-local{background:#2065d1;transition:width .3s}
.split-flow{background:#10b981;transition:width .3s}
.split-legend{display:flex;justify-content:space-between;font-size:.68rem;color:var(--text-secondary)}
/* Table */
.table-section{background:#fff;border:1px solid var(--border-color);border-radius:12px;overflow:hidden;margin-bottom:24px}
.table-section-head{padding:16px 20px;border-bottom:1px solid var(--border-color);background:var(--bg-elevated)}
.table-section-head h3{margin:0 0 2px;font-size:.9rem;font-weight:600}
.table-section-head p{margin:0;font-size:.75rem;color:var(--text-secondary)}
.table-shell{overflow-x:auto}
.table-shell table{width:100%;border-collapse:collapse;font-size:.82rem}
.table-shell thead tr{background:var(--bg-elevated)}
.table-shell th{padding:10px 12px;text-align:left;font-size:.7rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border-color);white-space:nowrap}
.table-shell td{padding:9px 12px;border-bottom:1px solid var(--border-color);color:var(--text-primary)}
.table-shell tr:last-child td{border-bottom:none}
.row-clickable{cursor:pointer;transition:background .15s}
.row-clickable:hover td{background:var(--bg-card-hover)}
.row-selected td{background:rgba(32,101,209,.06)!important}
/* Modal */
.od-modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px;z-index:1000;overflow-y:auto}
.od-modal{background:#fff;border-radius:16px;width:100%;max-width:1100px;box-shadow:0 24px 80px rgba(0,0,0,.25);animation:modalIn .22s ease}
@keyframes modalIn{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:none}}
.od-modal-header{display:flex;align-items:flex-start;justify-content:space-between;padding:20px 24px 16px;border-bottom:1px solid var(--border-color)}
.od-modal-header h3{margin:0 0 4px;font-size:1.15rem;font-weight:700}
.od-modal-header p{margin:0;font-size:.78rem;color:var(--text-secondary)}
.od-close-btn{background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--text-secondary);padding:4px 8px;border-radius:6px;line-height:1}
.od-close-btn:hover{background:var(--bg-elevated);color:var(--text-primary)}
.od-modal-body{padding:20px 24px;display:flex;flex-direction:column;gap:20px}
.od-modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.chart-card{background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:10px;padding:16px}
.chart-head h3{margin:0 0 2px;font-size:.88rem;font-weight:600}
.chart-head p{margin:0 0 12px;font-size:.72rem;color:var(--text-secondary)}
/* Pie */
.pie-wrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.pie-legend{display:flex;flex-direction:column;gap:5px;font-size:.75rem;flex:1;min-width:100px}
.pie-legend-item{display:flex;align-items:center;gap:6px}
.pie-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.pie-label{flex:1;color:var(--text-primary)}
.pie-pct{font-weight:600;color:var(--text-secondary);font-variant-numeric:tabular-nums}
/* Breakdown list */
.breakdown-list{display:flex;flex-direction:column;gap:6px;font-size:.8rem;margin-top:8px}
.breakdown-item{display:flex;align-items:center;gap:8px}
.breakdown-item span:first-child{flex:1;color:var(--text-secondary)}
.breakdown-item strong{font-variant-numeric:tabular-nums}
.breakdown-pct{color:var(--text-secondary);font-size:.72rem}
.breakdown-divider{height:1px;background:var(--border-color);margin:4px 0}
.breakdown-section-label{font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary)}
/* OD Tables */
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
.itin-connecting td{background:rgba(245,158,11,.04)}
.od-table-empty{text-align:center;color:var(--text-secondary);font-style:italic;padding:20px}
/* QSI */
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
.loading-msg{padding:32px;text-align:center;color:var(--text-secondary);font-style:italic}
.empty-state{padding:24px;text-align:center;color:var(--text-secondary);font-style:italic}
@media(max-width:700px){.od-modal-grid{grid-template-columns:1fr}.nsc-group{gap:16px}}
`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ws.label} — Network Dashboard</title>
<style>${css}</style>
</head>
<body>
<div class="app-shell">
  <div class="topbar">
    <div class="topbar-brand">
      <div class="eyebrow">Airline Insights</div>
      <h1>${host} Ops Studio — Network</h1>
    </div>
    <div class="topbar-meta">${ws.label} &nbsp;·&nbsp; ${bundle.profile.host_eff_date || ""} &nbsp;·&nbsp; ${odNetworkRows.length} directional ODs</div>
  </div>
  <div class="main-content">
    ${scorecardHtml()}
    <div class="table-section">
      <div class="table-section-head">
        <h3>Host Network Portfolio</h3>
        <p>Click any row to see OD detail — market share, demand mix, itineraries, and competitive metrics</p>
      </div>
      ${networkTableHtml()}
    </div>
  </div>
</div>

<!-- OD Detail Modal -->
<div id="od-modal-backdrop" style="display:none">
  <div class="od-modal">
    <div class="od-modal-header">
      <div><h3 id="modal-title">OD Detail</h3><p>Airline shares · host vs competitors · local/flow mix · direct vs connecting</p></div>
      <button class="od-close-btn" id="modal-close-btn">✕</button>
    </div>
    <div class="od-modal-body" id="modal-body"><div class="loading-msg">Loading…</div></div>
  </div>
</div>

<script>
const HOST_AIRLINE = ${JSON.stringify(host)};
const OD_ROWS = ${JSON.stringify(odNetworkRows)};
const FLIGHT_DATA = ${JSON.stringify(allFlightData)};
const ITIN_DATA = ${JSON.stringify(allItinData)};
const PIE_COLORS = ${JSON.stringify(PIE_COLORS)};

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtN(v, d=0){ return Number(v||0).toLocaleString("en-IN",{maximumFractionDigits:d,minimumFractionDigits:d}); }
function fmtPct(v,d=1){ return fmtN(v,d)+"%"; }

function countFreqDays(freq){ return String(freq||"").split("").filter(c=>c!==".").length; }
function parseElap(s){ const p=String(s||"0:0").split(":").map(Number); return (p[0]||0)*60+(p[1]||0); }

function splitBarHtml(lp,fp){
  const l=Math.max(0,Number(lp||0)),f=Math.max(0,Number(fp||0));
  return \`<div class="split-bar-wrap"><div class="split-bar"><div class="split-local" style="width:\${l}%"></div><div class="split-flow" style="width:\${f}%"></div></div><div class="split-legend"><span>Local \${fmtPct(l)}</span><span>Flow \${fmtPct(f)}</span></div></div>\`;
}

function pieChartSvg(slices, size=150){
  const total=slices.reduce((s,x)=>s+x.value,0); if(!total) return "<em>No data</em>";
  const cx=size/2,cy=size/2,r=size*0.42; let angle=-Math.PI/2;
  const paths=slices.filter(s=>s.value>0).map((sl,i)=>{
    const frac=sl.value/total,start=angle,end=angle+frac*2*Math.PI; angle=end;
    const x1=cx+r*Math.cos(start),y1=cy+r*Math.sin(start),x2=cx+r*Math.cos(end),y2=cy+r*Math.sin(end);
    const col=PIE_COLORS[i%PIE_COLORS.length];
    const d=\`M\${cx},\${cy} L\${x1},\${y1} A\${r},\${r} 0 \${frac>.5?1:0} 1 \${x2},\${y2} Z\`;
    return {d,col,label:sl.label,pct:frac*100};
  });
  const svgPaths=paths.map(p=>\`<path d="\${p.d}" fill="\${p.col}" stroke="#fff" stroke-width="1.5"/>\`).join("");
  const legend=paths.map(p=>\`<div class="pie-legend-item"><span class="pie-dot" style="background:\${p.col}"></span><span class="pie-label">\${p.label}</span><span class="pie-pct">\${fmtPct(p.pct)}</span></div>\`).join("");
  return \`<div class="pie-wrap"><svg viewBox="0 0 \${size} \${size}" width="\${size}" height="\${size}">\${svgPaths}</svg><div class="pie-legend">\${legend}</div></div>\`;
}

function qsiChartHtml(qsiRows){
  if(!qsiRows.length) return "<div class=\\"empty-state\\">No QSI data</div>";
  const metrics=[
    {key:"share",label:"Share (%)",rel:false,note:null},
    {key:"nstops",label:"No of Nonstops",rel:false,note:null},
    {key:"cncts",label:"No of Connections",rel:false,note:null},
    {key:"elapScore",label:"Elapsed Time",rel:true,note:"market-relative speed advantage"},
    {key:"opp",label:"OPP",rel:true,note:"log frequency ratio vs market avg"},
    {key:"service",label:"Service",rel:true,note:"N/A — requires external model params"},
    {key:"equipment",label:"Equipment",rel:true,note:"N/A — requires external model params"},
    {key:"alnPref",label:"Airline Preference",rel:true,note:"N/A — requires survey data"},
    {key:"metroPref",label:"Metro Preference",rel:true,note:"N/A — requires survey data"},
    {key:"sr",label:"Service Ratio",rel:true,note:"N/A — requires external model params"},
    {key:"tow",label:"TOW",rel:true,note:"N/A — requires external model params"},
    {key:"relFare",label:"Relative Fare",rel:true,note:"airline yield vs market avg yield"},
    {key:"rsqm",label:"RSQM",rel:true,note:"N/A — residual from demand model"},
  ];
  const header=qsiRows.map((r,i)=>\`<div class="qsi-airline-header" style="color:\${PIE_COLORS[i%PIE_COLORS.length]}">\${r.code}</div>\`).join("");
  const metricRows=metrics.map(m=>{
    const vals=qsiRows.map(r=>r[m.key]||0);
    const maxAbs=Math.max(...vals.map(Math.abs),0.001);
    const allZero=vals.every(v=>v===0);
    const bars=qsiRows.map((r,i)=>{
      const v=r[m.key]||0,pct=Math.abs(v)/maxAbs*85,isNeg=v<0,col=PIE_COLORS[i%PIE_COLORS.length];
      const fmt=m.key==="share"?fmtPct(v,2):fmtN(v,2);
      const bar=m.rel
        ? \`<div class="qsi-relative-track"><div class="qsi-neg-half">\${isNeg?\`<div class="qsi-fill" style="width:\${pct}%;background:\${col};opacity:\${allZero?.25:1}"></div>\`:""}</div><div class="qsi-center-tick"></div><div class="qsi-pos-half">\${!isNeg?\`<div class="qsi-fill" style="width:\${pct}%;background:\${col};opacity:\${allZero?.25:1}"></div>\`:""}</div></div>\`
        : \`<div class="qsi-pos-track"><div class="qsi-fill" style="width:\${pct}%;background:\${col}"></div></div>\`;
      const dispVal=allZero&&m.note?"—":fmt;
      const valColor=allZero&&m.note?"var(--text-secondary)":"var(--text-primary)";
      return \`<div class="qsi-bar-line">\${bar}<span class="qsi-val" style="color:\${valColor}">\${dispVal}</span></div>\`;
    }).join("");
    const naClass=allZero&&m.note?" qsi-na":"";
    const noteHtml=m.note?\`<span class="qsi-note" title="\${m.note}">ⓘ</span>\`:"";
    return \`<div class="qsi-metric-row\${naClass}"><div class="qsi-metric-label"><span>\${m.label}</span>\${noteHtml}</div><div class="qsi-bars-col">\${bars}</div></div>\`;
  }).join("");
  return \`<div class="qsi-chart"><div class="qsi-header-row"><div class="qsi-metric-col"></div>\${header}</div>\${metricRows}<div class="qsi-footnote">ⓘ = derived from data · — = requires external model parameters</div></div>\`;
}

// ── main modal render ─────────────────────────────────────────────────────────
function renderModal(od){
  const flightRows=FLIGHT_DATA[od]||[];
  const itinRows=ITIN_DATA[od]||[];
  const odRow=OD_ROWS.find(r=>r.od===od);

  // Chart 1: Airline market share
  const alnMap=new Map();
  for(const r of flightRows){
    const code=String(r["Flt Desg"]||"").trim().split(" ")[0]||"?";
    alnMap.set(code,(alnMap.get(code)||0)+Number(r["Total Traffic"]||0));
  }
  const airlineSlices=[...alnMap.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);

  // Chart 2: Host vs competitors
  let hostTr=0,compTr=0;
  for(const r of flightRows){
    const tr=Number(r["Total Traffic"]||0);
    if(String(r["Flt Desg"]||"").trim().startsWith(HOST_AIRLINE+" ")) hostTr+=tr; else compTr+=tr;
  }
  const hvCSlices=[{label:HOST_AIRLINE,value:hostTr},{label:"Competitors",value:compTr}];
  const hvCTotal=(hostTr+compTr)||1;
  const hvCBreakdown=hvCSlices.map(s=>\`<div class="breakdown-item"><span>\${s.label}</span><strong>\${fmtN(s.value,1)}</strong><span class="breakdown-pct">\${fmtPct(s.value/hvCTotal*100)}</span></div>\`).join("");

  // Chart 3: Demand & Revenue Mix
  let demRevHtml="<div class=\\"empty-state\\">No data</div>";
  if(odRow){
    demRevHtml=\`<div class="breakdown-list">
      <div class="breakdown-section-label">Passengers</div>
      <div class="breakdown-item"><span>Local Pax</span><strong>\${fmtN(odRow.localPax,1)}</strong><span class="breakdown-pct">\${fmtPct(odRow.localDemandPct)}</span></div>
      <div class="breakdown-item"><span>Flow Pax</span><strong>\${fmtN(odRow.flowPax,1)}</strong><span class="breakdown-pct">\${fmtPct(odRow.flowDemandPct)}</span></div>
      \${splitBarHtml(odRow.localDemandPct,odRow.flowDemandPct)}
      <div class="breakdown-divider"></div>
      <div class="breakdown-section-label">Revenue</div>
      <div class="breakdown-item"><span>Local Revenue</span><strong>\${fmtN(odRow.localRev)}</strong><span class="breakdown-pct">\${fmtPct(odRow.localRevPct)}</span></div>
      <div class="breakdown-item"><span>Flow Revenue</span><strong>\${fmtN(odRow.flowRev)}</strong><span class="breakdown-pct">\${fmtPct(odRow.flowRevPct)}</span></div>
      \${splitBarHtml(odRow.localRevPct,odRow.flowRevPct)}
    </div>\`;
  }

  // Chart 4: Direct vs Connecting
  const dirTr=itinRows.filter(r=>Number(r["Stops"]||0)===0).reduce((s,r)=>s+Number(r["Total Traffic"]||0),0);
  const conTr=itinRows.filter(r=>Number(r["Stops"]||0)>0).reduce((s,r)=>s+Number(r["Total Traffic"]||0),0);
  const dcBreakdown=\`<div class="breakdown-list" style="margin-top:12px"><div class="breakdown-item"><span>Direct</span><strong>\${fmtN(dirTr,1)}</strong></div><div class="breakdown-item"><span>Connecting</span><strong>\${fmtN(conTr,1)}</strong></div></div>\`;

  // Market Summary table
  const mktGroups=new Map();
  const marketOd=od.replace("-","");
  for(const r of itinRows){
    const aln=String(r["Flt Desg (Seg1)"]||"").trim().split(/\\s+/)[0]||"?";
    const stops=Number(r["Stops"]||0),freq=countFreqDays(r["Freq"]);
    const dem=Number(r["Total Demand"]||0),tr=Number(r["Total Traffic"]||0),rev=Number(r["Pax Revenue($)"]||0);
    const g=mktGroups.get(aln)||{aln,market:marketOd,nstps:0,thrus:0,cncts:0,demand:0,traffic:0,revenue:0};
    if(stops===0) g.nstps+=freq; else g.cncts+=freq;
    g.demand+=dem; g.traffic+=tr; g.revenue+=rev;
    mktGroups.set(aln,g);
  }
  const mktRows=[...mktGroups.values()].sort((a,b)=>b.demand-a.demand);
  const mktDem=mktRows.reduce((s,r)=>s+r.demand,0)||1,mktTr=mktRows.reduce((s,r)=>s+r.traffic,0)||1,mktRev=mktRows.reduce((s,r)=>s+r.revenue,0)||1;
  const mktTableBody=mktRows.map(r=>\`<tr>
    <td>\${r.market}</td><td><strong>\${r.aln}</strong></td><td>\${r.nstps}</td><td>\${r.thrus}</td><td>\${r.cncts}</td>
    <td>\${fmtN(mktDem,1)}</td><td>\${fmtN(r.demand,1)}</td><td>\${fmtN(r.demand,1)}</td><td>0.0</td><td>\${fmtPct(r.demand/mktDem*100,2)}</td>
    <td>\${fmtN(r.traffic,1)}</td><td>\${fmtN(r.traffic,1)}</td><td>0.0</td><td>\${fmtPct(r.traffic/mktTr*100,2)}</td>
    <td>\${fmtN(r.revenue)}</td><td>\${fmtN(r.revenue)}</td><td>0.0</td><td>\${fmtPct(r.revenue/mktRev*100,2)}</td>
  </tr>\`).join("");

  // Itinerary table
  const itinTableBody=itinRows.map(r=>{
    const cls=Number(r["Stops"]||0)>0?' class="itin-connecting"':"";
    return \`<tr\${cls}>
      <td>\${r["Dept Arp"]}</td><td>\${r["Arvl Arp"]}</td><td><strong>\${r["Flt Desg (Seg1)"]}</strong></td>
      <td>\${r["Connect Point 1"]==="*"?"—":r["Connect Point 1"]||"—"}</td>
      <td>\${r["Minimum Connect Time 1"]||"—"}</td><td>\${r["Connect Time 1"]||"—"}</td>
      <td>\${r["Flt Desg (Seg2)"]==="*"?"—":r["Flt Desg (Seg2)"]||"—"}</td>
      <td>\${r["Connect Point 2"]==="*"?"—":r["Connect Point 2"]||"—"}</td>
      <td>\${r["Minimum Connect Time 2"]||"—"}</td><td>\${r["Connect Time 2"]||"—"}</td>
      <td>\${r["Flt Desg (Seg3)"]==="*"?"—":r["Flt Desg (Seg3)"]||"—"}</td>
      <td>\${r["Stops"]}</td><td>\${r["Segs"]}</td><td>\${r["Freq"]}</td>
      <td>\${r["Dept Time"]}</td><td>\${r["Arvl Time"]}</td><td>\${r["Elap Time"]}</td>
      <td>\${fmtN(r["Total Demand"],1)}</td><td>\${fmtN(r["Total Traffic"],1)}</td><td>\${fmtN(r["Pax Revenue($)"])}</td>
    </tr>\`;
  }).join("");

  // QSI rows
  const alnAgg=new Map();
  for(const r of itinRows){
    const aln=String(r["Flt Desg (Seg1)"]||"").trim().split(/\\s+/)[0]||"?";
    const stops=Number(r["Stops"]||0),freq=countFreqDays(r["Freq"]),elap=parseElap(r["Elap Time"]);
    const dem=Number(r["Total Demand"]||0),tr=Number(r["Total Traffic"]||0);
    const g=alnAgg.get(aln)||{aln,nstops:0,cncts:0,demand:0,traffic:0,elapW:0};
    if(stops===0) g.nstops+=freq; else g.cncts+=freq;
    g.demand+=dem; g.traffic+=tr; g.elapW+=elap*tr;
    alnAgg.set(aln,g);
  }
  const yldMap=new Map();
  for(const r of flightRows){
    const aln=String(r["Flt Desg"]||"").trim().split(/\\s+/)[0]||"?";
    const y=yldMap.get(aln)||{traffic:0,revenue:0};
    y.traffic+=Number(r["Total Traffic"]||0); y.revenue+=Number(r["Pax Revenue($)"]||0);
    yldMap.set(aln,y);
  }
  const alns=[...alnAgg.values()];
  const totDem=alns.reduce((s,a)=>s+a.demand,0)||1,totTr=alns.reduce((s,a)=>s+a.traffic,0)||1;
  const mktElap=alns.reduce((s,a)=>s+a.elapW,0)/totTr||1;
  const mktYld=[...yldMap.values()].reduce((s,y)=>s+y.revenue,0)/totTr||1;
  const n=alns.length||1,totFreq=alns.reduce((s,a)=>s+a.nstops+a.cncts,0)||1;
  const qsiRows=alns.map(a=>{
    const share=(a.demand/totDem)*100,avgElap=a.traffic>0?a.elapW/a.traffic:0;
    const elapScore=mktElap>0?((mktElap-avgElap)/mktElap)*100:0;
    const airlineFreq=a.nstops+a.cncts;
    const opp=airlineFreq>0?Math.log(n*airlineFreq/totFreq):0;
    const yld=yldMap.get(a.aln),alnYld=yld&&yld.traffic>0?yld.revenue/yld.traffic:0;
    const relFare=mktYld>0?((alnYld-mktYld)/mktYld)*100:0;
    return {code:a.aln,share,nstops:a.nstops,cncts:a.cncts,elapScore,opp,relFare,service:0,equipment:0,alnPref:0,metroPref:0,sr:0,tow:0,rsqm:0};
  }).sort((x,y)=>y.share-x.share);

  document.getElementById("modal-title").textContent=\`\${od} — Market Detail\`;
  document.getElementById("modal-body").innerHTML=\`
    <div class="od-modal-grid">
      <div class="chart-card"><div class="chart-head"><h3>Airline Market Share</h3><p>All carriers — share of total traffic</p></div>\${pieChartSvg(airlineSlices)}</div>
      <div class="chart-card"><div class="chart-head"><h3>Host vs Competitors</h3><p>Host airline share vs market</p></div>\${pieChartSvg(hvCSlices,140)}<div class="breakdown-list" style="margin-top:10px">\${hvCBreakdown}</div></div>
      <div class="chart-card"><div class="chart-head"><h3>Demand &amp; Revenue Mix</h3><p>Local vs flow contribution (host)</p></div>\${demRevHtml}</div>
      <div class="chart-card"><div class="chart-head"><h3>Direct vs Connecting</h3><p>Traffic split by itinerary type</p></div>\${pieChartSvg([{label:"Direct",value:dirTr},{label:"Connecting",value:conTr}],140)}\${dcBreakdown}</div>
    </div>

    <div class="od-table-section">
      <div class="od-table-section-head"><h4>Market Summary by Airline</h4><p>Aggregated demand, traffic &amp; revenue share per carrier</p></div>
      <div class="od-table-scroll">
        <table class="od-data-table"><thead><tr>
          <th>Market</th><th>Airline</th><th>NStps</th><th>Thrus</th><th>Cncts</th>
          <th>Mkt Size</th><th>Total Demand</th><th>Op Demand</th><th>NonOp Dem</th><th>Dem Share%</th>
          <th>Total Traffic</th><th>Op Traffic</th><th>NonOp Tr</th><th>Tr Share%</th>
          <th>Pax Revenue</th><th>Op Revenue</th><th>NonOp Rev</th><th>Rev Share%</th>
        </tr></thead><tbody>\${mktTableBody||'<tr><td colspan="18" class="od-table-empty">No data</td></tr>'}</tbody></table>
      </div>
    </div>

    <div class="od-table-section">
      <div class="od-table-section-head"><h4>Itinerary Report</h4><p>All itineraries for this OD including connections</p></div>
      <div class="od-table-scroll">
        <table class="od-data-table"><thead><tr>
          <th>Dept Arp</th><th>Arvl Arp</th><th>Flt Desg (Seg1)</th>
          <th>Cnct Pt 1</th><th>Min Cnct 1</th><th>Cnct Time 1</th>
          <th>Flt Desg (Seg2)</th><th>Cnct Pt 2</th><th>Min Cnct 2</th><th>Cnct Time 2</th>
          <th>Flt Desg (Seg3)</th><th>Stops</th><th>Segs</th><th>Freq</th>
          <th>Dept</th><th>Arvl</th><th>Elap</th>
          <th>Demand</th><th>Traffic</th><th>Pax Rev</th>
        </tr></thead><tbody>\${itinTableBody||'<tr><td colspan="20" class="od-table-empty">No data</td></tr>'}</tbody></table>
      </div>
    </div>

    <div class="od-table-section">
      <div class="od-table-section-head"><h4>Competitive Position (QSI Factors)</h4><p>Derived metrics · — requires external model parameters</p></div>
      <div style="padding:16px">\${qsiChartHtml(qsiRows)}</div>
    </div>
  \`;
}

// ── event wiring ──────────────────────────────────────────────────────────────
let activeOd=null;
const backdrop=document.getElementById("od-modal-backdrop");

document.querySelectorAll(".row-clickable").forEach(tr=>{
  tr.addEventListener("click",()=>{
    const od=tr.dataset.od;
    if(od===activeOd){ backdrop.style.display="none"; activeOd=null; tr.classList.remove("row-selected"); return; }
    document.querySelectorAll(".row-selected").forEach(r=>r.classList.remove("row-selected"));
    tr.classList.add("row-selected");
    activeOd=od;
    backdrop.style.display="flex";
    renderModal(od);
  });
});
document.getElementById("modal-close-btn").addEventListener("click",()=>{ backdrop.style.display="none"; activeOd=null; document.querySelectorAll(".row-selected").forEach(r=>r.classList.remove("row-selected")); });
backdrop.addEventListener("click",e=>{ if(e.target===backdrop){ backdrop.style.display="none"; activeOd=null; document.querySelectorAll(".row-selected").forEach(r=>r.classList.remove("row-selected")); } });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&backdrop.style.display!=="none"){ backdrop.style.display="none"; activeOd=null; document.querySelectorAll(".row-selected").forEach(r=>r.classList.remove("row-selected")); } });
</script>
</body>
</html>`;

mkdirSync(resolve(appRoot, "dist"), { recursive: true });
const out = resolve(appRoot, "dist", "network-export.html");
writeFileSync(out, html, "utf8");
console.log(`\nExported: ${out}`);
console.log(`File size: ${(html.length / 1024).toFixed(1)} KB`);
console.log(`ODs with data: ${odList.length}`);
