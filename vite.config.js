import { defineConfig } from "vite";

export default defineConfig({
  // Public assets are copied by scripts/copy-public-to-dist.mjs with retry logic.
  // Disable Vite's direct public copy to avoid OneDrive EBUSY on dashboard.sqlite.
  publicDir: false,
  build: {
    // Some environments lock files under dist/data (OneDrive/preview process).
    // Avoid hard-clean so builds remain reliable.
    emptyOutDir: false,
    rollupOptions: {
      onwarn(warning, defaultHandler) {
        const message = String(warning?.message || "");
        if (message.includes("Module level directives cause errors when bundled")) {
          return;
        }
        defaultHandler(warning);
      },
    },
  },
});
