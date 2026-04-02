import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";

const root = join(process.cwd(), "dist");
const host = "127.0.0.1";
const port = 4173;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".sqlite": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const graphitiStore = {
  entities: new Map(),
  edges: [],
  episodes: [],
  builtAt: null,
};

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("Not found");
}

function sendServerError(res, error) {
  res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`Server error: ${error?.message || "unknown"}`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error?.message || error}`));
      }
    });
    req.on("error", reject);
  });
}

function buildCalibrationPrompt(input) {
  const hostAirline = String(input?.hostAirline || "HOST");
  const selectedCarrier = String(input?.selectedCarrier || hostAirline);
  const scopeLabel = String(input?.scope || "all");
  const routes = Array.isArray(input?.routes) ? input.routes.slice(0, 120) : [];
  const routeLines = routes.map((r) => ({
    worksetId: r.worksetId,
    od: r.od,
    hostSharePct: r.hostSharePct,
    topCompSharePct: r.topCompSharePct,
    signedDiffPct: r.signedDiffPct,
    flowPct: r.flowPct,
    fareGapPct: r.fareGapPct,
    oppScore: r.oppScore,
    competitors: r.competitors,
    recommendation: r.recommendation,
  }));

  return [
    "You are a senior airline O&D calibration simulation engine.",
    "Language: English only.",
    "Return JSON only, no markdown.",
    "",
    `Host airline: ${hostAirline}`,
    `Selected carrier: ${selectedCarrier}`,
    `Scope: ${scopeLabel}`,
    "",
    "Task:",
    "1) Diagnose abnormality route-wise from demand/share/fare/flow errors.",
    "2) Provide measurable file/column-level edit suggestions for each route.",
    "3) Include competition/opportunity commentary and expected impact.",
    "",
    "Output JSON schema:",
    "{",
    '  "global_summary": { "priority": "...", "top_theme": "...", "confidence": "high|medium|low" },',
    '  "route_analyses": [',
    "    {",
    '      "worksetId":"...",',
    '      "od":"ORG-DST",',
    '      "abnormality_type":"demand_bias|competitive_misallocation|alliance_distortion|airline_pref_distortion|connectivity_issue|segment_mismatch|noisy_route",',
    '      "confidence":"high|medium|low",',
    '      "reason":"...",',
    '      "suggested_action":"...",',
    '      "expected_measurement":"...",',
    '      "competitor_commentary":"...",',
    '      "changes":[{"file":"...","column":"...","action":"increase|decrease|rebalance","delta":"...","reason":"..."}]',
    "    }",
    "  ]",
    "}",
    "",
    "Routes:",
    JSON.stringify(routeLines),
  ].join("\n");
}

function buildDeterministicFallback(input) {
  const routes = Array.isArray(input?.routes) ? input.routes : [];
  const route_analyses = routes.map((r) => {
    const shareGap = Number(r.topCompSharePct || 0) - Number(r.hostSharePct || 0);
    const demandErr = Math.abs(Number(r.signedDiffPct || 0));
    const flowPct = Number(r.flowPct || 0);
    const fareGap = Number(r.fareGapPct || 0);

    let abnormality_type = "noisy_route";
    let reason = "Mixed weak signals across demand/share/fare dimensions.";
    let suggested_action = "Use small-step smoothing and monitor residual drift.";
    const changes = [];
    let confidence = "low";

    if (demandErr >= 20) {
      abnormality_type = "demand_bias";
      reason = `Large model-vs-observed demand gap (${demandErr.toFixed(1)}%).`;
      suggested_action = "Tune route utility sensitivity in logit coefficients.";
      changes.push({ file: "data/logitCoeff.dat", column: "RELFARE|ELPTM|ORGPRES", action: "rebalance", delta: "small-to-medium step", reason });
      confidence = "high";
    } else if (shareGap >= 6) {
      abnormality_type = "competitive_misallocation";
      reason = `Competitor share lead is high (${shareGap.toFixed(1)} pts).`;
      suggested_action = "Increase host preference for the route segment.";
      changes.push({ file: "data/alliancePref.dat", column: "HOVAL/LOVAL/HRVAL/LRVAL", action: "increase", delta: "+3 to +10", reason });
      changes.push({ file: "data/alnPref.dat", column: "HOVAL/LOVAL/HRVAL/LRVAL", action: "increase", delta: "+0.1 to +0.4", reason });
      confidence = "medium";
    } else if (flowPct >= 35) {
      abnormality_type = "connectivity_issue";
      reason = `Flow mix is elevated (${flowPct.toFixed(1)}%).`;
      suggested_action = "Rebalance flow/local distribution and connection penalties.";
      changes.push({ file: "data/towProb.dat", column: "OFFSET|PROB bins", action: "rebalance", delta: "OFFSET +/-1..3", reason });
      confidence = "medium";
    } else if (fareGap >= 8) {
      abnormality_type = "airline_pref_distortion";
      reason = `Fare gap is high (${fareGap.toFixed(1)}%).`;
      suggested_action = "Reduce fare premium assumptions on contested OD.";
      changes.push({ file: "data/rev.dat", column: "fare/yield fields", action: "decrease", delta: "-3% to -8%", reason });
      confidence = "medium";
    }

    return {
      worksetId: String(r.worksetId || ""),
      od: String(r.od || ""),
      abnormality_type,
      confidence,
      reason,
      suggested_action,
      expected_measurement: "Track abs demand error, host share uplift, and flow/local mix shift after rerun.",
      competitor_commentary: String(r.competitors || "No competitor detail available."),
      changes,
    };
  });

  return {
    global_summary: {
      priority: "stabilize top-opportunity routes first",
      top_theme: "demand-share calibration with competition pressure",
      confidence: "medium",
    },
    route_analyses,
  };
}

function parseCompetitors(raw) {
  const text = String(raw || "");
  if (!text) return [];
  return text
    .split(",")
    .map((x) => x.trim())
    .map((x) => {
      const m = x.match(/^([A-Z0-9]{1,4})\s*:\s*([0-9.]+)\s*%?$/i);
      return m ? { carrier: m[1].toUpperCase(), sharePct: Number(m[2]) || 0 } : null;
    })
    .filter(Boolean);
}

function upsertEntity(id, type, attrs = {}) {
  if (!id) return;
  const prev = graphitiStore.entities.get(id) || { id, type, attrs: {}, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() };
  graphitiStore.entities.set(id, {
    ...prev,
    type: type || prev.type,
    attrs: { ...(prev.attrs || {}), ...attrs },
    last_seen: new Date().toISOString(),
  });
}

function addEdge(source, target, relation, attrs = {}) {
  graphitiStore.edges.push({
    source,
    target,
    relation,
    attrs,
    valid_at: new Date().toISOString(),
  });
  if (graphitiStore.edges.length > 12000) {
    graphitiStore.edges = graphitiStore.edges.slice(-12000);
  }
}

function buildLocalGraphitiMemory(input) {
  const hostAirline = String(input?.hostAirline || "HOST").toUpperCase();
  const routes = Array.isArray(input?.routes) ? input.routes : [];
  const now = new Date().toISOString();
  graphitiStore.builtAt = now;

  for (const r of routes) {
    const worksetId = String(r.worksetId || "");
    const od = String(r.od || "");
    if (!od) continue;
    const [orig = "", dest = ""] = od.split("-");
    const routeId = `route:${worksetId}:${od}`;
    const worksetNode = `workset:${worksetId}`;
    const hostNode = `airline:${hostAirline}`;

    upsertEntity(worksetNode, "workset", { worksetId });
    upsertEntity(routeId, "route", {
      worksetId,
      od,
      orig,
      dest,
      oppScore: Number(r.oppScore || 0),
      signedDiffPct: Number(r.signedDiffPct || 0),
      hostSharePct: Number(r.hostSharePct || 0),
      topCompSharePct: Number(r.topCompSharePct || 0),
      flowPct: Number(r.flowPct || 0),
      fareGapPct: Number(r.fareGapPct || 0),
      spillRevenue: Number(r.spillRevenue || 0),
      expectedRevenueUplift: Number(r.expectedRevenueUplift || 0),
      potentialRouteTag: String(r.potentialRouteTag || ""),
    });
    upsertEntity(hostNode, "host_airline", { code: hostAirline });
    addEdge(worksetNode, routeId, "contains_market");
    addEdge(hostNode, routeId, "serves_route");

    for (const c of parseCompetitors(r.competitors)) {
      const compNode = `airline:${c.carrier}`;
      upsertEntity(compNode, "competitor_airline", { code: c.carrier });
      addEdge(compNode, routeId, "competes_on", { sharePct: c.sharePct });
      if ((Number(r.hostSharePct || 0) + 2) < c.sharePct) {
        addEdge(compNode, hostNode, "dominates_share", { od, shareGap: c.sharePct - Number(r.hostSharePct || 0) });
      }
    }

    graphitiStore.episodes.push({
      id: `ep:${worksetId}:${od}:${Date.now()}`,
      timestamp: now,
      routeId,
      worksetId,
      observation: {
        signedDiffPct: Number(r.signedDiffPct || 0),
        spillRevenue: Number(r.spillRevenue || 0),
        expectedRevenueUplift: Number(r.expectedRevenueUplift || 0),
      },
    });
    if (graphitiStore.episodes.length > 10000) {
      graphitiStore.episodes = graphitiStore.episodes.slice(-10000);
    }
  }
}

function analyzeWithGraphiti(input) {
  buildLocalGraphitiMemory(input);
  const routes = Array.isArray(input?.routes) ? input.routes : [];
  const ranked = [...routes]
    .map((r) => {
      const spillRev = Number(r.spillRevenue || 0);
      const uplift = Number(r.expectedRevenueUplift || 0);
      const shareGap = Math.max(0, Number(r.topCompSharePct || 0) - Number(r.hostSharePct || 0));
      const demandErr = Math.abs(Number(r.signedDiffPct || 0));
      const score = (uplift / 100000) * 40 + (spillRev / 200000) * 25 + (shareGap / 20) * 20 + (demandErr / 40) * 15;
      return { ...r, _graphitiScore: score };
    })
    .sort((a, b) => b._graphitiScore - a._graphitiScore)
    .slice(0, 120);

  const route_analyses = ranked.map((r) => {
    const shareGap = Number(r.topCompSharePct || 0) - Number(r.hostSharePct || 0);
    const demandErr = Math.abs(Number(r.signedDiffPct || 0));
    const spillRevenue = Number(r.spillRevenue || 0);
    const uplift = Number(r.expectedRevenueUplift || 0);
    const flowPct = Number(r.flowPct || 0);

    let abnormality_type = "noisy_route";
    let reason = "Multi-factor route pressure observed.";
    let suggested_action = "Apply phased correction and monitor route response.";
    let confidence = "medium";
    const changes = [];

    if (spillRevenue > 50000 || uplift > 20000) {
      abnormality_type = "competitive_misallocation";
      reason = `High spill value (₹${Math.round(spillRevenue)}) with estimated capture uplift ₹${Math.round(uplift)}.`;
      suggested_action = "Prioritize spill capture on this route and rebalance local-flow assumptions.";
      changes.push({ file: "out/SPILLDATA.dat", column: "flow spill records", action: "reduce leak", delta: "capture +8% to +20%", reason });
      changes.push({ file: "out/BASEDATA.dat", column: "local/flow allocation", action: "rebalance", delta: "flow->local conversion +3% to +10%", reason });
      confidence = "high";
    }
    if (shareGap > 6) {
      changes.push({
        file: "data/alliancePref.dat,data/alnPref.dat",
        column: "segment preference fields",
        action: "increase",
        delta: "alliance +3..+12 / airline +0.1..+0.4",
        reason: `Competitor share lead ${shareGap.toFixed(1)} pts.`,
      });
    }
    if (demandErr > 18) {
      if (abnormality_type === "noisy_route") abnormality_type = "demand_bias";
      changes.push({
        file: "data/logitCoeff.dat",
        column: "RELFARE|ELPTM|ORGPRES|NSTOP",
        action: "rebalance",
        delta: "small-to-medium",
        reason: `Demand error ${demandErr.toFixed(1)}%.`,
      });
    }
    if (flowPct > 35) {
      changes.push({
        file: "data/towProb.dat",
        column: "OFFSET|PROB bins",
        action: "rebalance",
        delta: "OFFSET +/-1..3",
        reason: `Flow-heavy route (${flowPct.toFixed(1)}%).`,
      });
    }

    return {
      worksetId: String(r.worksetId || ""),
      od: String(r.od || ""),
      abnormality_type,
      confidence,
      reason,
      suggested_action,
      expected_measurement: `Track uplift realization vs baseline. Estimated incremental revenue: ₹${Math.round(uplift)}.`,
      competitor_commentary: String(r.competitors || "No competitor snapshot."),
      changes,
    };
  });

  return {
    global_summary: {
      priority: "spill-value and competitor-dominant routes first",
      top_theme: "SPILLDATA/BASEDATA-driven competitive opportunity capture",
      confidence: "high",
    },
    route_analyses,
    graphiti_memory: {
      built_at: graphitiStore.builtAt,
      node_count: graphitiStore.entities.size,
      edge_count: graphitiStore.edges.length,
      episode_count: graphitiStore.episodes.length,
    },
  };
}

function tryParseJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function callGemini(promptText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { responseMimeType: "application/json" },
      contents: [{ role: "user", parts: [{ text: promptText }] }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini API failed (${res.status}): ${json?.error?.message || "unknown error"}`);
  }
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n") || "";
  const parsed = tryParseJsonText(text);
  if (!parsed) throw new Error("Gemini response was not valid JSON");
  return { provider: "gemini", model, parsed };
}

