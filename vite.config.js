import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // Some environments lock files under dist/data (OneDrive/preview process).
    // Avoid hard-clean so builds remain reliable.
    emptyOutDir: false,
  },
});
