import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import {existsSync,readFileSync} from "node:fs";

const appCommit=process.env.GITHUB_SHA||process.env.VITE_APP_COMMIT||"local-build";
type TestReport={commit:string;testCount:number;generatedAt:string;command:string};
const testReport:TestReport=(()=>{
  const fallback={commit:"unverified",testCount:0,generatedAt:"unknown",command:"npm test"};
  if(!existsSync("outputs/test-report.json"))return fallback;
  try{
    const parsed=JSON.parse(readFileSync("outputs/test-report.json","utf8")) as TestReport;
    return parsed.commit===appCommit?parsed:fallback;
  }catch{return fallback}
})();
const testReportText=[
  `Release verification (${testReport.generatedAt})`,
  `Diagnostic pack commit: ${appCommit}`,
  `Test report commit: ${testReport.commit}`,
  `Unit tests: ${testReport.testCount>0?`PASS (${testReport.testCount}/${testReport.testCount}, ${testReport.command})`:"UNVERIFIED FOR THIS COMMIT"}`,
  "Type check and production build are enforced by the GitHub Pages workflow.",
].join("\n");

export default defineConfig({
  base: "./",
  define: {
    __APP_COMMIT__: JSON.stringify(appCommit),
    __APP_DEPLOYED_AT__: JSON.stringify(process.env.VITE_DEPLOYED_AT || new Date().toISOString()),
    __APP_TEST_REPORT__: JSON.stringify(testReportText),
    __APP_TEST_REPORT_COMMIT__:JSON.stringify(testReport.commit),
    __APP_TEST_COUNT__:JSON.stringify(testReport.testCount),
    __APP_TEST_REPORT_GENERATED_AT__:JSON.stringify(testReport.generatedAt),
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
