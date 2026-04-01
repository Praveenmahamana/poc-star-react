import { defineConfig } from "vite";

export default defineConfig({
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
