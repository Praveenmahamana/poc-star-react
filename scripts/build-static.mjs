/**
 * build-static.mjs
 *
 * Produces a single self-contained HTML file (dashboard-client.html) that:
 *  - Embeds the compiled React app (JS + CSS inline)
 *  - Embeds dashboard_bundle.json and itinerary_report_summary.csv as window globals
 *  - Requires NO web server — open directly in any browser
 *
 * Usage:
 *   npm run build          ← compile the app first
 *   npm run export:static  ← generate dashboard-client.html
 *
 *  OR run the one-click bat: generate-static.bat
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// ── 1. Verify dist/ exists ────────────────────────────────────────────────────
if (!fs.existsSync(DIST) || !fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("❌  dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

// ── 2. Locate compiled assets ─────────────────────────────────────────────────
const indexHtml = fs.readFileSync(path.join(DIST, "index.html"), "utf-8");
const jsMatch  = indexHtml.match(/src="\/assets\/(index-[^"]+\.js)"/);
const cssMatch = indexHtml.match(/href="\/assets\/(index-[^"]+\.css)"/);

if (!jsMatch || !cssMatch) {
  console.error("❌  Could not locate compiled JS/CSS in dist/index.html.");
  console.error("   Run `npm run build` to rebuild.");
  process.exit(1);
}

const jsCode  = fs.readFileSync(path.join(DIST, "assets", jsMatch[1]),  "utf-8");
const cssCode = fs.readFileSync(path.join(DIST, "assets", cssMatch[1]), "utf-8");

// ── 3. Read data files ────────────────────────────────────────────────────────
const bundleFile  = path.join(ROOT, "public", "data", "dashboard_bundle.json");
const itinCsvFile = path.join(ROOT, "public", "data", "itinerary_report_summary.csv");

if (!fs.existsSync(bundleFile)) {
  console.error("❌  public/data/dashboard_bundle.json not found.");
  console.error("   Run `npm run sync-data` or `npm run build` first.");
  process.exit(1);
}

const bundleJson = fs.readFileSync(bundleFile, "utf-8");
const itinCsv    = fs.existsSync(itinCsvFile)
  ? fs.readFileSync(itinCsvFile, "utf-8")
  : "";

// ── 4. Safe embedding helpers ─────────────────────────────────────────────────
// Prevent </script> in JSON from closing the outer script tag
const safeJson = bundleJson.replace(/<\/script>/gi, "<\\/script>");
// Use JSON.stringify for CSV — handles all special characters safely
const safeCsvJs = JSON.stringify(itinCsv);

// ── 5. Build the HTML ─────────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>InsightsDB Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; background: #f1f5f9; }
    #root-fallback {
      position: fixed; inset: 0; display: flex; align-items: center;
      justify-content: center; flex-direction: column; gap: 12px;
      color: #94a3b8; font-family: sans-serif; font-size: 14px;
    }
    #root-fallback .spinner {
      width: 32px; height: 32px; border: 3px solid #1e293b;
      border-top-color: #0ea5e9; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  <!-- Compiled app CSS -->
  <style>${cssCode}</style>
  <!-- Embedded data — no server required -->
  <script>
    window.__STATIC_BUNDLE__ = ${safeJson};
    window.__STATIC_ITIN_CSV__ = ${safeCsvJs};
  </script>
  <!-- Compiled React app -->
  <script type="module">${jsCode}</script>
</head>
<body>
  <div id="root-fallback">
    <div class="spinner"></div>
    <span>Loading InsightsDB\u2026</span>
  </div>
  <div id="root"></div>
</body>
</html>`;

// ── 6. Write output ───────────────────────────────────────────────────────────
const outFile = path.join(ROOT, "dashboard-client.html");
fs.writeFileSync(outFile, html, "utf-8");

const sizeKb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`\n✅  Static export complete!`);
console.log(`   File : dashboard-client.html  (${sizeKb} KB)`);
console.log(`   Open directly in any browser — no server needed.`);
console.log(`\n   Note: Flight Schedule tab requires the server (CSV too large to embed).`);
console.log(`         Summary tab and Itinerary tab are fully embedded.\n`);
