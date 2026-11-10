/**
 * Renders the Delta mark into the PNG sizes a PWA install needs.
 *
 *   bun frontend/scripts/generate-icons.mjs
 *
 * Uses headless Chrome rather than a raster library: the only source is an SVG,
 * and adding sharp or ImageMagick to a kiosk build for a handful of icons that
 * change roughly never is a poor trade.
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const outDir = join(publicDir, "icons");
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(join(publicDir, "delta-mark.svg"), "utf8").replace(
  'fill="currentColor"',
  'fill="#101418"',
);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * `scale` is the fraction of the canvas the mark occupies. Maskable icons are
 * cropped to a circle by the launcher, so their artwork has to sit inside a
 * safe zone of roughly 80% — 0.55 keeps the mark clear of the crop on every
 * shape Android applies.
 */
const TARGETS = [
  { size: 192, file: "icon-192.png", scale: 0.76, background: "#ffffff" },
  { size: 256, file: "icon-256.png", scale: 0.76, background: "#ffffff" },
  { size: 384, file: "icon-384.png", scale: 0.76, background: "#ffffff" },
  { size: 512, file: "icon-512.png", scale: 0.76, background: "#ffffff" },
  { size: 512, file: "icon-maskable-512.png", scale: 0.55, background: "#ffffff" },
  { size: 180, file: "apple-touch-icon.png", scale: 0.74, background: "#ffffff" },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const { size, file, scale, background } of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<body style="margin:0;width:${size}px;height:${size}px;background:${background};
       display:grid;place-items:center">
       <div style="width:${Math.round(size * scale)}px">${svg.replace("<svg", '<svg width="100%"')}</div>
     </body>`,
  );
  await page.screenshot({ path: join(outDir, file), omitBackground: false });
  await page.close();
  console.log(`  ${file.padEnd(26)} ${size}x${size}`);
}

await browser.close();
console.log(`\n  ${TARGETS.length} icons written to public/icons/`);
