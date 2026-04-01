export const defaultDiagnosticsConfig = {
  warningPctError: 0.15,
  criticalPctError: 0.3,
  alphaBlend: 0.65,
  longHaulMinutes: 180,
};

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDiv(a, b, fallback = 0) {
  return b ? a / b : fallback;
}

function fmtKey(orig, dest) {
  return `${String(orig || "").toUpperCase()}-${String(dest || "").toUpperCase()}`;
}

export function aggregateErrorMetrics(rows) {
  const valid = rows.filter((r) => n(r.actual_pax) > 0);
  if (!valid.length) {
    return { mape: 0, wmape: 0, rmse: 0, mae: 0, weighted_share_error: 0, routes: 0 };
  }
  let sumAbsPct = 0;
  let sumAbsErr = 0;
  let sumSqErr = 0;
  let weightedShareErr = 0;
  let totalActual = 0;

  for (const r of valid) {
    const actual = n(r.actual_pax);
    const predicted = n(r.predicted_pax);
    const absErr = Math.abs(predicted - actual);
    const absPct = Math.abs(safeDiv(predicted - actual, actual));
    const shareErr = Math.abs(n(r.share_error));
    sumAbsPct += absPct;
    sumAbsErr += absErr;
    sumSqErr += (predicted - actual) ** 2;
    weightedShareErr += shareErr * actual;
    totalActual += actual;
  }

  return {
    routes: valid.length,
    mape: sumAbsPct / valid.length,
    wmape: safeDiv(sumAbsErr, totalActual),
    rmse: Math.sqrt(sumSqErr / valid.length),
    mae: sumAbsErr / valid.length,
    weighted_share_error: safeDiv(weightedShareErr, totalActual),
  };
}

export function classifyRouteAbnormality(route, config = defaultDiagnosticsConfig) {
  const pctErr = n(route.percentage_error);
  const absPctErr = Math.abs(pctErr);
  const shareErr = Math.abs(n(route.share_error));
  const connecting = Boolean(route.connecting_flag);
  const alliancePref = Math.abs(n(route.alliance_preference_score));
  const airlinePref = Math.abs(n(route.airline_preference_score));
  const connectionPenalty = Math.abs(n(route.connection_penalty));
  const marketInputGap = Math.abs(n(route.market_share_input_gap));

  let abnormality_type = "normal";
  let explanation = "Residual is within configured calibration tolerance.";

  if (absPctErr >= config.warningPctError) {
    abnormality_type = "systematic demand bias";
    explanation = "Predicted route demand materially differs from observed demand.";

    if (shareErr >= 0.05 && absPctErr < 0.25) {
      abnormality_type = "competitive misallocation";
      explanation = "Total demand is relatively stable but airline share split appears misallocated.";
    }
    if (connecting && pctErr < -config.warningPctError && connectionPenalty > 0.5) {
      abnormality_type = "connectivity / connection-penalty issue";
      explanation = "Connecting itinerary underperformance is consistent with excessive connection disutility.";
    }
    if (alliancePref > 40 && shareErr > 0.04) {
      abnormality_type = "alliance preference distortion";
      explanation = "Alliance preference priors are likely over/under-weighted against observed route split.";
    }
    if (airlinePref > 1.4 && shareErr > 0.04) {
      abnormality_type = "airline preference distortion";
      explanation = "Airline preference term appears too strong relative to observed route behavior.";
    }
    if (marketInputGap > 25 && shareErr > 0.05) {
      abnormality_type = "missing segmentation / structural issue";
      explanation = "Route-level share priors diverge from observed split and likely require dedicated segmentation bucket.";
    }
    if (Math.abs(n(route.actual_pax)) < 25 && absPctErr > config.criticalPctError) {
      abnormality_type = "noisy / unstable route";
      explanation = "Very low-volume route with high relative error; apply smoothing and avoid overfitting.";
    }
  }

  const severity = absPctErr >= config.criticalPctError ? "critical" : absPctErr >= config.warningPctError ? "warning" : "normal";
  return { abnormality_type, explanation, severity };
}

