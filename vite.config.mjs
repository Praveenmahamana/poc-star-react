import { defineConfig } from "vite";

export default defineConfig({
  // We copy public assets ourselves with retry logic in scripts/copy-public-to-dist.mjs
  // to avoid intermittent Windows/OneDrive EBUSY locks on dashboard.sqlite.
  publicDir: false,
});

