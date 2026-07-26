/**
 * Verifies the Razorpay checkout is actually touchable while our React Aria
 * dialog is open — i.e. it is not inert and it wins hit-testing.
 */
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "./screenshots";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(BASE, { waitUntil: "networkidle" });
await wait(700);
await page.locator('[data-testid="course-card"]').first().click();
await wait(600);
await page.getByRole("button", { name: /Enroll now/i }).click();
await wait(500);
await page.getByPlaceholder(/Meera Nair/).fill("Touch Test");
await page.getByPlaceholder(/98765/).fill("9876500022");
await page.getByRole("button", { name: /^Continue$/ }).click();
await wait(1000);
await page.getByRole("button", { name: /Continue to payment/i }).click();
await wait(8000);

const diag = await page.evaluate(() => {
  const rzp = document.querySelector(".razorpay-container");
  const rect = rzp?.getBoundingClientRect();
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const hit = document.elementFromPoint(cx, cy);

  // Is the element under the pointer inside the gateway overlay?
  const insideGateway = Boolean(hit && rzp && rzp.contains(hit));

  // Walk up from the gateway looking for any inert ancestor.
  let inertAncestor = false;
  for (let el = rzp; el; el = el.parentElement) {
    if (el.inert) {
      inertAncestor = true;
      break;
    }
  }

  return {
    present: Boolean(rzp),
    inert: rzp ? rzp.inert : null,
    inertAncestor,
    topLayerTag: rzp?.getAttribute("data-react-aria-top-layer") ?? null,
    ariaHidden: rzp?.getAttribute("aria-hidden") ?? null,
    hitInsideGateway: insideGateway,
    hitElement: hit ? `${hit.tagName}.${(hit.className || "").toString().slice(0, 40)}` : null,
    hasIframe: Boolean(rzp?.querySelector("iframe")),
  };
});

await page.screenshot({ path: `${OUT}/verify-05-gateway-touch.png` });
await browser.close();

const results = [
  ["gateway overlay present", diag.present],
  ["overlay is NOT inert", diag.inert === false],
  ["no inert ancestor", !diag.inertAncestor],
  ["tagged as react-aria top layer", diag.topLayerTag === "true"],
  ["not aria-hidden", diag.ariaHidden !== "true"],
  ["gateway wins hit-testing (touchable)", diag.hitInsideGateway],
  ["checkout iframe mounted", diag.hasIframe],
];

let failed = 0;
for (const [label, ok] of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}
console.log(`\n${JSON.stringify(diag, null, 2)}`);
process.exit(failed === 0 ? 0 : 1);