export function buildRouteRecommendations(route, config = defaultDiagnosticsConfig) {
  const recs = [];
  const pctErr = n(route.percentage_error);
  const absPctErr = Math.abs(pctErr);
  const shareErr = n(route.share_error);
  const confBase = Math.min(0.95, 0.45 + absPctErr * 1.1);

  if (absPctErr >= config.warningPctError) {
    recs.push({
      reason: "Demand-level residual exceeds threshold.",
      action: pctErr > 0 ? "Reduce intercept / demand baseline for this route or segment." : "Increase intercept / demand baseline for this route or segment.",
      metric: "Track route MAE and WMAPE after next recalibration run.",
      confidence: confBase,
    });
  }

  if (Math.abs(shareErr) >= 0.04) {
    recs.push({
      reason: "Observed market share and modeled share diverge.",
      action: shareErr > 0 ? "Increase host market-share split constraint and reduce competitor split in this bucket." : "Decrease host split bias or blend with historical share.",
      metric: "Track weighted share error and top-competitor share delta.",
      confidence: Math.min(0.95, confBase + 0.05),
    });
  }

  if (route.connecting_flag && pctErr < -config.warningPctError) {
    recs.push({
      reason: "Connecting-heavy route under-predicts demand.",
      action: "Ease connection penalty / improve online-connection utility coefficient for matching segment.",
      metric: "Track connecting-route MAPE and itinerary conversion uplift.",
      confidence: Math.min(0.92, confBase + 0.06),
    });
  }

  if (Math.abs(n(route.airline_preference_score)) > 1.2) {
    recs.push({
      reason: "Airline preference prior is materially non-neutral.",
      action: "Adjust airline preference term toward neutral for this OD bucket and re-test.",
      metric: "Track route share drift and competitor capture change.",
      confidence: Math.min(0.9, confBase),
    });
  }

  if (Math.abs(n(route.alliance_preference_score)) > 50) {
    recs.push({
      reason: "Alliance preference input is strong relative to route behavior.",
      action: "Re-center alliance preference for this market pair and monitor share stabilization.",
      metric: "Track alliance-level bias by OD segment.",
      confidence: Math.min(0.9, confBase),
    });
  }

  recs.push({
    reason: "Stabilize short-term share volatility.",
    action: `Apply smoothed share calibration: adjusted_share = ${config.alphaBlend.toFixed(2)} * model_share + ${(1 - config.alphaBlend).toFixed(2)} * historical_share.`,
    metric: "Track before/after WMAPE and weighted share error.",
    confidence: 0.7,
  });

  return recs.slice(0, 5);
}

