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
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("Not found");
}

function sendServerError(res, error) {
  res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`Server error: ${error?.message || "unknown"}`);
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
