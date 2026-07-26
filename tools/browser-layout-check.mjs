import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const url = process.env.APP_URL || "http://127.0.0.1:4174/";
const sizes = [
  { name: "ipad-landscape", width: 1180, height: 820 },
  { name: "ipad-portrait", width: 820, height: 1180 },
  { name: "split-view", width: 600, height: 900 },
  { name: "iphone", width: 390, height: 844 },
];
await mkdir("outputs", { recursive: true });
const results = [];
try {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "今日やること", exact: true })
      .evaluate((element) => element.click());
    await page.waitForTimeout(150);
    const today = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    if (today.scrollWidth - today.clientWidth > 1) {
      throw new Error(`${size.name}: Today Plan horizontal overflow ${today.scrollWidth - today.clientWidth}px`);
    }

    await page.getByRole("button", { name: "設定", exact: true })
      .evaluate((element) => element.click());
    await page.waitForTimeout(150);
    const settings = await page.evaluate(() => {
      const advanced = document.querySelector("details.advanced-management");
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        primarySections: [...document.querySelectorAll(".settings-primary-section h3,.integrity-health-card h3")]
          .map((element) => element.textContent),
        advancedCollapsed: advanced instanceof HTMLDetailsElement && !advanced.open,
      };
    });
    if (settings.scrollWidth - settings.clientWidth > 1) {
      throw new Error(`${size.name}: Settings horizontal overflow ${settings.scrollWidth - settings.clientWidth}px`);
    }
    if (settings.primarySections.join("|") !== "学習設定|データ保護|システム状態" || !settings.advancedCollapsed) {
      throw new Error(`${size.name}: Settings first-level structure is invalid: ${JSON.stringify(settings)}`);
    }
    await page.screenshot({ path: `outputs/${size.name}-settings.png`, fullPage: true });
    results.push({ ...size, today, settings, status: "PASS" });
    await context.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
