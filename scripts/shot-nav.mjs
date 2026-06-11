// quick nav verification: sidebar + section pages + mobile chip bar
import { chromium } from "playwright-core";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: "c:/tmp/nav-1-live.png" });
await page.click("text=SHOWS");
await page.waitForTimeout(600);
await page.screenshot({ path: "c:/tmp/nav-2-shows.png" });
await page.click("text=ADVERTISE");
await page.waitForTimeout(600);
await page.screenshot({ path: "c:/tmp/nav-3-advertise.png" });
await page.click("text=CALL IN");
await page.waitForTimeout(600);
await page.screenshot({ path: "c:/tmp/nav-4-callin.png" });
await page.setViewportSize({ width: 414, height: 900 });
await page.click("text=ON AIR >> nth=0").catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: "c:/tmp/nav-5-mobile.png" });
console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
