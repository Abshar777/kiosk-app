/**
 * Verifies the receipt auto-prints on the confirmation screen, exactly once,
 * and that the auto-return countdown waits for printing to finish.
 */
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "./screenshots";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

/**
 * The receipt prints from a dynamically created about:blank iframe, which
 * Playwright init scripts don't reach. So watch for the iframe being added and
 * patch print() on its window directly.
 */
await page.addInitScript(() => {
  window.__printCalls = 0;
  window.__printFrames = 0;

  const patch = (frame) => {
    try {
      const win = frame.contentWindow;
      if (!win || win.__patched) return;
      win.__patched = true;
      const original = win.print;
      win.print = function patched(...args) {
        window.__printCalls += 1;
        return original?.apply(this, args);
      };
    } catch {
      /* same-origin in practice; ignore if not */
    }
  };

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName !== "IFRAME") continue;
        window.__printFrames += 1;
        patch(node);
        node.addEventListener("load", () => patch(node));
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
});

await page.goto(BASE, { waitUntil: "networkidle" });
await wait(700);

// Drive to confirmation through the offline gateway.
await page.locator('[data-testid="course-card"]').first().click();
await wait(600);
await page.getByRole("button", { name: /Enroll now/i }).click();
await wait(500);
await page.getByPlaceholder(/Meera Nair/).fill("Auto Print");
await page.getByPlaceholder(/98765/).fill("9876500011");
await page.getByRole("button", { name: /^Continue$/ }).click();
await wait(1000);
await page.getByRole("button", { name: /Offline demo/i }).click();
await wait(250);
await page.getByRole("button", { name: /Continue to payment/i }).click();
await wait(700);
await page.getByPlaceholder(/yourname@bank|@bank/).fill("autoprint@okaxis");
await wait(200);
await page.getByRole("button", { name: /^Pay/i }).click();

// The banner can be brief, so wait for it rather than sampling at a fixed time.
const sawPrintingBanner = await page
  .getByText(/Printing your receipt/i)
  .waitFor({ state: "visible", timeout: 8000 })
  .then(() => true)
  .catch(() => false);
await page.screenshot({ path: `${OUT}/verify-04-autoprint.png` });

await wait(3000);
const { printCalls, printFrames } = await page.evaluate(() => ({
  printCalls: window.__printCalls ?? 0,
  printFrames: window.__printFrames ?? 0,
}));
const iframeCount = await page.evaluate(() => document.querySelectorAll("iframe").length);
const stillOnConfirmation = await page
  .getByText(/Enrollment successful/i)
  .isVisible()
  .catch(() => false);

await browser.close();

const results = [
  ["print() called", printCalls >= 1],
  ["print() called exactly once (no duplicate receipt)", printCalls === 1],
  ["printing indicator shown", sawPrintingBanner],
  ["still on confirmation after printing", stillOnConfirmation],
  ["print iframe cleaned up", iframeCount === 0],
];

let failed = 0;
for (const [label, ok] of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}
console.log(`\nprint() calls: ${printCalls} · leftover iframes: ${iframeCount}`);
process.exit(failed === 0 ? 0 : 1);
