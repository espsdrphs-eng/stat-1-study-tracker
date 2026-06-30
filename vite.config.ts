import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
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
