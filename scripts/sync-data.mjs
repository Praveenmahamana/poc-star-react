import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const baseDir = resolve(appRoot, "..");
const publicTargetDir = resolve(appRoot, "public", "data");
const srcTargetDir = resolve(appRoot, "src", "generated");
const worksetsDir = resolve(publicTargetDir, "worksets");
const martsBuilderScript = resolve(baseDir, "scripts", "build_dashboard_marts.py");
const sqliteBuilderScript = resolve(appRoot, "scripts", "build_worksets_sqlite.py");
const sqliteDbPath = resolve(worksetsDir, "dashboard.sqlite");

const dashboardBuilderInputs = [
  ["data", "analysis.dat"],
  ["data", "mktSize.dat"],
  ["data", "cdshr.dat"],
  ["data", "opp.dat"],
  ["data", "rev.dat"],
  ["data", "yieldFile.dat"],
  ["out", "skd.out"],
  ["out", "BASEDATA.dat"],
  ["out", "SPILLDATA.dat"],
];

function isUpToDate(sourcePath, targetPath) {
  if (!existsSync(sourcePath) || !existsSync(targetPath)) return false;
  return statSync(targetPath).mtimeMs >= statSync(sourcePath).mtimeMs;
}

function discoverWorksets(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^WORKSET\d+$/i.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function hasDashboardBuilderInputs(worksetDir) {
  return dashboardBuilderInputs.every((parts) => existsSync(resolve(worksetDir, ...parts)));
}

function runPythonScript(scriptPath, args) {
  const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { stdio: "inherit" });
  let result = run("python", [scriptPath, ...args]);
  if (result.error || result.status !== 0) {
    result = run("py", ["-3", scriptPath, ...args]);
  }
  return !result.error && result.status === 0;
}

function tryPrepareDashboardOutput(worksetId, worksetDir, outputDir) {
  if (!existsSync(martsBuilderScript)) return false;
  if (!hasDashboardBuilderInputs(worksetDir)) return false;

  console.log(`Preparing dashboard_output for ${worksetId}...`);

  const ok = runPythonScript(martsBuilderScript, ["--workset", worksetDir, "--output", outputDir]);
  if (!ok) {
    console.warn(`Failed to prepare dashboard_output for ${worksetId}.`);
    return false;
  }
  return true;
}

function safeRemove(path) {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove ${path}: ${error?.message || error}`);
  }
}

function listFilesRecursive(dir, base = dir) {
  const items = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      items.push(...listFilesRecursive(fullPath, base));
    } else if (entry.isFile()) {
      const relPath = fullPath.slice(base.length + 1).replace(/\\/g, "/");
      items.push({ fullPath, relPath, size: statSync(fullPath).size });
    }
  }
  return items;
}

function copyWorksetRawFiles(worksetDir, targetRawDir) {
  const filesDir = resolve(targetRawDir, "files");
  safeRemove(targetRawDir);
  mkdirSync(filesDir, { recursive: true });
  const files = listFilesRecursive(worksetDir);
  for (const file of files) {
    const outPath = resolve(filesDir, file.relPath);
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(file.fullPath, outPath);
  }
  writeFileSync(
    resolve(targetRawDir, "manifest.json"),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      file_count: files.length,
      files: files.map((f) => ({ path: f.relPath, size: f.size })),
    }),
    "utf8",
  );
}

mkdirSync(publicTargetDir, { recursive: true });
mkdirSync(srcTargetDir, { recursive: true });
mkdirSync(worksetsDir, { recursive: true });

const allWorksets = discoverWorksets(baseDir);
const worksetIndex = [];
const readyWorksets = [];
let latestWorksetId = null;

for (const worksetId of allWorksets) {
  const worksetDir = resolve(baseDir, worksetId);
  const outputDir = resolve(worksetDir, "dashboard_output");
  let bundlePath = resolve(outputDir, "dashboard_bundle.json");

  if (!existsSync(bundlePath)) {
    const prepared = tryPrepareDashboardOutput(worksetId, worksetDir, outputDir);
    bundlePath = resolve(outputDir, "dashboard_bundle.json");
    if (!prepared || !existsSync(bundlePath)) {
      console.warn(`Skipping ${worksetId}: no dashboard_output/dashboard_bundle.json`);
      continue;
    }
  }

  const wDir = resolve(worksetsDir, worksetId);
  mkdirSync(wDir, { recursive: true });

  const bundleTarget = resolve(wDir, "bundle.json");
  if (!isUpToDate(bundlePath, bundleTarget)) {
    copyFileSync(bundlePath, bundleTarget);
    console.log(`Copied bundle for ${worksetId}`);
  }

  safeRemove(resolve(wDir, "flight-report-db"));
  safeRemove(resolve(wDir, "itinerary-report-db"));
  copyWorksetRawFiles(worksetDir, resolve(wDir, "raw"));

  let label = worksetId;
  const profilePath = resolve(outputDir, "workset_profile.json");
  if (existsSync(profilePath)) {
    try {
      const p = JSON.parse(readFileSync(profilePath, "utf8"));
      label = `${p.workset || worksetId}${p.host_airline ? " \u2014 " + p.host_airline : ""}${p.host_eff_date ? " " + p.host_eff_date : ""}`;
    } catch {
      // ignore malformed profile
    }
  }

  worksetIndex.push({ id: worksetId, label });
  readyWorksets.push(worksetId);
  latestWorksetId = worksetId;
}

writeFileSync(resolve(worksetsDir, "index.json"), JSON.stringify(worksetIndex), "utf8");
console.log(`Worksets: [${worksetIndex.map((w) => w.id).join(", ")}]`);

if (!latestWorksetId) {
  console.error("No worksets with dashboard_output found. Run build_dashboard_marts.py first.");
  process.exit(1);
}

if (!existsSync(sqliteBuilderScript)) {
  console.error(`SQLite builder script not found: ${sqliteBuilderScript}`);
  process.exit(1);
}

const sqliteOk = runPythonScript(sqliteBuilderScript, [
  "--base-dir",
  baseDir,
  "--output-db",
  sqliteDbPath,
  "--worksets",
  ...readyWorksets,
]);

if (!sqliteOk) {
  console.error("Failed to build single SQLite database for worksets.");
  process.exit(1);
}

safeRemove(resolve(publicTargetDir, "flight-report-db"));
safeRemove(resolve(publicTargetDir, "itinerary-report-db"));

const defaultBundleSrc = resolve(worksetsDir, latestWorksetId, "bundle.json");
const srcGenTarget = resolve(srcTargetDir, "dashboard_bundle.json");
if (!isUpToDate(defaultBundleSrc, srcGenTarget)) {
  copyFileSync(defaultBundleSrc, srcGenTarget);
  console.log(`Default bundle -> src/generated (${latestWorksetId})`);
}

console.log("sync-data complete.");
