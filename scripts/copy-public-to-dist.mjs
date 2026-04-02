import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const appRoot = resolve(process.cwd());
const publicDir = join(appRoot, "public");
const distDir = join(appRoot, "dist");

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function copyFileWithRetry(src, dst, retries = 25, delayMs = 250) {
  let attempt = 0;
  for (;;) {
    try {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      return;
    } catch (error) {
      const code = error?.code || "";
      const retryable = code === "EBUSY" || code === "EPERM" || code === "EACCES";
      if (!retryable || attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await sleep(delayMs);
    }
  }
}

async function copyDirRecursive(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name);
    const dstPath = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      await copyFileWithRetry(srcPath, dstPath);
    }
  }
}

async function main() {
  if (!existsSync(publicDir)) {
    console.log("No public directory found; skipping public->dist copy.");
    return;
  }
  if (!existsSync(distDir)) {
    throw new Error("dist directory not found. Run vite build first.");
  }

  await copyDirRecursive(publicDir, distDir);
  const dbPath = join(publicDir, "data", "worksets", "dashboard.sqlite");
  if (existsSync(dbPath)) {
    const bytes = statSync(dbPath).size;
    console.log(`Public assets copied to dist (dashboard.sqlite: ${bytes} bytes).`);
  } else {
    console.log("Public assets copied to dist.");
  }
}

main().catch((error) => {
  console.error(`Failed to copy public assets: ${error?.message || error}`);
  process.exit(1);
});

