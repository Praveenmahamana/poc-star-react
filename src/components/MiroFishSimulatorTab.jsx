import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_MIROFISH_APP_URL = import.meta.env.VITE_MIROFISH_APP_URL || "http://127.0.0.1:3000";
const DEFAULT_MIROFISH_API_URL = import.meta.env.VITE_MIROFISH_API_URL || "http://127.0.0.1:5001";

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function toNum(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
}

function formatNum(value, digits = 0) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(toNum(value));
}

function pickTop(items, metric, limit) {
  return [...(items || [])]
    .sort((a, b) => toNum(b?.[metric]) - toNum(a?.[metric]))
    .slice(0, limit);
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function makeStepState() {
  return [
    { id: 1, name: "Graph Build", status: "pending", detail: "Build market-competition graph from worksets." },
    { id: 2, name: "Env Setup", status: "pending", detail: "Create route/airline personas and simulation context." },
    { id: 3, name: "Run Simulation", status: "pending", detail: "Run local opportunity + competition simulation." },
    { id: 4, name: "Report Generation", status: "pending", detail: "Generate file-level change recommendations." },
    { id: 5, name: "Deep Interaction", status: "pending", detail: "Enable drill-down and route-level patch review." },
  ];
}

function buildMergedGraphFromGraphPacks(graphPacks) {
  const nodeMap = new Map();
  const edges = [];
  for (const pack of graphPacks || []) {
    for (const n of pack?.nodes || []) {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
    }
    for (const e of pack?.edges || []) {
      edges.push(e);
    }
  }
  const nodes = [...nodeMap.values()].slice(0, 260);
  const keep = new Set(nodes.map((n) => n.id));
  const trimmedEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target)).slice(0, 460);
  return { nodes, edges: trimmedEdges };
}

function computeForceLayout(graph, width = 900, height = 420, iterations = 180) {
  const nodes = (graph?.nodes || []).map((n, i) => ({
    ...n,
    x: (i % 24) * (width / 24) + 20,
    y: Math.floor(i / 24) * 32 + 20,
    vx: 0,
    vy: 0,
  }));
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const links = (graph?.edges || [])
    .map((e) => ({ s: index.get(e.source), t: index.get(e.target) }))
    .filter((l) => l.s != null && l.t != null);

  const repulsion = 1200;
  const spring = 0.02;
  const desired = 38;

  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = Math.max(20, dx * dx + dy * dy);
        const d = Math.sqrt(d2);
        const f = repulsion / d2;
        dx /= d;
        dy /= d;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
    }
    for (const l of links) {
      const a = nodes[l.s];
      const b = nodes[l.t];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const diff = d - desired;
      const f = spring * diff;
      dx /= d;
      dy /= d;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const n of nodes) {
      n.vx *= 0.84;
      n.vy *= 0.84;
      n.x = clamp(n.x + n.vx, 10, width - 10);
      n.y = clamp(n.y + n.vy, 10, height - 10);
    }
  }

  const points = Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y, type: n.type, label: n.label }]));
  return { points, width, height };
}

function nodeColor(type) {
  if (type === "airline") return "#2563eb";
  if (type === "od") return "#0ea5e9";
  if (type === "flight") return "#f59e0b";
  if (type === "workset") return "#10b981";
  return "#64748b";
}

function formatChangePlan(changePlan) {
  if (!Array.isArray(changePlan) || !changePlan.length) return "-";
  return changePlan
    .slice(0, 3)
    .map((c) => {
      const cols = (c.columns || []).join("|");
      const selector = c.row_selector
        ? Object.entries(c.row_selector).map(([k, v]) => `${k}=${v}`).join(",")
        : "selector=n/a";
      return `${c.file} [${cols}] (${selector}) ${c.delta_hint || ""}`.trim();
    })
    .join(" || ");
}

function buildPatchRowsFromSimRows(rows) {
  const patchRows = [];
  for (const r of rows || []) {
    for (const c of r.fileChanges || []) {
      patchRows.push({
        worksetId: r.worksetId,
        od: r.od,
        file: c.file,
        columns: (c.columns || []).join(", "),
        rowSelector: c.row_selector ? Object.entries(c.row_selector).map(([k, v]) => `${k}=${v}`).join("; ") : "-",
        action: c.action || "-",
        deltaHint: c.delta_hint || "-",
        reason: c.reason || "-",
        expectedEffect: c.expected_effect || "-",
        confidence: c.confidence || "-",
      });
    }
  }
  return patchRows;
}

function applyWhatIfToRows(rows, whatIf) {
  const fareShiftPct = toNum(whatIf?.fareShiftPct);
  const spillCaptureDelta = toNum(whatIf?.spillCaptureDelta);
  const compResponseDelta = toNum(whatIf?.compResponseDelta);
  const adjusted = (rows || []).map((r) => {
    const expectedShareShift = (-fareShiftPct * 0.45) + (spillCaptureDelta * 18) + (compResponseDelta * 0.8);
    const hostSharePct = clamp(toNum(r.hostSharePct) + expectedShareShift, 0, 100);
    const topCompSharePct = clamp(toNum(r.topCompSharePct) - (expectedShareShift * 0.7), 0, 100);
    const signedDiffPct = toNum(r.signedDiffPct) - (spillCaptureDelta * 22) + (fareShiftPct * 0.35) - (compResponseDelta * 0.25);
    const flowPct = clamp(toNum(r.flowPct) - (compResponseDelta * 0.3) + (spillCaptureDelta * 4), 0, 100);
    const fareGapPct = toNum(r.fareGapPct) + fareShiftPct;
    const competitiveGap = Math.max(0, topCompSharePct - hostSharePct);
    const demandGap = Math.abs(signedDiffPct);
    const networkLeverage = toNum(r.marketDemand) * (1 + flowPct / 100);
    return {
      ...r,
      hostSharePct,
      topCompSharePct,
      signedDiffPct,
      flowPct,
      fareGapPct,
      competitiveGap,
      demandGap,
      networkLeverage,
      simulationTag: `fare ${fareShiftPct >= 0 ? "+" : ""}${formatNum(fareShiftPct, 1)}% | spill ${spillCaptureDelta >= 0 ? "+" : ""}${formatNum(spillCaptureDelta, 2)} | comp ${compResponseDelta >= 0 ? "+" : ""}${formatNum(compResponseDelta, 1)} pts`,
    };
  });

  const maxLeverage = Math.max(1, ...adjusted.map((r) => toNum(r.networkLeverage)));
  const maxCompGap = Math.max(1, ...adjusted.map((r) => toNum(r.competitiveGap)));
  const maxError = Math.max(1, ...adjusted.map((r) => toNum(r.demandGap)));
  for (const r of adjusted) {
    const leverageScore = (toNum(r.networkLeverage) / maxLeverage) * 45;
    const compScore = (toNum(r.competitiveGap) / maxCompGap) * 30;
    const errorScore = (toNum(r.demandGap) / maxError) * 25;
    r.oppScore = clamp(leverageScore + compScore + errorScore, 0, 100);
    r.graphReasoning = `Leverage ${formatNum(leverageScore, 1)} + competition ${formatNum(compScore, 1)} + error ${formatNum(errorScore, 1)}`;
  }
  return adjusted.sort((a, b) => toNum(b.oppScore) - toNum(a.oppScore));
}

function mergeAiInsightsIntoRows(rows, aiByKey) {
  return (rows || []).map((r) => {
    const key = `${r.worksetId}::${r.od}`;
    const ai = aiByKey?.[key];
    if (!ai) return r;
    return {
      ...r,
      aiAbnormalityType: ai.abnormality_type || "-",
      aiConfidence: ai.confidence || "-",
      aiReason: ai.reason || "-",
      aiSuggestedAction: ai.suggested_action || "-",
      aiExpectedMeasurement: ai.expected_measurement || "-",
      aiCompetitorCommentary: ai.competitor_commentary || "-",
      aiChanges: Array.isArray(ai.changes) ? ai.changes : [],
    };
  });
}

function buildWorksetValidation(bundle, hostAirline) {
  const host = normalizeCode(hostAirline || bundle?.profile?.host_airline || "HOST");
  const level1 = Array.isArray(bundle?.level1_host_od_summary) ? bundle.level1_host_od_summary : [];
  const level2 = Array.isArray(bundle?.level2_od_airline_share_summary) ? bundle.level2_od_airline_share_summary : [];
  const level3 = Array.isArray(bundle?.level3_host_flight_summary) ? bundle.level3_host_flight_summary : [];

  const carrierByOd = new Map();
  for (const r of level2) {
    const od = `${normalizeCode(r.orig)}-${normalizeCode(r.dest)}`;
    const arr = carrierByOd.get(od) || [];
    arr.push(r);
    carrierByOd.set(od, arr);
  }

  const odChecks = {};
  let invalidCount = 0;
  let noShareDataCount = 0;
  let shareGapSum = 0;
  let shareGapN = 0;
  let impossibleLfCount = 0;

  for (const r of level1) {
    const od = `${normalizeCode(r.orig)}-${normalizeCode(r.dest)}`;
    const hostShareL1 = toNum(r.host_share_of_market_demand_pct_est);
    const rows = carrierByOd.get(od) || [];
    const totalDemand = rows.reduce((s, x) => s + toNum(x.total_demand_est), 0);
    const hostDemand = rows.filter((x) => normalizeCode(x.carrier) === host).reduce((s, x) => s + toNum(x.total_demand_est), 0);
    const hostShareL2 = totalDemand > 0 ? (hostDemand / totalDemand) * 100 : null;
    const shareGap = hostShareL2 == null ? null : Math.abs(hostShareL1 - hostShareL2);
    const lf = toNum(r.apm_load_factor_pct_est || r.load_factor_pct_est);
    const impossibleLf = lf > 145 || lf < 0;
    if (impossibleLf) impossibleLfCount += 1;
    if (shareGap != null) {
      shareGapSum += shareGap;
      shareGapN += 1;
    }
    const hasShareData = rows.length > 0 && totalDemand > 0;
    if (!hasShareData) noShareDataCount += 1;
    const isValid = hasShareData && (shareGap == null || shareGap <= 12) && !impossibleLf;
    if (!isValid) invalidCount += 1;
    odChecks[od] = {
      hasShareData,
      shareGapPct: shareGap,
      impossibleLf,
      isValid,
      reason: !hasShareData ? "No carrier share records in level2." : (impossibleLf ? "LF outside plausible range." : ((shareGap != null && shareGap > 12) ? `L1 vs L2 host-share gap ${formatNum(shareGap, 1)} pts.` : "OK")),
    };
  }

  const avgShareGapPct = shareGapN > 0 ? (shareGapSum / shareGapN) : 0;
  const totalRoutes = level1.length;
  const validRoutes = Math.max(0, totalRoutes - invalidCount);
  const score = clamp(
    100
      - (totalRoutes > 0 ? (invalidCount / totalRoutes) * 55 : 0)
      - clamp(avgShareGapPct, 0, 25) * 1.5
      - (totalRoutes > 0 ? (impossibleLfCount / totalRoutes) * 20 : 0),
    0,
    100,
  );

  return {
    score,
    totalRoutes,
    validRoutes,
    avgShareGapPct,
    impossibleLfCount,
    noShareDataCount,
    level3Flights: level3.length,
    odChecks,
  };
}

