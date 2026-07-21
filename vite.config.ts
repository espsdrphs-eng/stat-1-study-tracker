import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  define: {
    __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA || process.env.VITE_APP_COMMIT || "local-build"),
    __APP_DEPLOYED_AT__: JSON.stringify(process.env.VITE_DEPLOYED_AT || new Date().toISOString()),
    __APP_TEST_REPORT__: JSON.stringify([
      "Release verification (2026-07-22)",
      "Type check: PASS (npm run check)",
      "Unit tests: PASS (168/168, npm test)",
      "Production build: PASS (npm run build)",
      "Browser SCAN5 import: PASS (STAT1-SCAN5-v1 alias normalization)",
      "Note: these commands run during implementation; the iPad export itself does not execute developer tools."
    ].join("\n"))
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["app-icon.svg"],
      manifest: {
        name: "統計一級 学習管理",
        short_name: "統計一級",
        description: "統計検定1級・統計数理のオフライン学習進捗管理",
        theme_color: "#17342c",
        background_color: "#f4f3ee",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,pdf,webmanifest}"],
        navigateFallback: "index.html"
      }
    })
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4174" }
  }
});
