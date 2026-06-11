// quick check: does the demo stream player actually start audio on click?
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.click('button[aria-label*="Play the AgentFM stream"]');
await page.waitForTimeout(1500);
const status = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return {
    src: a?.currentSrc,
    paused: a?.paused,
    time: a?.currentTime,
    error: a?.error?.message ?? null,
  };
});
console.log(JSON.stringify(status, null, 2));
await browser.close();
process.exit(status.paused || status.error ? 1 : 0);