function buildEntitiesFromBundle(worksetId, bundle, hostAirline) {
  const host = normalizeCode(hostAirline || bundle?.profile?.host_airline || "HOST");
  const level1 = Array.isArray(bundle?.level1_host_od_summary) ? bundle.level1_host_od_summary : [];
  const level2 = Array.isArray(bundle?.level2_od_airline_share_summary) ? bundle.level2_od_airline_share_summary : [];
  const level3 = Array.isArray(bundle?.level3_host_flight_summary) ? bundle.level3_host_flight_summary : [];

  const entities = [];
  const seen = new Set();
  const pushEntity = (id, type, name, attrs = {}, weight = 1) => {
    if (seen.has(id)) return;
    seen.add(id);
    entities.push({ id, type, name, worksetId, weight, attrs });
  };

  for (const r of level1.slice(0, 220)) {
    const orig = normalizeCode(r.orig);
    const dest = normalizeCode(r.dest);
    if (!orig || !dest) continue;
    const od = `${orig}-${dest}`;
    pushEntity(
      `route:${worksetId}:${od}`,
      "route",
      od,
      {
        origin: orig,
        destination: dest,
        marketDemand: toNum(r.market_weekly_demand),
        hostSharePct: toNum(r.host_share_of_market_demand_pct_est),
        flowPct: toNum(r.flow_apm_pct_est || r.flow_pdd_pct_est),
      },
      toNum(r.market_weekly_demand),
    );
  }

  const carrierDemand = new Map();
  for (const r of level2) {
    const c = normalizeCode(r.carrier);
    carrierDemand.set(c, (carrierDemand.get(c) || 0) + toNum(r.total_demand_est));
  }
  for (const [carrier, demand] of carrierDemand.entries()) {
    if (!carrier) continue;
    pushEntity(
      `airline:${worksetId}:${carrier}`,
      carrier === host ? "host_airline" : "competitor_airline",
      carrier,
      { totalDemand: demand, isHost: carrier === host },
      demand,
    );
  }

  for (const r of level3.slice(0, 250)) {
    const fn = String(r.flight_number || "").trim() || "NA";
    const orig = normalizeCode(r.orig);
    const dest = normalizeCode(r.dest);
    if (!orig || !dest) continue;
    pushEntity(
      `flight:${worksetId}:${orig}-${dest}-${fn}`,
      "flight",
      `${fn} ${orig}-${dest}`,
      {
        flightNumber: fn,
        origin: orig,
        destination: dest,
        weeklyPax: toNum(r.weekly_pax_est),
        weeklySeats: toNum(r.weekly_seats_est),
      },
      toNum(r.weekly_pax_est),
    );
  }

  return entities;
}

function generatePersonasFromEntities(entities, hostAirline) {
  const host = normalizeCode(hostAirline || "HOST");
  const byType = new Map();
  for (const e of entities || []) {
    const arr = byType.get(e.type) || [];
    arr.push(e);
    byType.set(e.type, arr);
  }
  const topRoutes = [...(byType.get("route") || [])].sort((a, b) => toNum(b.weight) - toNum(a.weight)).slice(0, 6);
  const topCompetitors = [...(byType.get("competitor_airline") || [])].sort((a, b) => toNum(b.weight) - toNum(a.weight)).slice(0, 4);

  const personas = [];
  personas.push({
    id: "host-network-planner",
    role: "Host Network Planner",
    entityType: "host_airline",
    name: `${host} Network Planner`,
    bio: `Owns route profitability, local-flow balance, and schedule fit for ${host}.`,
    stance: "defend-and-grow",
    topics: ["capacity", "fare", "market share", "OD opportunity"],
  });
  personas.push({
    id: "spill-recovery-analyst",
    role: "Spill Recovery Analyst",
    entityType: "route",
    name: `${host} Spill Recovery Analyst`,
    bio: "Tracks OD spill and recommends practical recovery actions with measurable uplift.",
    stance: "yield-focused",
    topics: ["spill capture", "yield uplift", "demand elasticity", "share recovery"],
  });
  personas.push({
    id: "connectivity-manager",
    role: "Connectivity Manager",
    entityType: "route",
    name: "Flow Connectivity Manager",
    bio: "Owns flow/local rebalance and connection-path performance signals.",
    stance: "flow-optimizer",
    topics: ["flow mix", "local mix", "spill leakage", "elapsed-time effects"],
  });

  for (const c of topCompetitors) {
    personas.push({
      id: `competitor-${c.name}`,
      role: "Competitor Strategy Lead",
      entityType: "competitor_airline",
      name: `${c.name} Strategy Lead`,
      bio: `Represents competitive pressure from ${c.name} on overlapping ODs.`,
      stance: "aggressive-share-capture",
      topics: ["competitive fares", "frequency", "OD share"],
    });
  }

  for (const r of topRoutes) {
    personas.push({
      id: `route-guardian-${r.name}`,
      role: "Route Guardian",
      entityType: "route",
      name: `${r.name} Route Guardian`,
      bio: `Monitors anomalies and correction impact for route ${r.name}.`,
      stance: "route-precision",
      topics: ["route residuals", "share split", "flow/local mix"],
    });
  }

  return personas.slice(0, 20);
}

function generatePersonasFromOpportunities(routes, hostAirline) {
  const host = normalizeCode(hostAirline || "HOST");
  const ranked = [...(routes || [])].sort((a, b) => toNum(b.expectedRevenueUplift) - toNum(a.expectedRevenueUplift));
  const top = ranked.slice(0, 6);
  const personas = [
    {
      id: "host-network-planner",
      role: "Host Network Planner",
      entityType: "host_airline",
      name: `${host} Network Planner`,
      bio: `Prioritizes high-spill opportunities and competitor-pressure routes for ${host}.`,
      stance: "uplift-maximizer",
      topics: ["spill recovery", "market share", "OD routing", "schedule tuning"],
    },
    {
      id: "spill-recovery-specialist",
      role: "Spill Recovery Specialist",
      entityType: "spill",
      name: "Spill Recovery Specialist",
      bio: "Targets routes where spill and flow leakage can be converted into host revenue.",
      stance: "revenue-recapture",
      topics: ["SPILLDATA", "BASEDATA", "flow conversion", "yield uplift"],
    },
    {
      id: "competitor-war-room",
      role: "Competitor War Room",
      entityType: "competitor_airline",
      name: "Competitor Watch Lead",
      bio: "Monitors top competitor share by OD and selects tactical response routes.",
      stance: "competitive-response",
      topics: ["top competitor", "host share gap", "fare position", "frequency pressure"],
    },
  ];
  for (const r of top) {
    personas.push({
      id: `opp-route-${r.worksetId}-${r.od}`,
      role: "Opportunity Route Lead",
      entityType: "route",
      name: `${r.od} Opportunity Lead`,
      bio: `Focus route ${r.od} with est uplift ₹${formatNum(r.expectedRevenueUplift, 0)} (spill ₹${formatNum(r.spillRevenue, 0)}).`,
      stance: "route-hunter",
      topics: ["spill capture", "competitor pressure", "share recovery"],
    });
  }
  return personas.slice(0, 20);
}

