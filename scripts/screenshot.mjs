import { chromium } from "playwright-core";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });

// capture console errors
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await wait(3000);
await page.screenshot({ path: "c:/tmp/agentfm-1-initial.png" });

// mid-call (first caller answers ~5-7s in, calls run ~35-50s)
await wait(14000);
await page.screenshot({ path: "c:/tmp/agentfm-2-live.png" });

// after first call ends -> transcript + report (~60-75s total)
await wait(55000);
await page.screenshot({ path: "c:/tmp/agentfm-3-feed.png" });

// mobile viewport
await page.setViewportSize({ width: 414, height: 1100 });
await wait(1500);
await page.screenshot({ path: "c:/tmp/agentfm-4-mobile.png" });

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