export function computeDiagnosticsDataset({ odRows = [], level2Rows = [], priorRows = [], mlSignals = null, hostAirline = "", config = defaultDiagnosticsConfig }) {
  const priorsByOd = new Map(priorRows.map((r) => [String(r.od || ""), r]));
  const level2ByOd = new Map();
  for (const row of level2Rows) {
    const od = fmtKey(row.orig, row.dest);
    const bucket = level2ByOd.get(od) || [];
    bucket.push(row);
    level2ByOd.set(od, bucket);
  }

  const routes = odRows.map((row) => {
    const od = fmtKey(row.orig, row.dest);
    const actual_pax = n(row.weeklyPax || row.weekly_pax_est || 0);
    const predicted_pax = n(row.totalPax || row.apm_weekly_pax_est || 0);
    const actual_market_share = n(row.actualMarketSharePct, n(row.hostShareActualPct, n(row.hostSharePct, 0))) / 100;
    const predicted_market_share = n(row.predictedMarketSharePct, n(row.hostSharePct, 0)) / 100;
    const percentage_error = safeDiv(predicted_pax - actual_pax, actual_pax);
    const share_error = predicted_market_share - actual_market_share;
    const abs_error = Math.abs(predicted_pax - actual_pax);
    const abs_percentage_error = Math.abs(percentage_error);
    const pri = priorsByOd.get(od) || {};
    const marketRows = (level2ByOd.get(od) || []).slice().sort((a, b) => n(b.traffic_share_pct_est) - n(a.traffic_share_pct_est));
    const hostRow = marketRows.find((r) => Boolean(r.is_host_airline) || String(r.carrier || "").trim() === hostAirline) || null;
    const topComp = marketRows.find((r) => !Boolean(r.is_host_airline) && String(r.carrier || "").trim() !== hostAirline) || null;

    const elapsed = n(hostRow?.avg_elapsed_minutes);
    const route = {
      route_id: od,
      origin: String(row.orig || "").toUpperCase(),
      destination: String(row.dest || "").toUpperCase(),
      season: row.season || "Current",
      airline: hostAirline,
      cabin: row.cabin || "All",
      actual_pax,
      predicted_pax,
      absolute_error: abs_error,
      percentage_error,
      absolute_percentage_error: abs_percentage_error,
      actual_market_share,
      predicted_market_share,
      share_error,
      distance: n(row.distance_km, elapsed > 0 ? elapsed * 13 : 0),
      nonstop_flag: n(hostRow?.nonstop_itinerary_count) > 0,
      connecting_flag: n(hostRow?.single_connect_itinerary_count) > 0,
      alliance: pri.alliance_tag || "",
      airline_preference_score: n(pri.airline_preference_score),
      alliance_preference_score: n(pri.alliance_preference_score),
      connection_penalty: n(pri.connection_penalty_prior, n(mlSignals?.logit_baseline?.ONLNCONN)),
      market_share_input_gap: n(pri.market_share_input_gap),
      tow_expected_utility: n(pri.tow_expected_utility),
      market_split: marketRows.map((m) => ({
        airline: String(m.carrier || ""),
        predicted_share: n(m.traffic_share_pct_est) / 100,
        actual_share: n(m.demand_share_pct_est) / 100,
      })),
      top_competitor: topComp?.carrier || "",
      top_competitor_share: n(topComp?.traffic_share_pct_est) / 100,
      elapsed_minutes: elapsed,
      segment_haul: elapsed >= config.longHaulMinutes ? "Long Haul" : "Short Haul",
      segment_connectivity: n(hostRow?.single_connect_itinerary_count) > 0 ? "Connecting" : "Nonstop",
      route_correction_factor: safeDiv(actual_pax, predicted_pax, 1),
      adjusted_share_smoothed: config.alphaBlend * predicted_market_share + (1 - config.alphaBlend) * actual_market_share,
    };

    const cls = classifyRouteAbnormality(route, config);
    const recs = buildRouteRecommendations(route, config);
    return { ...route, ...cls, recommendations: recs };
  });

  const overall = aggregateErrorMetrics(routes);
  const segments = {};
  const segGroups = new Map();
  for (const r of routes) {
    const key = `${r.segment_haul} | ${r.segment_connectivity}`;
    const arr = segGroups.get(key) || [];
    arr.push(r);
    segGroups.set(key, arr);
  }
  for (const [key, arr] of segGroups.entries()) {
    segments[key] = aggregateErrorMetrics(arr);
  }

  const overpredicted = routes.slice().sort((a, b) => b.percentage_error - a.percentage_error).slice(0, 20);
  const underpredicted = routes.slice().sort((a, b) => a.percentage_error - b.percentage_error).slice(0, 20);
  const shareMisalloc = routes.slice().sort((a, b) => Math.abs(b.share_error) - Math.abs(a.share_error)).slice(0, 20);
  const flagged = routes.filter((r) => r.severity !== "normal");

  const correctedRows = routes.map((r) => {
    const adjusted_pred = n(r.predicted_pax) * n(r.route_correction_factor, 1);
    const segFactor = safeDiv(
      segGroups.get(`${r.segment_haul} | ${r.segment_connectivity}`)?.reduce((s, x) => s + n(x.actual_pax), 0) || 0,
      segGroups.get(`${r.segment_haul} | ${r.segment_connectivity}`)?.reduce((s, x) => s + n(x.predicted_pax), 0) || 1,
      1,
    );
    const adjusted_segment_pred = n(r.predicted_pax) * segFactor;
    return {
      ...r,
      adjusted_pred,
      adjusted_segment_pred,
      adjusted_share: r.adjusted_share_smoothed,
      adjusted_abs_error: Math.abs(adjusted_pred - n(r.actual_pax)),
      adjusted_pct_error: safeDiv(adjusted_pred - n(r.actual_pax), n(r.actual_pax), 0),
    };
  });

  const afterMetrics = aggregateErrorMetrics(
    correctedRows.map((r) => ({
      actual_pax: r.actual_pax,
      predicted_pax: r.adjusted_pred,
      share_error: r.adjusted_share - r.actual_market_share,
    })),
  );

  return {
    routes,
    flagged,
    tables: { overpredicted, underpredicted, shareMisalloc },
    summary: { overall, segments, before: overall, after: afterMetrics },
    correctedRows,
    routeLevelModelSuggestions: mlSignals?.route_level_recommendations || [],
    segmentLevelModelSuggestions: mlSignals?.segment_level_recommendations || [],
    overallCoeffSuggestions: mlSignals?.recommendations || [],
  };
}

export function buildRouteWaterfallContributions(route) {
  const actual = n(route.actual_pax);
  const predicted = n(route.predicted_pax);
  const pctError = n(route.percentage_error);
  const baseline = predicted * (1 - Math.min(0.3, Math.abs(pctError) * 0.35));
  const logitCoeff = (predicted - baseline) * 0.45;
  const alliance = actual * n(route.alliance_preference_score) * 0.0008;
  const airlinePref = actual * n(route.airline_preference_score) * 0.03;
  const connectivity = actual * n(route.connection_penalty) * -0.01;
  const marketShare = actual * n(route.market_share_input_gap) * 0.0025;
  const total = baseline + logitCoeff + alliance + airlinePref + connectivity + marketShare;
  const residual = actual - total;
  return [
    { key: "baseline", label: "Baseline / Intercept Proxy", value: baseline },
    { key: "logit", label: "Logit Coefficient Effects", value: logitCoeff },
    { key: "alliance", label: "Alliance Preference", value: alliance },
    { key: "airline", label: "Airline Preference", value: airlinePref },
    { key: "connectivity", label: "Connectivity / Penalty", value: connectivity },
    { key: "market", label: "Market Share Prior", value: marketShare },
    { key: "residual", label: "Residual / Other Features", value: residual },
  ];
}
