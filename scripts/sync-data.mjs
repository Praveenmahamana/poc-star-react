import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const baseDir = resolve(appRoot, "..");               // insightsDB parent
const publicTargetDir = resolve(appRoot, "public", "data");
const srcTargetDir = resolve(appRoot, "src", "generated");
const worksetsDir = resolve(publicTargetDir, "worksets");

function isUpToDate(sourcePath, targetPath) {
  if (!existsSync(sourcePath) || !existsSync(targetPath)) return false;
  return statSync(targetPath).mtimeMs >= statSync(sourcePath).mtimeMs;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === "," && !inQuotes) { cells.push(current); current = ""; }
      else { current += c; }
    }
    cells.push(current);
    return Object.fromEntries(headers.map((h, idx) => [h.trim(), (cells[idx] ?? "").trim()]));
  });
}

function writeShardDb(rows, keyBuilder, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const grouped = new Map();
  for (const row of rows) {
    const key = keyBuilder(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  for (const [key, value] of grouped.entries()) {
    writeFileSync(resolve(targetDir, `${key}.json`), JSON.stringify(value), "utf8");
  }
  writeFileSync(resolve(targetDir, "index.json"), JSON.stringify([...grouped.keys()].sort()), "utf8");
}

function discoverWorksets(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^WORKSET\d+$/i.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch { return []; }
}

mkdirSync(publicTargetDir, { recursive: true });
mkdirSync(srcTargetDir, { recursive: true });
mkdirSync(worksetsDir, { recursive: true });

const allWorksets = discoverWorksets(baseDir);
const worksetIndex = [];
let latestWorksetId = null;

for (const worksetId of allWorksets) {
  const worksetDir = resolve(baseDir, worksetId);
  const outputDir = resolve(worksetDir, "dashboard_output");
  const bundlePath = resolve(outputDir, "dashboard_bundle.json");

  if (!existsSync(bundlePath)) {
    console.warn(`Skipping ${worksetId}: no dashboard_output/dashboard_bundle.json`);
    continue;
  }

  const wDir = resolve(worksetsDir, worksetId);
  mkdirSync(wDir, { recursive: true });

  // Bundle
  const bundleTarget = resolve(wDir, "bundle.json");
  if (!isUpToDate(bundlePath, bundleTarget)) {
    copyFileSync(bundlePath, bundleTarget);
    console.log(`Copied bundle for ${worksetId}`);
  }

  // Flight report shards
  const flightCsv = resolve(outputDir, "flight_report_summary.csv");
  const flightDbDir = resolve(wDir, "flight-report-db");
  if (existsSync(flightCsv) && !isUpToDate(flightCsv, resolve(flightDbDir, "index.json"))) {
    const rows = parseCsv(readFileSync(flightCsv, "utf8"));
    writeShardDb(rows, (row) => {
      const o = row["Dept Sta"], d = row["Arvl Sta"];
      return o && d ? `${o}-${d}` : "";
    }, flightDbDir);
    console.log(`Built flight shards for ${worksetId}`);
  }

  // Itinerary report shards
  const itinCsv = resolve(outputDir, "itinerary_report_summary.csv");
  const itinDbDir = resolve(wDir, "itinerary-report-db");
  if (existsSync(itinCsv) && !isUpToDate(itinCsv, resolve(itinDbDir, "index.json"))) {
    const rows = parseCsv(readFileSync(itinCsv, "utf8"));
    writeShardDb(rows, (row) => {
      const o = row["Dept Arp"], d = row["Arvl Arp"];
      return o && d ? `${o}-${d}` : "";
    }, itinDbDir);
    console.log(`Built itinerary shards for ${worksetId}`);
  }

  // Preference dat files
  const dataDir = resolve(worksetDir, "data");
  for (const key of ["alnPref", "alliancePref", "relfarePref"]) {
    const src = resolve(dataDir, `${key}.dat`);
    const tgt = resolve(wDir, `${key}.json`);
    if (existsSync(src) && !isUpToDate(src, tgt)) {
      const rows = parseCsv(readFileSync(src, "utf8"));
      writeFileSync(tgt, JSON.stringify(rows), "utf8");
      console.log(`Parsed ${key}.dat for ${worksetId} (${rows.length} rows)`);
    }
  }

  // Read profile for label
  let label = worksetId;
  const profilePath = resolve(outputDir, "workset_profile.json");
  if (existsSync(profilePath)) {
    try {
      const p = JSON.parse(readFileSync(profilePath, "utf8"));
      label = `${p.workset || worksetId}${p.host_airline ? " — " + p.host_airline : ""}${p.host_eff_date ? " " + p.host_eff_date : ""}`;
    } catch { /* ignore */ }
  }

  worksetIndex.push({ id: worksetId, label });
  latestWorksetId = worksetId;
}

// Write worksets index
writeFileSync(resolve(worksetsDir, "index.json"), JSON.stringify(worksetIndex), "utf8");
console.log(`Worksets: [${worksetIndex.map((w) => w.id).join(", ")}]`);

if (!latestWorksetId) {
  console.error("No worksets with dashboard_output found. Run build_dashboard_marts.py first.");
  process.exit(1);
}

// Backward compat: keep src/generated/dashboard_bundle.json for static import
const defaultBundleSrc = resolve(worksetsDir, latestWorksetId, "bundle.json");
const srcGenTarget = resolve(srcTargetDir, "dashboard_bundle.json");
if (!isUpToDate(defaultBundleSrc, srcGenTarget)) {
  copyFileSync(defaultBundleSrc, srcGenTarget);
  console.log(`Default bundle -> src/generated (${latestWorksetId})`);
}

// Backward compat: also keep old /public/data/flight-report-db/ and itinerary-report-db/
// pointing at the latest workset, so existing dist builds still serve data
const legacyFlightCsv = resolve(baseDir, latestWorksetId, "dashboard_output", "flight_report_summary.csv");
const legacyFlightDbDir = resolve(publicTargetDir, "flight-report-db");
if (existsSync(legacyFlightCsv) && !isUpToDate(legacyFlightCsv, resolve(legacyFlightDbDir, "index.json"))) {
  const rows = parseCsv(readFileSync(legacyFlightCsv, "utf8"));
  writeShardDb(rows, (row) => {
    const o = row["Dept Sta"], d = row["Arvl Sta"];
    return o && d ? `${o}-${d}` : "";
  }, legacyFlightDbDir);
}
const legacyItinCsv = resolve(baseDir, latestWorksetId, "dashboard_output", "itinerary_report_summary.csv");
const legacyItinDbDir = resolve(publicTargetDir, "itinerary-report-db");
if (existsSync(legacyItinCsv) && !isUpToDate(legacyItinCsv, resolve(legacyItinDbDir, "index.json"))) {
  const rows = parseCsv(readFileSync(legacyItinCsv, "utf8"));
  writeShardDb(rows, (row) => {
    const o = row["Dept Arp"], d = row["Arvl Arp"];
    return o && d ? `${o}-${d}` : "";
  }, legacyItinDbDir);
}

console.log("sync-data complete.");
