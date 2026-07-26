/**
 * Captures a screenshot of every screen and state in the kiosk flow, at both
 * desktop-kiosk and phone viewports.
 *
 *   bun scripts/screenshots.mjs [outDir]
 *
 * Drives the real app against the real API, so a failure here is a real bug.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "./screenshots";

const DESKTOP = { width: 1280, height: 820 };
const PHONE = { width: 402, height: 860 };

mkdirSync(OUT, { recursive: true });

const shots = [];

async function shot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(name);
  console.log(`  ✓ ${name}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Walks the whole flow at one viewport and captures each state. */
async function run(browser, viewport, prefix, { dark = false } = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "networkidle" });
  await wait(700);
  await shot(page, `${prefix}-01-listing`);

  // --- search + filter -----------------------------------------------------
  await page.getByPlaceholder(/Search by course/i).fill("design");
  await wait(900);
  await shot(page, `${prefix}-02-search`);
  await page.getByPlaceholder(/Search by course/i).fill("");
  await wait(800);

  // --- open an open dropdown so the popover styling is captured ------------
  const categoryTrigger = page.locator(".select__trigger").first();
  await categoryTrigger.click();
  await wait(450);
  await shot(page, `${prefix}-03-select-open`);
  await page.keyboard.press("Escape");
  await wait(350);

  // --- course details ------------------------------------------------------
  const card = page
    .locator('[data-testid="course-card"]')
    .filter({ hasText: "Python Programming" })
    .first();
  await card.click();
  await wait(700);
  await shot(page, `${prefix}-04-course-details`);

  // scrolled details, so the batch panel + outcomes are visible
  await page
    .locator('[role="dialog"] [class*="body"]')
    .first()
    .evaluate((el) => {
      el.scrollTop = 500;
    })
    .catch(() => {});
  await wait(400);
  await shot(page, `${prefix}-05-details-scrolled`);

  // --- enrollment form -----------------------------------------------------
  await page.getByRole("button", { name: /Enroll now/i }).click();
  await wait(600);
  await shot(page, `${prefix}-06-enroll-empty`);

  // validation errors
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await wait(500);
  await shot(page, `${prefix}-07-enroll-validation`);

  // focused field, to verify the inset ring is not clipped
  await page.getByPlaceholder(/Meera Nair/).click();
  await page.getByPlaceholder(/Meera Nair/).fill("Meera Nair");
  await wait(300);
  await shot(page, `${prefix}-08-enroll-focus`);

  await page.getByPlaceholder(/98765/).fill("9876543210");
  await wait(300);
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await wait(900);

  // --- gateway selection ---------------------------------------------------
  await shot(page, `${prefix}-09-gateway-select`);

  // Razorpay hosts its own checkout, which we can't drive headlessly — capture
  // that it really opens, then start over and finish via the offline gateway.
  await page.getByRole("button", { name: /Continue to payment/i }).click();
  await wait(6000);
  await shot(page, `${prefix}-10-razorpay-checkout`);

  await page.goto(BASE, { waitUntil: "networkidle" });
  await wait(700);
  await page
    .locator('[data-testid="course-card"]')
    .filter({ hasText: "Python Programming" })
    .first()
    .click();
  await wait(600);
  await page.getByRole("button", { name: /Enroll now/i }).click();
  await wait(500);
  await page.getByPlaceholder(/Meera Nair/).fill("Meera Nair");
  await page.getByPlaceholder(/98765/).fill("9876543210");
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await wait(900);

  await page.getByRole("button", { name: /Offline demo/i }).click();
  await wait(300);
  await page.getByRole("button", { name: /Continue to payment/i }).click();
  await wait(700);
  await shot(page, `${prefix}-11-instrument-upi`);

  await page.getByRole("button", { name: /Credit \/ Debit card/i }).click();
  await wait(400);
  await shot(page, `${prefix}-12-instrument-card`);

  // --- failure path (industry-standard decline test number) ---------------
  await page.getByPlaceholder("4242 4242 4242 4242").fill("4000000000000002");
  await page.locator('input[autocomplete="cc-name"]').fill("Meera Nair");
  await page.locator('input[autocomplete="cc-exp"]').fill("12/29");
  await page.locator('input[autocomplete="cc-csc"]').fill("123");
  await wait(300);
  await page.getByRole("button", { name: /^Pay/i }).click();
  await wait(400);
  await shot(page, `${prefix}-13-processing`);
  await wait(2200);
  await shot(page, `${prefix}-14-payment-failed`);

  // --- retry with a good card ---------------------------------------------
  await page.getByRole("button", { name: /Retry payment/i }).click();
  await wait(600);
  await page.getByPlaceholder("4242 4242 4242 4242").fill("4242424242424242");
  await page.locator('input[autocomplete="cc-name"]').fill("Meera Nair");
  await page.locator('input[autocomplete="cc-exp"]').fill("12/29");
  await page.locator('input[autocomplete="cc-csc"]').fill("123");
  await wait(300);
  await page.getByRole("button", { name: /^Pay/i }).click();
  await wait(2600);
  await shot(page, `${prefix}-15-confirmation`);

  await context.close();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

console.log("Desktop kiosk (1280x820)");
await run(browser, DESKTOP, "desktop");

console.log("Phone (402x860) — modals render as drawers");
await run(browser, PHONE, "phone");

console.log("Desktop dark");
const darkCtx = await browser.newContext({
  viewport: DESKTOP,
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const darkPage = await darkCtx.newPage();
await darkPage.goto(BASE, { waitUntil: "networkidle" });
await darkPage.evaluate(() => {
  localStorage.setItem("kiosk.theme", "dark");
  document.documentElement.classList.add("dark");
});
await wait(800);
await shot(darkPage, "desktop-dark-01-listing");
await darkCtx.close();

console.log("Arabic RTL");
const arCtx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
const arPage = await arCtx.newPage();
await arPage.goto(BASE, { waitUntil: "networkidle" });
await arPage.evaluate(() => localStorage.setItem("kiosk.locale", "ar"));
await arPage.reload({ waitUntil: "networkidle" });
await wait(1000);
await shot(arPage, "rtl-01-listing");
const arCard = arPage.locator('[data-testid="course-card"]').first();
await arCard.click();
await wait(700);
await shot(arPage, "rtl-02-details");
await arCtx.close();

await browser.close();
console.log(`\n${shots.length} screenshots written to ${OUT}`);