function summarizeEntitiesByType(entities) {
  const map = new Map();
  for (const e of entities || []) {
    map.set(e.type, (map.get(e.type) || 0) + 1);
  }
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function buildSimulationConfigFromContext(personas, routeRows) {
  const routes = routeRows || [];
  const avgFlow = routes.length ? routes.reduce((s, r) => s + toNum(r.flowPct), 0) / routes.length : 20;
  const highOpp = routes.filter((r) => toNum(r.oppScore) >= 55).length;
  const totalAgents = Math.max(6, Math.min(40, (personas || []).length));

  const time_config = {
    total_simulation_hours: 24,
    minutes_per_round: 20,
    peak_hours: [8, 9, 10, 18, 19, 20],
    agents_per_hour_min: Math.max(3, Math.floor(totalAgents * 0.18)),
    agents_per_hour_max: Math.max(6, Math.floor(totalAgents * 0.35)),
  };

  const agent_configs = (personas || []).map((p, idx) => ({
    agent_id: idx + 1,
    role: p.role,
    name: p.name,
    stance: p.stance,
    activity_level: clamp(0.4 + ((idx % 5) * 0.12), 0.3, 0.95),
    posts_per_hour: 1 + (idx % 3),
    comments_per_hour: 2 + (idx % 4),
    influence_weight: clamp(0.8 + (idx % 6) * 0.2, 0.8, 2.2),
    topics: p.topics || [],
  }));

  return {
    world: {
      scenario: "airline-od-opportunity",
      high_opportunity_routes: highOpp,
      avg_flow_pct: Number(avgFlow.toFixed(1)),
      total_routes: routes.length,
    },
    time_config,
    platform_config: {
      feed_weight: 0.35,
      relevance_weight: 0.4,
      recency_weight: 0.25,
    },
    agent_configs,
  };
}

function simulateOpportunityForBundle(worksetId, bundle, hostAirline) {
  const host = normalizeCode(hostAirline || bundle?.profile?.host_airline || "HOST");
  const level1 = Array.isArray(bundle?.level1_host_od_summary) ? bundle.level1_host_od_summary : [];
  const level2 = Array.isArray(bundle?.level2_od_airline_share_summary) ? bundle.level2_od_airline_share_summary : [];
  const level3 = Array.isArray(bundle?.level3_host_flight_summary) ? bundle.level3_host_flight_summary : [];
  const spillBreakdown = Array.isArray(bundle?.flight_spill_breakdown) ? bundle.flight_spill_breakdown : [];

  const odCarrierMap = new Map();
  for (const row of level2) {
    const od = `${normalizeCode(row.orig)}-${normalizeCode(row.dest)}`;
    const arr = odCarrierMap.get(od) || [];
    arr.push({
      carrier: normalizeCode(row.carrier),
      trafficSharePct: toNum(row.traffic_share_pct_est),
      demandSharePct: toNum(row.demand_share_pct_est),
      revenue: toNum(row.total_revenue_est),
      traffic: toNum(row.total_traffic_est),
      demand: toNum(row.total_demand_est),
    });
    odCarrierMap.set(od, arr);
  }

  const spillByOd = new Map();
  for (const s of spillBreakdown) {
    const od = `${normalizeCode(s.flight_orig)}-${normalizeCode(s.flight_dest)}`;
    const agg = spillByOd.get(od) || { spillPax: 0, spillRevenue: 0, flowPairs: new Set() };
    agg.spillPax += toNum(s.flow_pax_est);
    agg.spillRevenue += toNum(s.flow_revenue_est);
    const flowPair = `${normalizeCode(s.flow_orig)}-${normalizeCode(s.flow_dest)}`;
    if (flowPair !== "-") agg.flowPairs.add(flowPair);
    spillByOd.set(od, agg);
  }

  const baseByOd = new Map();
  for (const f of level3) {
    const od = `${normalizeCode(f.orig)}-${normalizeCode(f.dest)}`;
    const agg = baseByOd.get(od) || { basePax: 0, baseRevenue: 0, weeklySeats: 0 };
    agg.basePax += toNum(f.weekly_pax_est);
    agg.baseRevenue += toNum(f.weekly_pax_revenue_est);
    agg.weeklySeats += toNum(f.weekly_seats_est);
    baseByOd.set(od, agg);
  }

  const routeRows = [];
  for (const row of level1) {
    try {
      const orig = normalizeCode(row?.orig);
      const dest = normalizeCode(row?.dest);
      if (!orig || !dest) continue;
      const od = `${orig}-${dest}`;
    const hostSharePct = toNum(row.host_share_of_market_demand_pct_est);
    const marketDemand = toNum(row.market_weekly_demand);
    const observedPax = toNum(row.weekly_pax_est);
    const modelPax = toNum(row.apm_weekly_pax_est || row.weekly_pax_est);
    const signedDiffPct = observedPax > 0 ? ((modelPax - observedPax) / observedPax) * 100 : 0;
    const flowPct = toNum(row.flow_apm_pct_est || row.flow_pdd_pct_est);
    const loadFactor = toNum(row.apm_load_factor_pct_est || row.load_factor_pct_est);

    const carrierRows = odCarrierMap.get(od) || [];
    const hostCarrierRow = carrierRows.find((c) => c.carrier === host) || null;
    const competitors = carrierRows
      .filter((c) => c.carrier !== host)
      .sort((a, b) => toNum(b.trafficSharePct) - toNum(a.trafficSharePct));
    const topCompetitor = competitors[0] || null;
    const topCompSharePct = toNum(topCompetitor?.trafficSharePct || 0);

    const hostYield = hostCarrierRow && hostCarrierRow.traffic > 0 ? hostCarrierRow.revenue / hostCarrierRow.traffic : 0;
    const compTraffic = competitors.reduce((s, c) => s + toNum(c.traffic), 0);
    const compRevenue = competitors.reduce((s, c) => s + toNum(c.revenue), 0);
    const compYield = compTraffic > 0 ? compRevenue / compTraffic : 0;
    const fareGapPct = compYield > 0 ? ((hostYield - compYield) / compYield) * 100 : 0;

    const competitiveGap = Math.max(0, topCompSharePct - hostSharePct);
    const demandGap = Math.abs(signedDiffPct);
    const networkLeverage = marketDemand * (1 + flowPct / 100);
    const spillInfo = spillByOd.get(od) || { spillPax: 0, spillRevenue: 0, flowPairs: new Set() };
    const baseInfo = baseByOd.get(od) || { basePax: 0, baseRevenue: 0, weeklySeats: 0 };
    const spillPax = toNum(spillInfo.spillPax);
    const spillRevenue = toNum(spillInfo.spillRevenue);
    const shareGapPts = Math.max(0, topCompSharePct - hostSharePct);
    const captureRate = clamp(0.08 + (shareGapPts / 170) + (flowPct / 280), 0.06, 0.38);
    const expectedRevenueUplift = spillRevenue * captureRate;
    const expectedPaxUplift = spillPax * captureRate;
    const isPotentialRoute = expectedRevenueUplift >= 50000 || (shareGapPts >= 8 && spillRevenue >= 20000);

    const fileChanges = [];
    if (loadFactor > 110) {
      fileChanges.push({
        file: "out/BASEDATA.dat",
        columns: ["weekly_departures", "seats_per_departure", "local_pax vs flow_pax allocation fields"],
        row_selector: { ORG: orig, DEST: dest, CARRIER: host },
        parameter: "capacity and local-flow assignment from BASEDATA",
        action: "rebalance seats/departures and local-flow split",
        delta_hint: "adjust weekly seats +2% to +8% where feasible",
        reason: `Load factor ${formatNum(loadFactor, 1)}% indicates stress.`,
        expected_effect: "Stabilizes LF and reduces unrealistic overflow demand.",
        confidence: "medium",
      });
    }
    if (spillRevenue > 0) {
      fileChanges.push({
        file: "out/SPILLDATA.dat, out/BASEDATA.dat",
        columns: ["flow pax/revenue spill records", "base local/flow allocation fields"],
        row_selector: { ORG: orig, DEST: dest, CARRIER: host },
        parameter: "spill capture and base demand allocation",
        action: "prioritize route spill recapture and rebalance local-flow assignment",
        delta_hint: `target capture rate ${(captureRate * 100).toFixed(1)}%; uplift ₹${formatNum(expectedRevenueUplift, 0)}`,
        reason: `Spill-derived opportunity ₹${formatNum(spillRevenue, 0)} with competitor pressure ${formatNum(shareGapPts, 1)} pts.`,
        expected_effect: "Increases realized revenue by converting spilled flow to served demand.",
        confidence: isPotentialRoute ? "high" : "medium",
      });
    }

      routeRows.push({
      worksetId,
      od,
      hostSharePct,
      topCompSharePct,
      marketDemand,
      observedPax,
      modelPax,
      signedDiffPct,
      flowPct,
      loadFactor,
      fareGapPct,
      competitiveGap,
      demandGap,
      networkLeverage,
      spillPax,
      spillRevenue,
      expectedPaxUplift,
      expectedRevenueUplift,
      spillCaptureRatePct: captureRate * 100,
      potentialRouteTag: isPotentialRoute ? "High Potential" : "Watchlist",
      spillFlows: [...(spillInfo.flowPairs || [])].slice(0, 3).join(", "),
      basePax: toNum(baseInfo.basePax),
      baseRevenue: toNum(baseInfo.baseRevenue),
      oppScore: 0,
      graphReasoning: "",
      competitors: competitors.slice(0, 3).map((c) => `${c.carrier}:${formatNum(c.trafficSharePct, 1)}%`).join(", "),
      fileChanges,
      recommendation: formatChangePlan(fileChanges),
      });
    } catch {
      // skip malformed rows, continue simulation
    }
  }

  const maxLeverage = Math.max(1, ...routeRows.map((r) => toNum(r.networkLeverage)));
  const maxCompGap = Math.max(1, ...routeRows.map((r) => toNum(r.competitiveGap)));
  const maxError = Math.max(1, ...routeRows.map((r) => toNum(r.demandGap)));
  const maxSpillRev = Math.max(1, ...routeRows.map((r) => toNum(r.spillRevenue)));

  for (const r of routeRows) {
    const spillScore = (toNum(r.spillRevenue) / maxSpillRev) * 35;
    const leverageScore = (toNum(r.networkLeverage) / maxLeverage) * 25;
    const compScore = (toNum(r.competitiveGap) / maxCompGap) * 25;
    const errorScore = (toNum(r.demandGap) / maxError) * 15;
    const oppScore = clamp(spillScore + leverageScore + compScore + errorScore, 0, 100);
    r.oppScore = oppScore;
    r.graphReasoning = `Spill ${formatNum(spillScore, 1)} + leverage ${formatNum(leverageScore, 1)} + competition ${formatNum(compScore, 1)} + error ${formatNum(errorScore, 1)}`;
  }

  const sorted = [...routeRows].sort((a, b) => toNum(b.oppScore) - toNum(a.oppScore));
  return {
    worksetId,
    hostAirline: host,
    routeRows: sorted,
    summary: {
      routes: sorted.length,
      highOpportunityRoutes: sorted.filter((r) => r.oppScore >= 55).length,
      highErrorRoutes: sorted.filter((r) => Math.abs(toNum(r.signedDiffPct)) > 20).length,
      highCompetitionRoutes: sorted.filter((r) => toNum(r.topCompSharePct) > toNum(r.hostSharePct)).length,
    },
  };
}

async function parseJsonResponse(response, contextLabel) {
  const text = await response.text();
  const lowered = String(text || "").trim().toLowerCase();
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("text/html") || lowered.startsWith("<!doctype html") || lowered.startsWith("<html")) {
    throw new Error(`${contextLabel} returned HTML instead of JSON. Check MiroFish API URL (${DEFAULT_MIROFISH_API_URL}) and ensure backend is running.`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${contextLabel} returned non-JSON response: ${text.slice(0, 300) || `HTTP ${response.status}`}`);
  }

  if (!response.ok) {
    const msg = payload?.error || payload?.message || `${contextLabel} failed (${response.status}).`;
    if (response.status === 413) {
      throw new Error(`413 payload too large from MiroFish. Use Knowledge Graph Pack mode. Detail: ${msg}`);
    }
    throw new Error(msg);
  }

  if (payload?.success === false) {
    throw new Error(payload?.error || payload?.message || `${contextLabel} failed.`);
  }

  return payload;
}

function buildGraphPack(worksetId, bundle, hostAirline) {
  const level1 = Array.isArray(bundle?.level1_host_od_summary) ? bundle.level1_host_od_summary : [];
  const level2 = Array.isArray(bundle?.level2_od_airline_share_summary) ? bundle.level2_od_airline_share_summary : [];
  const level3 = Array.isArray(bundle?.level3_host_flight_summary) ? bundle.level3_host_flight_summary : [];

  const topOds = pickTop(
    level1.map((r) => ({
      od: `${normalizeCode(r.orig)}-${normalizeCode(r.dest)}`,
      orig: normalizeCode(r.orig),
      dest: normalizeCode(r.dest),
      weeklyPax: toNum(r.apm_weekly_pax_est || r.weekly_pax_est),
      weeklySeats: toNum(r.weekly_seats_est),
      loadFactor: toNum(r.apm_load_factor_pct_est || r.load_factor_pct_est),
      hostSharePct: toNum(r.host_share_of_market_demand_pct_est),
      flowPct: toNum(r.flow_apm_pct_est || r.flow_pdd_pct_est),
      absPaxDiffPct: toNum(r.abs_total_pax_diff_pct_est),
      absLfDiffPts: toNum(r.abs_plf_diff_pct_est),
      localPax: toNum(r.apm_local_pax_est || r.local_apm_weekly_pax_est || r.local_weekly_pax_est),
      flowPax: toNum(r.apm_flow_pax_est || r.flow_apm_weekly_pax_est || r.flow_weekly_pax_est),
      marketDemand: toNum(r.market_weekly_demand),
    })),
    "weeklyPax",
    140,
  );

  const topOdSet = new Set(topOds.map((x) => x.od));
  const airlineRows = level2
    .map((r) => ({
      od: `${normalizeCode(r.orig)}-${normalizeCode(r.dest)}`,
      carrier: normalizeCode(r.carrier),
      demand: toNum(r.total_demand_est),
      traffic: toNum(r.total_traffic_est),
      revenue: toNum(r.total_revenue_est),
      demandSharePct: toNum(r.demand_share_pct_est),
      trafficSharePct: toNum(r.traffic_share_pct_est),
      revenueSharePct: toNum(r.revenue_share_pct_est),
      avgUtility: toNum(r.avg_utility_score),
      avgElapsed: toNum(r.avg_elapsed_minutes),
    }))
    .filter((r) => topOdSet.has(r.od));

  const topFlights = pickTop(
    level3.map((r) => ({
      orig: normalizeCode(r.orig),
      dest: normalizeCode(r.dest),
      flightNumber: String(r.flight_number || "").trim(),
      weeklyPax: toNum(r.weekly_pax_est),
      weeklySeats: toNum(r.weekly_seats_est),
      revenue: toNum(r.weekly_pax_revenue_est),
      elapsed: String(r.elapsed_time || ""),
    })),
    "weeklyPax",
    320,
  );

  const nodes = [];
  const edges = [];
  const nodeSeen = new Set();
  const addNode = (id, type, attrs = {}) => {
    if (nodeSeen.has(id)) return;
    nodeSeen.add(id);
    nodes.push({ id, type, ...attrs });
  };
  const addEdge = (source, target, type, attrs = {}) => edges.push({ source, target, type, ...attrs });

  const worksetNodeId = `workset:${worksetId}`;
  addNode(worksetNodeId, "workset", { label: worksetId, hostAirline: hostAirline || "" });

  for (const od of topOds) {
    const odId = `od:${od.od}`;
    addNode(odId, "od", { label: od.od, orig: od.orig, dest: od.dest, marketDemand: od.marketDemand });
    addEdge(worksetNodeId, odId, "contains_market", {
      weeklyPax: od.weeklyPax,
      weeklySeats: od.weeklySeats,
      loadFactor: od.loadFactor,
      hostSharePct: od.hostSharePct,
      flowPct: od.flowPct,
      absPaxDiffPct: od.absPaxDiffPct,
      absLfDiffPts: od.absLfDiffPts,
      localPax: od.localPax,
      flowPax: od.flowPax,
    });
  }

  for (const row of airlineRows) {
    const odId = `od:${row.od}`;
    const carrierId = `airline:${row.carrier}`;
    addNode(carrierId, "airline", { label: row.carrier });
    addEdge(odId, carrierId, "carrier_share", {
      demand: row.demand,
      traffic: row.traffic,
      revenue: row.revenue,
      demandSharePct: row.demandSharePct,
      trafficSharePct: row.trafficSharePct,
      revenueSharePct: row.revenueSharePct,
      avgUtility: row.avgUtility,
      avgElapsed: row.avgElapsed,
    });
  }

  for (const flt of topFlights) {
    const odKey = `${flt.orig}-${flt.dest}`;
    if (!topOdSet.has(odKey)) continue;
    const carrier = hostAirline || "HOST";
    const carrierId = `airline:${carrier}`;
    const odId = `od:${odKey}`;
    const flightId = `flight:${flt.orig}-${flt.dest}-${flt.flightNumber || "NA"}`;
    addNode(carrierId, "airline", { label: carrier });
    addNode(flightId, "flight", { label: flt.flightNumber || "NA", orig: flt.orig, dest: flt.dest, elapsed: flt.elapsed });
    addEdge(carrierId, flightId, "operates", { weeklyPax: flt.weeklyPax, weeklySeats: flt.weeklySeats, revenue: flt.revenue });
    addEdge(flightId, odId, "serves_market", { weeklyPax: flt.weeklyPax, revenue: flt.revenue });
  }

  return {
    schema: "insightsdb-airline-graphpack-v2",
    worksetId,
    hostAirline: hostAirline || null,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      topOds: topOds.length,
      airlineRows: airlineRows.length,
      topFlights: topFlights.length,
    },
    nodes,
    edges,
    top_od_snapshot: pickTop(topOds, "weeklyPax", 40),
  };
}

function buildSummaryMarkdown(worksetId, hostAirline, graphPack) {
  const top = pickTop(graphPack.top_od_snapshot || [], "weeklyPax", 20);
  return [
    `# Airline Network Opportunity Pack (${worksetId})`,
    "",
    `Host Airline: ${hostAirline || "N/A"}`,
    "Required Output Language: English",
    "",
    "## Knowledge Graph Coverage",
    `- Nodes: ${graphPack.counts.nodes}`,
    `- Edges: ${graphPack.counts.edges}`,
    `- OD markets: ${graphPack.counts.topOds}`,
    "",
    "## Top OD Markets",
    ...top.map((r, idx) => `${idx + 1}. ${r.od} | pax=${formatNum(r.weeklyPax, 0)} | LF=${formatNum(r.loadFactor, 1)}% | spill_capture=${formatNum(r.spillCaptureRatePct, 1)}%`),
    "",
    "## Simulation Instruction",
    "Use network-level signals and OD demand/share patterns to prioritize opportunities.",
    "Keep recommendations measurable and route-specific.",
  ].join("\n");
}

export default function MiroFishSimulatorTab({ worksetId, hostAirline }) {
  const mirofishAppUrl = DEFAULT_MIROFISH_APP_URL;
  const mirofishApiUrl = DEFAULT_MIROFISH_API_URL;

  const [engineMode, setEngineMode] = useState("local");
  const [selectedCarrier, setSelectedCarrier] = useState(hostAirline || "S5");
  const [scopeMode, setScopeMode] = useState("all");
  const [selectedWorksetId, setSelectedWorksetId] = useState(worksetId || "");
  const [worksetIds, setWorksetIds] = useState([]);
  const [manifestByWorkset, setManifestByWorkset] = useState({});
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [projectId, setProjectId] = useState("");
  const [frameUrl, setFrameUrl] = useState(joinUrl(mirofishAppUrl, "/"));
  const [simulationPrompt, setSimulationPrompt] = useState("");
  const [localSimRows, setLocalSimRows] = useState([]);
  const [localSimSummary, setLocalSimSummary] = useState(null);
  const [localPatchRows, setLocalPatchRows] = useState([]);
  const [localSteps, setLocalSteps] = useState(makeStepState);
  const [localGraph, setLocalGraph] = useState({ nodes: [], edges: [] });
  const [localLayout, setLocalLayout] = useState({ points: {}, width: 900, height: 420 });
  const [localNarrative, setLocalNarrative] = useState([]);
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);
  const [hoveredGraphNodeId, setHoveredGraphNodeId] = useState(null);
  const [whatIf, setWhatIf] = useState({ fareShiftPct: 0, spillCaptureDelta: 0, compResponseDelta: 0 });
  const [llmStatus, setLlmStatus] = useState({ graphiti_local: false, gemini: false, github_models: false, ollama: false, modelGraphiti: "", modelGemini: "", modelGithub: "", modelOllama: "" });
  const [llmRunState, setLlmRunState] = useState("idle");
  const [llmRunMessage, setLlmRunMessage] = useState("");
  const [llmProviderUsed, setLlmProviderUsed] = useState("");
  const [aiInsightsByKey, setAiInsightsByKey] = useState({});
  const [fidelityMode, setFidelityMode] = useState("strict");
  const [showValidatedOnly, setShowValidatedOnly] = useState(true);
  const [validationSummary, setValidationSummary] = useState(null);
  const [recognizedEntities, setRecognizedEntities] = useState([]);
  const [agentPersonas, setAgentPersonas] = useState([]);
  const [entityTypeSummary, setEntityTypeSummary] = useState([]);
  const [localSimulationConfig, setLocalSimulationConfig] = useState(null);
  const [phaseLogs, setPhaseLogs] = useState({ step1: [], step2: [], step3: [], step4: [], step5: [] });

  useEffect(() => {
    const carrier = hostAirline || "S5";
    setSelectedCarrier(carrier);
    setSimulationPrompt(
      `You are an airline network analyst. Use BASEDATA and SPILLDATA-driven signals for ${carrier}. ` +
      "Output in English only. Provide OD-level competitor opportunity suggestions with expected revenue uplift and spill-capture actions.",
    );
  }, [hostAirline]);

  useEffect(() => {
    setFrameUrl(joinUrl(mirofishAppUrl, "/"));
  }, [mirofishAppUrl]);

  useEffect(() => {
    setStatus("idle");
    if (engineMode === "local") {
      setMessage("Local simulator ready.");
      setLocalSteps(makeStepState());
    } else {
      setMessage("External MiroFish mode ready.");
    }
  }, [engineMode]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/llm/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !json?.ok) return;
        setLlmStatus({
          graphiti_local: Boolean(json?.providers?.graphiti_local),
          gemini: Boolean(json?.providers?.gemini),
          github_models: Boolean(json?.providers?.github_models),
          ollama: Boolean(json?.providers?.ollama),
          modelGraphiti: String(json?.models?.graphiti_local || ""),
          modelGemini: String(json?.models?.gemini || ""),
          modelGithub: String(json?.models?.github_models || ""),
          modelOllama: String(json?.models?.ollama || ""),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLlmStatus({ graphiti_local: false, gemini: false, github_models: false, ollama: false, modelGraphiti: "", modelGemini: "", modelGithub: "", modelOllama: "" });
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/worksets/index.json")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return;
        const ids = Array.isArray(data) ? data.map((x) => x?.id).filter(Boolean) : [];
        setWorksetIds(ids.length ? ids : (worksetId ? [worksetId] : []));
      })
      .catch(() => {
        if (cancelled) return;
        setWorksetIds(worksetId ? [worksetId] : []);
      });

    return () => { cancelled = true; };
  }, [worksetId]);

  useEffect(() => {
    let cancelled = false;
    if (!worksetIds.length) return;

    setMessage("Loading workset manifests...");

    Promise.all(
      worksetIds.map(async (wid) => {
        try {
          const res = await fetch(`/data/worksets/${wid}/raw/manifest.json`);
          if (!res.ok) return [wid, null];
          return [wid, await res.json()];
        } catch {
          return [wid, null];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map = Object.fromEntries(entries);
      setManifestByWorkset(map);
      const loaded = Object.values(map).filter((m) => Array.isArray(m?.files)).length;
      setMessage(`Loaded ${loaded}/${worksetIds.length} workset manifests.`);
    });

    return () => { cancelled = true; };
  }, [worksetIds]);

  useEffect(() => {
    if (worksetId) {
      setSelectedWorksetId(worksetId);
      return;
    }
    if (!selectedWorksetId && worksetIds.length) {
      setSelectedWorksetId(worksetIds[0]);
    }
  }, [worksetId, worksetIds, selectedWorksetId]);

  const activeWorksetIds = useMemo(() => {
    if (scopeMode !== "selected") return worksetIds;
    return selectedWorksetId ? [selectedWorksetId] : [];
  }, [scopeMode, selectedWorksetId, worksetIds]);

  const totalFilesInScope = useMemo(() => activeWorksetIds.reduce((sum, wid) => {
    const m = manifestByWorkset[wid];
    return sum + (Array.isArray(m?.files) ? m.files.length : 0);
  }, 0), [activeWorksetIds, manifestByWorkset]);

  const downloadJson = (filename, data) => {
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // no-op for older environments
    }
  };

  const handleRunLocalSimulator = async () => {
    if (!activeWorksetIds.length) {
      setStatus("error");
      setMessage("No worksets available for local simulation.");
      return;
    }
    try {
      setStatus("running");
      setLocalSteps(makeStepState().map((s) => (s.id === 1 ? { ...s, status: "running" } : s)));
      setMessage("Running local opportunity simulator...");
      const allRows = [];
      const summaries = [];
      const worksetErrors = [];
      const graphPacks = [];
      const narrative = [];
      const worksetValidation = [];
      const collectedEntities = [];
      const logs = { step1: [], step2: [], step3: [], step4: [], step5: [] };
      logs.step1.push(`Initializing graph build for ${activeWorksetIds.length} workset(s).`);
      for (const wid of activeWorksetIds) {
        try {
          setMessage(`Simulating opportunity signals for ${wid}...`);
          const res = await fetch(`/data/worksets/${wid}/bundle.json`);
          if (!res.ok) {
            worksetErrors.push(`${wid}: bundle fetch HTTP ${res.status}`);
            continue;
          }
          const bundle = await res.json();
          const gp = buildGraphPack(wid, bundle, selectedCarrier || hostAirline || "HOST");
          graphPacks.push(gp);
          logs.step1.push(`${wid}: graph pack ${gp.nodes.length} nodes, ${gp.edges.length} edges.`);
          const bundleEntities = buildEntitiesFromBundle(wid, bundle, selectedCarrier || hostAirline || "HOST");
          collectedEntities.push(...bundleEntities);
          logs.step2.push(`${wid}: extracted ${bundleEntities.length} entities from route/share/flight/coefficient sources.`);
          const validation = buildWorksetValidation(bundle, selectedCarrier || hostAirline || "HOST");
          worksetValidation.push({ worksetId: wid, ...validation });
          const sim = simulateOpportunityForBundle(wid, bundle, selectedCarrier || hostAirline || "HOST");
          if (!Array.isArray(sim?.routeRows) || sim.routeRows.length === 0) {
            worksetErrors.push(`${wid}: no simulatable OD rows`);
            continue;
          }
          const odChecks = validation?.odChecks || {};
          const rowsWithValidation = sim.routeRows.map((r) => ({
            ...r,
            validationPass: odChecks[r.od]?.isValid !== false,
            validationReason: odChecks[r.od]?.reason || "Validation unavailable",
            validationShareGapPct: odChecks[r.od]?.shareGapPct ?? null,
          }));
          allRows.push(...rowsWithValidation);
          summaries.push(sim.summary);
          narrative.push(`${wid}: simulated ${sim.routeRows.length} OD routes, validation score ${formatNum(validation.score, 1)}.`);
        } catch (err) {
          worksetErrors.push(`${wid}: ${err?.message || err}`);
          // Continue with remaining worksets
        }
      }

      const mergedGraph = buildMergedGraphFromGraphPacks(graphPacks);
      const laidOut = computeForceLayout(mergedGraph);
      setLocalGraph(mergedGraph);
      setLocalLayout(laidOut);
      setSelectedGraphNode(null);
      setWhatIf({ fareShiftPct: 0, spillCaptureDelta: 0, compResponseDelta: 0 });
      setAiInsightsByKey({});
      setLlmRunState("idle");
      setLlmRunMessage("");
      setLlmProviderUsed("");
      setRecognizedEntities(collectedEntities);
      setEntityTypeSummary(summarizeEntitiesByType(collectedEntities));
      setValidationSummary(worksetValidation.length ? {
        worksets: worksetValidation.length,
        avgScore: worksetValidation.reduce((s, x) => s + toNum(x.score), 0) / Math.max(1, worksetValidation.length),
        totalRoutes: worksetValidation.reduce((s, x) => s + toNum(x.totalRoutes), 0),
        validRoutes: worksetValidation.reduce((s, x) => s + toNum(x.validRoutes), 0),
        avgShareGapPct: worksetValidation.reduce((s, x) => s + toNum(x.avgShareGapPct), 0) / Math.max(1, worksetValidation.length),
        impossibleLfCount: worksetValidation.reduce((s, x) => s + toNum(x.impossibleLfCount), 0),
      } : null);
      setLocalSteps((prev) => prev.map((s) => (
        s.id === 1 ? { ...s, status: "done", detail: `Graph ready: ${mergedGraph.nodes.length} nodes, ${mergedGraph.edges.length} edges.` } :
        s.id === 2 ? { ...s, status: "running" } :
        s
      )));

      const airlineCount = new Set(mergedGraph.nodes.filter((n) => n.type === "airline").map((n) => n.id)).size;
      const odCount = new Set(mergedGraph.nodes.filter((n) => n.type === "od").map((n) => n.id)).size;
      setLocalNarrative((prev) => [...prev, ...narrative, `Environment setup: ${airlineCount} airlines, ${odCount} ODs in simulation graph.`]);
      setLocalSteps((prev) => prev.map((s) => (
        s.id === 2 ? { ...s, status: "done" } :
        s.id === 3 ? { ...s, status: "running" } :
        s
      )));

      if (!allRows.length) {
        setLocalSimRows([]);
        setLocalPatchRows([]);
        setLocalSimSummary({ routes: 0, highOpportunityRoutes: 0, highErrorRoutes: 0, highCompetitionRoutes: 0 });
        setLocalSteps((prev) => prev.map((s) => (
          s.id === 3 ? { ...s, status: "done", detail: "No routes produced by simulation." } :
          s.id > 3 ? { ...s, status: "done" } :
          s
        )));
        setStatus("ready");
        setMessage(`Local simulator completed with no rows. ${worksetErrors.length ? `Details: ${worksetErrors.join(" | ")}` : "No OD rows found in selected scope."}`);
        return;
      }
      const sortedRows = allRows.sort((a, b) => toNum(b.oppScore) - toNum(a.oppScore)).slice(0, 250);
      const patchRows = buildPatchRowsFromSimRows(sortedRows);
      const mergedSummary = {
        routes: summaries.reduce((s, x) => s + toNum(x.routes), 0),
        highOpportunityRoutes: summaries.reduce((s, x) => s + toNum(x.highOpportunityRoutes), 0),
        highErrorRoutes: summaries.reduce((s, x) => s + toNum(x.highErrorRoutes), 0),
        highCompetitionRoutes: summaries.reduce((s, x) => s + toNum(x.highCompetitionRoutes), 0),
      };
      setLocalSimRows(sortedRows);
      setLocalPatchRows(patchRows);
      setLocalSimSummary(mergedSummary);
      const personas = generatePersonasFromOpportunities(sortedRows, selectedCarrier || hostAirline || "HOST");
      setAgentPersonas(personas);
      logs.step3.push(`Generated ${personas.length} opportunity personas driven by SPILLDATA/BASEDATA route economics.`);
      const simConfig = buildSimulationConfigFromContext(personas, sortedRows);
      setLocalSimulationConfig(simConfig);
      logs.step4.push(`Built simulation config: ${simConfig.agent_configs.length} agents, ${simConfig.time_config.total_simulation_hours}h horizon, ${simConfig.time_config.minutes_per_round}m rounds.`);
      logs.step5.push(`Deep interaction ready with ${sortedRows.length} ranked routes and ${patchRows.length} patch actions.`);
      setPhaseLogs(logs);
      setLocalSteps((prev) => prev.map((s) => (
        s.id === 3 ? { ...s, status: "done", detail: `Simulated ${sortedRows.length} ranked routes.` } :
        s.id === 4 ? { ...s, status: "done", detail: `Generated ${patchRows.length} file-level patch actions.` } :
        s.id === 5 ? { ...s, status: "done", detail: "Interactive route and patch tables ready." } :
        s
      )));
      setLocalNarrative((prev) => [
        ...prev,
        `Simulation done: ${sortedRows.length} ranked routes.`,
        `Entities recognized: ${collectedEntities.length}. Agent personas generated: ${generatePersonasFromEntities(collectedEntities, selectedCarrier || hostAirline || "HOST").length}.`,
        `Report generated: ${patchRows.length} actionable file-level changes.`,
      ]);
      setStatus("ready");
      const tail = worksetErrors.length ? ` Skipped: ${worksetErrors.join(" | ")}` : "";
      setMessage(`Local opportunity simulator completed. Top ${sortedRows.length} OD routes ranked.${tail}`);
    } catch (error) {
      setStatus("ready");
      setMessage(`Local simulator completed with warning: ${error?.message || error}`);
    }
  };

  const handleRunAiDeepSimulation = async () => {
    if (!localSimRows.length) {
      setLlmRunState("error");
      setLlmRunMessage("Run local simulator first to generate OD routes.");
      return;
    }
    try {
      setLlmRunState("running");
      setLlmRunMessage("Running AI deep simulation...");
      const routePayload = nodeFilteredBaseRows.slice(0, 120).map((r) => ({
        worksetId: r.worksetId,
        od: r.od,
        hostSharePct: toNum(r.hostSharePct),
        topCompSharePct: toNum(r.topCompSharePct),
        signedDiffPct: toNum(r.signedDiffPct),
        flowPct: toNum(r.flowPct),
        fareGapPct: toNum(r.fareGapPct),
        spillRevenue: toNum(r.spillRevenue),
        spillPax: toNum(r.spillPax),
        expectedRevenueUplift: toNum(r.expectedRevenueUplift),
        expectedPaxUplift: toNum(r.expectedPaxUplift),
        potentialRouteTag: r.potentialRouteTag || "",
        oppScore: toNum(r.oppScore),
        competitors: r.competitors || "",
        recommendation: r.recommendation || "",
      }));
      const res = await fetch("/api/llm/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostAirline: hostAirline || selectedCarrier || "HOST",
          selectedCarrier: selectedCarrier || hostAirline || "HOST",
          scope: scopeMode,
          worksetIds: activeWorksetIds,
          routes: routePayload,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const details = json?.errors
          ? ` | gemini: ${json.errors.gemini || "-"} | github_models: ${json.errors.github_models || "-"} | ollama: ${json.errors.ollama || "-"}`
          : "";
        throw new Error(`${json?.message || `HTTP ${res.status}`}${details}`);
      }
      const analyses = Array.isArray(json?.result?.route_analyses) ? json.result.route_analyses : [];
      const nextMap = {};
      for (const a of analyses) {
        if (!a?.od || !a?.worksetId) continue;
        const key = `${a.worksetId}::${a.od}`;
        nextMap[key] = a;
      }
      setAiInsightsByKey(nextMap);
      setLlmProviderUsed(String(json?.provider || ""));
      setLlmRunState("ready");
      const fallbackNote = json?.fallbackFrom ? ` (fallback from: ${json.fallbackFrom})` : "";
      setLlmRunMessage(`AI deep simulation complete (${json?.provider || "provider"}${json?.model ? ` / ${json.model}` : ""})${fallbackNote}.`);
      setLocalNarrative((prev) => [...prev, `AI deep simulation completed with ${json?.provider || "LLM"} for ${Object.keys(nextMap).length} routes.`]);
    } catch (error) {
      setLlmRunState("error");
      setLlmRunMessage(`AI deep simulation failed: ${error?.message || error}`);
    }
  };

  const handlePrepareAndOpen = async () => {
    if (!activeWorksetIds.length) {
      setStatus("error");
      setMessage("No worksets available to upload.");
      return;
    }

    try {
      setStatus("running");
      setMessage("Checking MiroFish backend availability...");
      const probeRes = await fetch(joinUrl(mirofishApiUrl, "/api/graph/project/list?limit=1"));
      await parseJsonResponse(probeRes, "MiroFish backend probe");

      const form = new FormData();
      let appendedCount = 0;
      for (const wid of activeWorksetIds) {
        setMessage(`Building graph pack for ${wid}...`);
        const bundleRes = await fetch(`/data/worksets/${wid}/bundle.json`);
        if (!bundleRes.ok) continue;
        const bundle = await bundleRes.json();
        const graphPack = buildGraphPack(wid, bundle, selectedCarrier || hostAirline || "HOST");
        const summaryMd = buildSummaryMarkdown(wid, selectedCarrier || hostAirline || "HOST", graphPack);
        form.append("files", new Blob([`# Graph Pack JSON\n\n${JSON.stringify(graphPack)}`], { type: "text/plain" }), `${wid}_airline_graph_pack.txt`);
        form.append("files", new Blob([summaryMd], { type: "text/markdown" }), `${wid}_simulation_brief.md`);
        appendedCount += 2;
      }

      if (!appendedCount) throw new Error("No files could be prepared for MiroFish upload.");

      const scopeLabel = scopeMode === "all" ? "all available worksets" : `workset ${worksetId}`;
      const strategyLabel = "graph-pack-only";
      const englishDirective = "MANDATORY LANGUAGE: English only for agent persona, intermediate reasoning summaries, reports, tables, and recommendations.";

      const requirement = [
        simulationPrompt?.trim() || "",
        englishDirective,
        `Scope: ${scopeLabel}. Carrier: ${selectedCarrier || hostAirline || "Host"}.`,
        "Use uploaded BASEDATA/SPILLDATA knowledge to provide route-level competitor opportunity suggestions.",
        "Recommend measurable spill-capture and base-allocation actions with expected uplift.",
        "Include competitor analysis and route-level opportunity commentary for each priority OD.",
      ].join("\n\n");

      form.append("simulation_requirement", requirement);
      form.append("project_name", `${scopeMode === "all" ? "ALLWORKSETS" : worksetId}-${selectedCarrier || hostAirline || "Host"}-parallel-simulation`);
      form.append(
        "additional_context",
        [
          `Source scope: ${scopeLabel}`,
          `Ingestion strategy: ${strategyLabel}`,
          `Worksets: ${activeWorksetIds.join(",")}`,
          `Selected carrier: ${selectedCarrier || hostAirline || "Host"}`,
          `Uploaded files: ${appendedCount}`,
          englishDirective,
        ].join(" | "),
      );

      setMessage("Generating ontology in MiroFish...");
      const ontologyRes = await fetch(joinUrl(mirofishApiUrl, "/api/graph/ontology/generate"), { method: "POST", body: form });
      const ontologyJson = await parseJsonResponse(ontologyRes, "Ontology generation");
      const createdProjectId = ontologyJson?.data?.project_id;
      if (!createdProjectId) throw new Error("MiroFish did not return project_id.");

      setProjectId(createdProjectId);
      setMessage(`Project created (${createdProjectId}). Starting graph build...`);

      const buildRes = await fetch(joinUrl(mirofishApiUrl, "/api/graph/build"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: createdProjectId,
          graph_name: `${scopeMode === "all" ? "ALLWORKSETS" : worksetId}-${selectedCarrier || hostAirline || "Host"}`,
          chunk_size: 1200,
          chunk_overlap: 120,
        }),
      });
      await parseJsonResponse(buildRes, "Graph build");

      setFrameUrl(joinUrl(mirofishAppUrl, `/process/${createdProjectId}`));
      setStatus("ready");
      setMessage(`Parallel simulation prepared using ${scopeLabel} with ${strategyLabel} (${appendedCount} uploaded files).`);
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (msg.toLowerCase().includes("episode usage limit") || msg.includes("status_code: 403")) {
        setStatus("error");
        setMessage("External MiroFish/Zep quota is exhausted. Run 'Local Opportunity Simulator (No Zep)' to continue with local recommendations.");
        return;
      }
      setStatus("error");
      setMessage(`Parallel simulation preparation failed: ${error?.message || error}`);
    }
  };

  const nodeFilteredBaseRows = useMemo(() => {
    if (!selectedGraphNode?.id) return localSimRows;
    const node = selectedGraphNode;
    if (node.type === "od") return localSimRows.filter((r) => r.od === node.label);
    if (node.type === "workset") return localSimRows.filter((r) => r.worksetId === node.label);
    if (node.type === "flight") {
      const od = node.orig && node.dest ? `${normalizeCode(node.orig)}-${normalizeCode(node.dest)}` : "";
      return od ? localSimRows.filter((r) => r.od === od) : localSimRows;
    }
    if (node.type === "airline") {
      const carrier = normalizeCode(node.label);
      if (!carrier) return localSimRows;
      return localSimRows.filter((r) => normalizeCode(selectedCarrier) === carrier || String(r.competitors || "").includes(`${carrier}:`));
    }
    return localSimRows;
  }, [localSimRows, selectedCarrier, selectedGraphNode]);

  const displayedSimRows = useMemo(() => {
    const base = mergeAiInsightsIntoRows(applyWhatIfToRows(nodeFilteredBaseRows, whatIf), aiInsightsByKey);
    const filtered = (fidelityMode === "strict" && showValidatedOnly)
      ? base.filter((r) => r.validationPass !== false)
      : base;
    return filtered.slice(0, 250);
  }, [nodeFilteredBaseRows, whatIf, aiInsightsByKey, fidelityMode, showValidatedOnly]);

  const displayedPatchRows = useMemo(
    () => {
      const base = buildPatchRowsFromSimRows(displayedSimRows);
      const aiRows = [];
      for (const r of displayedSimRows) {
        const changes = Array.isArray(r.aiChanges) ? r.aiChanges : [];
        for (const c of changes) {
          aiRows.push({
            worksetId: r.worksetId,
            od: r.od,
            file: c.file || "ai-suggested",
            columns: c.column || "-",
            rowSelector: "-",
            action: c.action || r.aiSuggestedAction || "-",
            deltaHint: c.delta || "-",
            reason: c.reason || r.aiReason || "-",
            expectedEffect: r.aiExpectedMeasurement || "-",
            confidence: r.aiConfidence || "-",
          });
        }
      }
      return [...aiRows, ...base];
    },
    [displayedSimRows],
  );

  const displayedSummary = useMemo(() => ({
    routes: displayedSimRows.length,
    highOpportunityRoutes: displayedSimRows.filter((r) => r.oppScore >= 55).length,
    highErrorRoutes: displayedSimRows.filter((r) => Math.abs(toNum(r.signedDiffPct)) > 20).length,
    highCompetitionRoutes: displayedSimRows.filter((r) => toNum(r.topCompSharePct) > toNum(r.hostSharePct)).length,
  }), [displayedSimRows]);

  const topOpportunityRoutes = useMemo(
    () => [...displayedSimRows].sort((a, b) => toNum(b.expectedRevenueUplift) - toNum(a.expectedRevenueUplift)).slice(0, 12),
    [displayedSimRows],
  );
  const topActionRows = useMemo(() => displayedPatchRows.slice(0, 18), [displayedPatchRows]);

  const graphDegrees = useMemo(() => {
    const map = new Map();
    for (const e of localGraph.edges || []) {
      map.set(e.source, (map.get(e.source) || 0) + 1);
      map.set(e.target, (map.get(e.target) || 0) + 1);
    }
    return map;
  }, [localGraph]);

  const labelNodeIds = useMemo(() => {
    const ids = new Set();
    for (const n of localGraph.nodes || []) {
      if (n.type === "workset") ids.add(n.id);
    }
    if (selectedGraphNode?.id) ids.add(selectedGraphNode.id);
    if (hoveredGraphNodeId) ids.add(hoveredGraphNodeId);
    const ranked = [...(localGraph.nodes || [])]
      .map((n) => ({ id: n.id, degree: graphDegrees.get(n.id) || 0, type: n.type }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 22);
    for (const n of ranked) {
      if (n.type === "od" || n.type === "airline") ids.add(n.id);
    }
    return ids;
  }, [graphDegrees, hoveredGraphNodeId, localGraph.nodes, selectedGraphNode]);

  return (
    <div className="mf-wrap">
      <div className="mf-head">
        <div>
          <h3>Parallel Simulation</h3>
          <p>Network opportunity mode builds OD-level graph signals and spill/base competitor recommendations from each workset.</p>
        </div>
        <div className={`mf-status ${status}`}>
          {status === "running" ? "Running" : status === "ready" ? "Ready" : status === "error" ? "Error" : "Idle"}
        </div>
      </div>

      <div className="mf-controls">
        <label>
          Engine
          <select value={engineMode} onChange={(e) => setEngineMode(e.target.value)}>
            <option value="local">Local Network Opportunity Simulator (Recommended)</option>
            <option value="mirofish">External MiroFish Simulation (Requires Zep Quota)</option>
          </select>
        </label>
        <label>
          Scope
          <select value={scopeMode} onChange={(e) => setScopeMode(e.target.value)}>
            <option value="all">All Available Worksets</option>
            <option value="selected">Selected Workset Only</option>
          </select>
        </label>
        <label>
          Selected Workset
          <select value={selectedWorksetId} onChange={(e) => setSelectedWorksetId(e.target.value)} disabled={!worksetIds.length}>
            {worksetIds.length ? worksetIds.map((wid) => <option key={wid} value={wid}>{wid}</option>) : <option value="">No worksets</option>}
          </select>
        </label>
        <label>
          Selected Carrier
          <input value={selectedCarrier} onChange={(e) => setSelectedCarrier(e.target.value)} />
        </label>
        <label>
          Worksets In Scope
          <input value={activeWorksetIds.length} disabled />
        </label>
        <label>
          Fidelity Mode
          <select value={fidelityMode} onChange={(e) => setFidelityMode(e.target.value)}>
            <option value="strict">Strict (validated routes preferred)</option>
            <option value="fast">Fast (show all routes)</option>
          </select>
        </label>
        <label>
          Route Filter
          <select value={showValidatedOnly ? "validated" : "all"} onChange={(e) => setShowValidatedOnly(e.target.value === "validated")}>
            <option value="validated">Validated only</option>
            <option value="all">All simulated routes</option>
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Simulation Prompt
          <textarea
            value={simulationPrompt}
            onChange={(e) => setSimulationPrompt(e.target.value)}
            rows={3}
            style={{ border: "1px solid var(--border-color)", borderRadius: 8, padding: "8px 10px", fontSize: "0.82rem", resize: "vertical" }}
          />
        </label>
      </div>

      <div className="mf-actions">
        {engineMode === "local" ? (
          <button className="mf-primary" onClick={handleRunLocalSimulator} disabled={status === "running" || !activeWorksetIds.length}>
            Run Local Opportunity Simulator
          </button>
        ) : (
          <button className="mf-primary" onClick={handlePrepareAndOpen} disabled={status === "running" || !activeWorksetIds.length}>
            Start Parallel Simulation
          </button>
        )}
        <button className="mf-secondary" onClick={() => setFrameUrl(joinUrl(mirofishAppUrl, "/"))}>
          Open MiroFish Home
        </button>
        {projectId ? (
          <a className="mf-link" href={joinUrl(mirofishAppUrl, `/process/${projectId}`)} target="_blank" rel="noreferrer">
            Open Process In New Window
          </a>
        ) : null}
      </div>

      <div className="mf-msg">{message}</div>
      <div className="mf-meta">Files in active raw scope: <strong>{totalFilesInScope}</strong> | Output language policy: <strong>English only</strong></div>
      {validationSummary ? (
        <div className="mf-meta">
          Validation: <strong>{formatNum(validationSummary.avgScore, 1)}/100</strong> fidelity score | Valid routes: <strong>{formatNum(validationSummary.validRoutes, 0)}/{formatNum(validationSummary.totalRoutes, 0)}</strong> | Avg L1-L2 share gap: <strong>{formatNum(validationSummary.avgShareGapPct, 1)} pts</strong> | LF outliers: <strong>{formatNum(validationSummary.impossibleLfCount, 0)}</strong>
        </div>
      ) : null}
      {(recognizedEntities.length || agentPersonas.length) ? (
        <div className="mf-entity-strip">
          <div className="mf-entity-card">
            <div className="mf-entity-head">
              <strong>Recognized Entities</strong>
              <span>{formatNum(recognizedEntities.length, 0)} detected</span>
            </div>
            <div className="mf-entity-list">
              {recognizedEntities.slice(0, 18).map((e) => (
                <span key={e.id} className={`mf-entity-pill ${e.type}`}>{e.type}: {e.name}</span>
              ))}
            </div>
          </div>
          <div className="mf-entity-card">
            <div className="mf-entity-head">
              <strong>Agent Personas</strong>
              <span>{formatNum(agentPersonas.length, 0)} generated</span>
            </div>
            <div className="mf-persona-list">
              {agentPersonas.slice(0, 8).map((p) => (
                <div key={p.id} className="mf-persona-row">
                  <div><strong>{p.role}</strong> ({p.name})</div>
                  <div>{p.bio}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {engineMode === "local" ? (
        <div className="mf-local-wrap">
          <div className="mf-miro-grid">
            <div className="mf-miro-graph">
              <div className="mf-miro-head">
                <strong>Real-time Knowledge Graph (Local)</strong>
                <span>{localGraph.nodes.length} nodes | {localGraph.edges.length} edges</span>
              </div>
              <svg viewBox={`0 0 ${localLayout.width} ${localLayout.height}`} className="mf-graph-svg">
                {(localGraph.edges || []).slice(0, 460).map((e, idx) => {
                  const s = localLayout.points[e.source];
                  const t = localLayout.points[e.target];
                  if (!s || !t) return null;
                  return <line key={idx} className="mf-edge-line" x1={s.x} y1={s.y} x2={t.x} y2={t.y} />;
                })}
                {(localGraph.nodes || []).map((n) => {
                  const p = localLayout.points[n.id];
                  if (!p) return null;
                  const isActive = selectedGraphNode?.id === n.id;
                  const isHovered = hoveredGraphNodeId === n.id;
                  const showLabel = labelNodeIds.has(n.id);
                  const r = isActive ? (n.type === "workset" ? 8 : 6.2) : (n.type === "workset" ? 5.5 : 3.8);
                  return (
                    <g
                      key={n.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedGraphNode((prev) => (prev?.id === n.id ? null : n))}
                      onMouseEnter={() => setHoveredGraphNodeId(n.id)}
                      onMouseLeave={() => setHoveredGraphNodeId((prev) => (prev === n.id ? null : prev))}
                    >
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={r}
                        className={`mf-node-circle ${n.type}${isActive ? " is-active" : ""}${isHovered ? " is-hovered" : ""}`}
                        fill={nodeColor(n.type)}
                        stroke={isActive ? "#0f172a" : "transparent"}
                        strokeWidth={isActive ? 1.4 : 0}
                        opacity={isActive ? 1 : 0.92}
                      />
                      <title>{`${n.type.toUpperCase()}: ${n.label || n.id}`}</title>
                      {showLabel ? (
                        <text x={p.x + r + 3} y={p.y - 2} className="mf-node-label">
                          {String(n.label || n.id).slice(0, 16)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="mf-miro-steps">
              <div className="mf-miro-head">
                <strong>Build Process</strong>
              </div>
              <div className="mf-step-list">
                {localSteps.map((s) => (
                  <div key={s.id} className={`mf-step ${s.status}`}>
                    <div className="mf-step-title">Step {String(s.id).padStart(2, "0")} - {s.name}</div>
                    <div className="mf-step-detail">{s.detail}</div>
                  </div>
                ))}
              </div>
              <div className="mf-log">
                {(localNarrative || []).slice(-10).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
          </div>
          <div className="mf-phase-grid">
            <div className="mf-phase-card">
              <div className="mf-phase-head"><strong>01 Graph Build</strong><span>{localGraph.nodes.length}n / {localGraph.edges.length}e</span></div>
              <div className="mf-phase-body">{phaseLogs.step1.slice(-5).map((l, i) => <div key={i}>{l}</div>)}</div>
            </div>
            <div className="mf-phase-card">
              <div className="mf-phase-head">
                <strong>02 Entity Extraction</strong>
                <span>{recognizedEntities.length}</span>
              </div>
              <div className="mf-phase-body">
                {(entityTypeSummary || []).slice(0, 6).map((x) => <div key={x.type}>{x.type}: {x.count}</div>)}
                {phaseLogs.step2.slice(-2).map((l, i) => <div key={`s2-${i}`}>{l}</div>)}
              </div>
              <div className="mf-phase-actions">
                <button className="mf-secondary" onClick={() => downloadJson("entities.json", recognizedEntities)} disabled={!recognizedEntities.length}>Download JSON</button>
              </div>
            </div>
            <div className="mf-phase-card">
              <div className="mf-phase-head">
                <strong>03 Persona Generation</strong>
                <span>{agentPersonas.length}</span>
              </div>
              <div className="mf-phase-body">
                {agentPersonas.slice(0, 4).map((p) => <div key={p.id}>{p.role}: {p.name}</div>)}
                {phaseLogs.step3.slice(-2).map((l, i) => <div key={`s3-${i}`}>{l}</div>)}
              </div>
              <div className="mf-phase-actions">
                <button className="mf-secondary" onClick={() => downloadJson("personas.json", agentPersonas)} disabled={!agentPersonas.length}>Download JSON</button>
              </div>
            </div>
            <div className="mf-phase-card">
              <div className="mf-phase-head"><strong>04 Simulation Config</strong><span>{localSimulationConfig?.agent_configs?.length || 0} agents</span></div>
              <div className="mf-phase-body">
                {localSimulationConfig ? (
                  <>
                    <div>Horizon: {localSimulationConfig.time_config.total_simulation_hours}h</div>
                    <div>Round: {localSimulationConfig.time_config.minutes_per_round}m</div>
                    <div>Active/hr: {localSimulationConfig.time_config.agents_per_hour_min}-{localSimulationConfig.time_config.agents_per_hour_max}</div>
                  </>
                ) : <div>Run local simulator to generate config.</div>}
                {phaseLogs.step4.slice(-2).map((l, i) => <div key={`s4-${i}`}>{l}</div>)}
              </div>
              <div className="mf-phase-actions">
                <button className="mf-secondary" onClick={() => downloadJson("simulation_config.json", localSimulationConfig || {})} disabled={!localSimulationConfig}>Download JSON</button>
              </div>
            </div>
            <div className="mf-phase-card">
              <div className="mf-phase-head"><strong>05 Deep Interaction</strong><span>{displayedSimRows.length} routes</span></div>
              <div className="mf-phase-body">
                <div>Graph-click filters enabled</div>
                <div>What-if controls enabled</div>
                <div>AI deep simulation enabled</div>
                {phaseLogs.step5.slice(-2).map((l, i) => <div key={`s5-${i}`}>{l}</div>)}
              </div>
            </div>
          </div>
          <div className="mf-whatif-panel">
            <div className="mf-whatif-head">
              <strong>What-if Controls</strong>
              <span>{selectedGraphNode ? `Graph filter: ${selectedGraphNode.type} ${selectedGraphNode.label || selectedGraphNode.id}` : "Graph filter: none (all routes)"}</span>
            </div>
            <div className="mf-whatif-grid">
              <label>
                Fare Shift ({formatNum(whatIf.fareShiftPct, 1)}%)
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={whatIf.fareShiftPct}
                  onChange={(e) => setWhatIf((prev) => ({ ...prev, fareShiftPct: toNum(e.target.value) }))}
                />
              </label>
              <label>
                Spill Capture Delta ({formatNum(whatIf.spillCaptureDelta, 2)})
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={whatIf.spillCaptureDelta}
                  onChange={(e) => setWhatIf((prev) => ({ ...prev, spillCaptureDelta: toNum(e.target.value) }))}
                />
              </label>
              <label>
                Competitor Response ({formatNum(whatIf.compResponseDelta, 1)} pts)
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={0.5}
                  value={whatIf.compResponseDelta}
                  onChange={(e) => setWhatIf((prev) => ({ ...prev, compResponseDelta: toNum(e.target.value) }))}
                />
              </label>
              <div className="mf-whatif-actions">
                <button className="mf-secondary" onClick={() => setSelectedGraphNode(null)}>Clear Graph Filter</button>
                <button className="mf-secondary" onClick={() => setWhatIf({ fareShiftPct: 0, spillCaptureDelta: 0, compResponseDelta: 0 })}>Reset What-if</button>
                <button className="mf-primary" onClick={handleRunAiDeepSimulation} disabled={llmRunState === "running" || !localSimRows.length}>
                  {llmRunState === "running" ? "Running AI..." : "Run AI Deep Simulation"}
                </button>
              </div>
            </div>
            <div className="mf-llm-status">
              <span>Graphiti Local: <strong>{llmStatus.graphiti_local ? `ON (${llmStatus.modelGraphiti || "-"})` : "OFF"}</strong></span>
              <span>Gemini: <strong>{llmStatus.gemini ? `ON (${llmStatus.modelGemini || "-"})` : "OFF"}</strong></span>
              <span>GitHub Models: <strong>{llmStatus.github_models ? `ON (${llmStatus.modelGithub || "-"})` : "OFF"}</strong></span>
              <span>Ollama: <strong>{llmStatus.ollama ? `ON (${llmStatus.modelOllama || "-"})` : "OFF"}</strong></span>
              <span>Last Provider: <strong>{llmProviderUsed || "-"}</strong></span>
              <span className={llmRunState === "error" ? "bad" : ""}>{llmRunMessage || "No AI run yet."}</span>
            </div>
          </div>
          {localSimSummary ? (
            <div className="mf-local-kpis">
              <div><strong>Routes:</strong> {formatNum(displayedSummary.routes, 0)}</div>
              <div><strong>High Opp:</strong> {formatNum(displayedSummary.highOpportunityRoutes, 0)}</div>
              <div><strong>High Error:</strong> {formatNum(displayedSummary.highErrorRoutes, 0)}</div>
              <div><strong>High Competition:</strong> {formatNum(displayedSummary.highCompetitionRoutes, 0)}</div>
            </div>
          ) : null}
          <div className="mf-viz-grid">
            <div className="mf-viz-card">
              <div className="mf-viz-head"><strong>Top Opportunity Routes</strong><span>Expected revenue uplift</span></div>
              <div className="mf-viz-body">
                {topOpportunityRoutes.length ? topOpportunityRoutes.map((r) => {
                  const maxVal = Math.max(1, ...topOpportunityRoutes.map((x) => toNum(x.expectedRevenueUplift)));
                  const w = (toNum(r.expectedRevenueUplift) / maxVal) * 100;
                  return (
                    <div key={`${r.worksetId}-${r.od}`} className="mf-bar-row">
                      <div className="mf-bar-label">{r.od}</div>
                      <div className="mf-bar-track"><div className="mf-bar-fill" style={{ width: `${w}%` }} /></div>
                      <div className="mf-bar-value">{formatNum(r.expectedRevenueUplift, 0)}</div>
                    </div>
                  );
                }) : <div className="mf-empty">Run simulator to view charts.</div>}
              </div>
            </div>
            <div className="mf-viz-card">
              <div className="mf-viz-head"><strong>Competitor Pressure vs Spill</strong><span>Bubble chart (OD)</span></div>
              <div className="mf-viz-body">
                <svg viewBox="0 0 360 220" className="mf-bubble-svg">
                  <rect x="24" y="12" width="320" height="176" fill="#f8fafc" stroke="#e2e8f0" />
                  {topOpportunityRoutes.slice(0, 30).map((r, idx) => {
                    const x = 24 + clamp(toNum(r.topCompSharePct), 0, 100) * 3.2;
                    const y = 188 - clamp(toNum(r.spillCaptureRatePct), 0, 100) * 1.7;
                    const rad = clamp(3 + (toNum(r.spillRevenue) / 100000), 3, 12);
                    return (
                      <g key={`${r.od}-${idx}`}>
                        <circle cx={x} cy={y} r={rad} fill="rgba(14,165,233,0.45)" stroke="#0284c7" />
                        {idx < 10 ? <text x={x + 5} y={y - 4} className="mf-bubble-label">{r.od}</text> : null}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
          <div className="mf-local-table-wrap" style={{ borderTop: "1px solid var(--border-color)" }}>
            <table className="mf-local-table">
              <thead>
                <tr>
                  <th>OD</th>
                  <th>Action</th>
                  <th>Est Uplift</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {topActionRows.length ? topActionRows.map((r, idx) => (
                  <tr key={`${r.worksetId}-${r.od}-${r.file}-${idx}`}>
                    <td>{r.od}</td>
                    <td>{r.action}</td>
                    <td>{displayedSimRows.find((x) => x.od === r.od)?.expectedRevenueUplift ? formatNum(displayedSimRows.find((x) => x.od === r.od)?.expectedRevenueUplift, 0) : "-"}</td>
                    <td>{r.confidence}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={4} style={{ textAlign: "center", padding: "16px" }}>No action queue for current filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mf-iframe-wrap">
          <iframe title="Parallel Simulation" src={frameUrl} className="mf-iframe" />
        </div>
      )}
    </div>
  );
}
