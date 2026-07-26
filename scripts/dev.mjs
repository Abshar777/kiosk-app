/**
 * Starts a dev server with ports resolved from .env.
 *
 *   bun scripts/dev.mjs api
 *   bun scripts/dev.mjs web
 *
 * Both Bun and Next read `PORT`, so rather than teaching each workspace about
 * API_PORT/WEB_PORT we resolve the right value here and hand each child the
 * `PORT` it already understands.
 */
import { spawn } from "node:child_process";
import { ROOT, resolveConfig } from "./env.mjs";

const target = process.argv[2];
if (target !== "api" && target !== "web") {
  console.error("Usage: bun scripts/dev.mjs <api|web>");
  process.exit(1);
}

const { apiPort, webPort, apiHost, apiUrl } = resolveConfig();

// The web server gets API_URL (runtime, used by next.config's proxy) — not
// NEXT_PUBLIC_API_URL, which would be baked into the bundle at build time.
const env =
  target === "api"
    ? { ...process.env, PORT: String(apiPort), API_PORT: String(apiPort), HOST: apiHost }
    : {
        ...process.env,
        PORT: String(webPort),
        API_PORT: String(apiPort),
        API_URL: apiUrl,
      };

const workspace = target === "api" ? "backend" : "frontend";

console.log(
  target === "api"
    ? `  api → http://localhost:${apiPort}`
    : `  web → http://localhost:${webPort}  (proxying /api → ${apiUrl})`,
);

const child = spawn("bun", ["run", "--cwd", workspace, "dev"], {
  cwd: ROOT,
  env,
  stdio: "inherit",
});

// Forward termination so Ctrl-C and the preview manager can stop the child.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