async function callGithubModels(promptText) {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT not configured");
  const preferred = (process.env.GITHUB_MODELS_MODEL || "").trim();
  const candidates = [
    preferred,
    "openai/gpt-4.1-mini",
    "openai/gpt-4o-mini",
    "meta/llama-3.1-8b-instruct",
    "microsoft/phi-4-mini-instruct",
  ].filter(Boolean);
  const seen = new Set();
  const ordered = candidates.filter((m) => (seen.has(m) ? false : (seen.add(m), true)));

  const failures = [];
  for (const model of ordered) {
    const res = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are an airline calibration simulator. Return strict JSON only." },
          { role: "user", content: promptText },
        ],
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      failures.push(`${model}: ${res.status} ${json?.error?.message || json?.message || "unknown error"}`);
      continue;
    }
    const text = json?.choices?.[0]?.message?.content || "";
    const parsed = tryParseJsonText(text);
    if (!parsed) {
      failures.push(`${model}: non-JSON response`);
      continue;
    }
    return { provider: "github-models", model, parsed };
  }
  throw new Error(`GitHub Models API failed for all candidate models. ${failures.join(" | ")}`);
}

async function callOllama(promptText) {
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b-instruct-q4_K_M";
  const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const prompt = [
    "Return strict JSON only, no markdown, no prose outside JSON.",
    "Follow the required schema exactly.",
    "",
    promptText,
  ].join("\n");
  const res = await fetch(`${String(base).replace(/\/+$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      prompt,
      options: { temperature: 0.2, num_predict: 1800 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Ollama API failed (${res.status}): ${json?.error || json?.message || "unknown error"}`);
  }
  const text = json?.response || json?.message?.content || "";
  const parsed = tryParseJsonText(text);
  if (!parsed) throw new Error("Ollama response was not valid JSON");
  return { provider: "ollama", model, parsed };
}

