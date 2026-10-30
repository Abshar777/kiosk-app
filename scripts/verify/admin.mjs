const PW = process.env.ADMIN_PASSWORD ?? "";
import { chromium } from "playwright-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 150)); });
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + String(e).slice(0, 150)));

const results = [];
const check = (l, ok, d = "") => { results.push(ok); console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`); };

// Sign in.
await page.goto(`${BASE}/admin/settings`, { waitUntil: "domcontentloaded" });
await wait(1500);
check("unauthenticated visit redirects to login", page.url().includes("/admin/login"), page.url());

await page.locator('input[type="password"]').fill(PW);
await page.locator('button[type="submit"]').click();
await wait(2500);
check("login succeeds", !page.url().includes("/admin/login"), page.url());

const PAGES = [
  ["/admin", /Dashboard|Total/i, "dashboard"],
  ["/admin/courses", /Courses/i, "courses"],
  ["/admin/enrollments", /Enrol/i, "enrollments"],
  ["/admin/payments", /Payments/i, "payments"],
  ["/admin/reports", /Report|Revenue/i, "reports"],
  ["/admin/settings", /Card machine/i, "settings"],
];

for (const [path, expect, name] of PAGES) {
  consoleErrors.length = 0;
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await wait(2600);
  const text = await page.innerText("body").catch(() => "");
  const notFound = /404|could not be found/i.test(text);
  const crashed = /Application error|Unhandled Runtime/i.test(text);
  check(`${name} renders`, !notFound && !crashed && expect.test(text),
    notFound ? "404" : crashed ? "runtime error" : `${text.length} chars`);
  const real = consoleErrors.filter((e) => !/favicon|hmr|DevTools|Download the React/i.test(e));
  check(`${name} has no console errors`, real.length === 0, real[0] ?? "");
  await page.screenshot({ path: `./screenshots/admin-${name}.png`, fullPage: false });
}

// Data actually loaded, not just chrome.
await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
await wait(2600);
const dash = await page.innerText("body");
check("dashboard shows real numbers", /\d/.test(dash) && !/NaN|undefined/.test(dash),
  /NaN|undefined/.test(dash) ? "contains NaN/undefined" : "ok");

// Tables rendered rows.
await page.goto(`${BASE}/admin/enrollments`, { waitUntil: "domcontentloaded" });
await wait(3000);
const rows = await page.locator("tbody tr, [role='row']").count();
check("enrollments table rendered rows", rows > 1, `${rows} rows`);

// Sign out works.
const signOut = page.getByRole("button", { name: /sign out/i });
if (await signOut.count()) {
  await signOut.first().click();
  await wait(2000);
  check("sign out returns to login", page.url().includes("/admin/login"), page.url());
} else {
  check("sign out control present", false, "not found");
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} failed` : "\nAll admin UI checks passed.");
process.exit(failed ? 1 : 0);
