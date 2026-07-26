/**
 * Verifies the touch ripple actually animates and the selection rings are drawn
 * inset (so a scroll container can't clip them).
 */
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "./screenshots";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 820 },
  deviceScaleFactor: 2,
});

await page.goto(BASE, { waitUntil: "networkidle" });
await wait(700);

// --- ripple on a course card ------------------------------------------------
const card = page.locator('[data-testid="course-card"]').first();
const box = await card.boundingBox();
await page.mouse.move(box.x + 60, box.y + 60);
await page.mouse.down();
await wait(140);

const cardState = await card.evaluate((el) => ({
  rippling: el.getAttribute("data-rippling"),
  x: el.style.getPropertyValue("--ripple-x"),
  y: el.style.getPropertyValue("--ripple-y"),
  size: el.style.getPropertyValue("--ripple-size"),
  overflow: getComputedStyle(el).overflow,
}));
await page.screenshot({ path: `${OUT}/verify-01-ripple-card.png` });
// Releasing completes a real click, which opens the details dialog — so carry
// straight on from there rather than clicking the card a second time.
await page.mouse.up();
await wait(900);

// --- continue into the flow and reach the gateway tiles ---------------------
await page.getByRole("button", { name: /Enroll now/i }).click();
await wait(500);
await page.getByPlaceholder(/Meera Nair/).fill("Meera Nair");
await page.getByPlaceholder(/98765/).fill("9876543210");
await page.getByRole("button", { name: /^Continue$/ }).click();
await wait(1000);

const tile = page.getByRole("button", { name: /Offline demo/i });
await tile.click();
await wait(200);

const tileState = await tile.evaluate((el) => {
  const cs = getComputedStyle(el);
  return {
    boxShadow: cs.boxShadow,
    // An inset ring keeps the painted box identical to the layout box.
    isInset: cs.boxShadow.includes("inset"),
  };
});

// Ripple on a HeroUI button
const payButton = page.getByRole("button", { name: /Continue to payment/i });
const payBox = await payButton.boundingBox();
await page.mouse.move(payBox.x + 40, payBox.y + payBox.height / 2);
await page.mouse.down();
await wait(150);
const buttonState = await payButton.evaluate((el) => ({
  rippling: el.getAttribute("data-rippling"),
  size: el.style.getPropertyValue("--ripple-size"),
  overflow: getComputedStyle(el).overflow,
}));
await page.screenshot({ path: `${OUT}/verify-02-ripple-button.png` });
await page.mouse.up();
await wait(300);
await page.screenshot({ path: `${OUT}/verify-03-gateway-rings.png` });

await browser.close();

const results = [
  ["card ripple fired", cardState.rippling === "true"],
  ["card ripple positioned", cardState.x !== "" && cardState.size !== ""],
  ["card clips ripple", cardState.overflow === "hidden"],
  ["button ripple fired", buttonState.rippling === "true"],
  ["button clips ripple", buttonState.overflow === "hidden"],
  ["selection ring is inset", tileState.isInset],
];

let failed = 0;
for (const [label, ok] of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
}
console.log(`\nring box-shadow: ${tileState.boxShadow}`);
console.log(failed === 0 ? "\nAll ripple/ring checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