if (!existsSync(root)) {
  console.error("dist folder not found. Run `npm run build` first.");
  process.exit(1);
}

const server = createServer((req, res) => {
  try {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.url === "/api/llm/status") {
      sendJson(res, 200, {
        ok: true,
        providers: {
          graphiti_local: true,
          gemini: Boolean(process.env.GEMINI_API_KEY),
          github_models: Boolean(process.env.GITHUB_PAT),
          ollama: true,
        },
        models: {
          graphiti_local: "graphiti-local-v1",
          gemini: process.env.GEMINI_MODEL || "gemini-2.5-pro",
          github_models: process.env.GITHUB_MODELS_MODEL || "openai/gpt-4.1",
          ollama: process.env.OLLAMA_MODEL || "llama3.1:8b-instruct-q4_K_M",
        },
      });
      return;
    }

    if (req.url === "/api/graphiti/status") {
      sendJson(res, 200, {
        ok: true,
        built_at: graphitiStore.builtAt,
        node_count: graphitiStore.entities.size,
        edge_count: graphitiStore.edges.length,
        episode_count: graphitiStore.episodes.length,
      });
      return;
    }

    if (req.url === "/api/llm/simulate" && req.method === "POST") {
      readJsonBody(req)
        .then(async (body) => {
          // Local Graphiti-style memory + analysis is primary for reliability and speed.
          const graphitiResult = analyzeWithGraphiti(body || {});
          if (process.env.ENABLE_EXTERNAL_LLM_AUGMENT !== "true") {
            sendJson(res, 200, { ok: true, provider: "graphiti-local", model: "graphiti-local-v1", result: graphitiResult });
            return;
          }

          const prompt = buildCalibrationPrompt(body || {});
          try {
            const out = await callGemini(prompt);
            sendJson(res, 200, { ok: true, provider: out.provider, model: out.model, result: out.parsed, base: graphitiResult });
            return;
          } catch (errGemini) {
            try {
              const out = await callGithubModels(prompt);
              sendJson(res, 200, { ok: true, provider: out.provider, model: out.model, result: out.parsed, base: graphitiResult, fallbackFrom: String(errGemini?.message || "") });
              return;
            } catch (errGithub) {
              try {
                const out = await callOllama(prompt);
                sendJson(res, 200, {
                  ok: true,
                  provider: out.provider,
                  model: out.model,
                  result: out.parsed,
                  base: graphitiResult,
                  fallbackFrom: `${String(errGemini?.message || "")} | ${String(errGithub?.message || "")}`,
                });
                return;
              } catch (errOllama) {
                sendJson(res, 200, {
                  ok: true,
                  provider: "graphiti-local",
                  model: "graphiti-local-v1",
                  result: graphitiResult?.route_analyses?.length ? graphitiResult : buildDeterministicFallback(body || {}),
                  fallbackFrom: [
                    `gemini: ${String(errGemini?.message || errGemini)}`,
                    `github_models: ${String(errGithub?.message || errGithub)}`,
                    `ollama: ${String(errOllama?.message || errOllama)}`,
                  ].join(" | "),
                });
              }
            }
          }
        })
        .catch((error) => sendJson(res, 400, { ok: false, message: String(error?.message || error) }));
      return;
    }

    const rawPath = (req.url || "/").split("?")[0];
    const requested = rawPath === "/" ? "/index.html" : rawPath;
    const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
    let fullPath = join(root, safePath);

    if (!fullPath.startsWith(root)) {
      sendNotFound(res);
      return;
    }

    if (!existsSync(fullPath) || (existsSync(fullPath) && statSync(fullPath).isDirectory())) {
      fullPath = join(root, "index.html");
    }

    if (!existsSync(fullPath)) {
      sendNotFound(res);
      return;
    }

    const ext = extname(fullPath).toLowerCase();
    const contentType = contentTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store, max-age=0" });
    createReadStream(fullPath).pipe(res);
  } catch (error) {
    sendServerError(res, error);
  }
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Close old dashboard processes and retry.`);
    process.exit(1);
  }
  console.error("Server startup failed:", error?.message || error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Dashboard server running at http://${host}:${port}`);
  console.log("No-cache mode enabled to avoid stale dashboard versions.");
});
