/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  root: "ui",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/core/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "safari15",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: "happy-dom",
    coverage: {
      provider: "v8",
      // Relative to `root`; includes files no test imports, so they count as uncovered.
      include: ["**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "html", "lcov"],
      reportsDirectory: "../coverage/ui",
    },
  },
});
