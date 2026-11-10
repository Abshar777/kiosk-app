/**
 * Verifies the PWA is actually installable: the manifest is linked and valid,
 * every icon it names resolves, the service worker is served uncached, and the
 * offline fallback exists. Needs both servers running.
 */
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const results = [];
const check = (label, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

await page.goto(BASE, { waitUntil: "networkidle" });

const href = await page.getAttribute('link[rel="manifest"]', "href");
check("manifest linked from the page", href === "/manifest.webmanifest", String(href));

const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json());
check("manifest serves valid JSON", typeof manifest.name === "string", manifest.name);
check("display is standalone", manifest.display === "standalone");
check(
  "has a 512 icon",
  manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "any"),
);
// Without a maskable icon Android crops the artwork to a circle and clips it.
check("has a maskable icon", manifest.icons.some((i) => i.purpose === "maskable"));

const icons = await page.evaluate(
  async (list) => {
    const out = {};
    for (const src of list) out[src] = (await fetch(src)).status;
    return out;
  },
  manifest.icons.map((i) => i.src),
);
check(
  "every manifest icon resolves",
  Object.values(icons).every((status) => status === 200),
  JSON.stringify(icons),
);

const sw = await page.evaluate(async () => {
  const response = await fetch("/sw.js");
  return { status: response.status, cache: response.headers.get("cache-control") };
});
check("service worker is served", sw.status === 200);
// A cached worker pins the kiosk to an old build until someone clears storage.
check("service worker is never cached", /no-store|no-cache/.test(sw.cache ?? ""), sw.cache ?? "");

check("offline fallback exists", (await page.evaluate(async () => (await fetch("/offline.html")).status)) === 200);
check("apple touch icon linked", Boolean(await page.getAttribute('link[rel="apple-touch-icon"]', "href")));

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} failed` : "\nPWA assets verified.");
process.exit(failed ? 1 : 0);
