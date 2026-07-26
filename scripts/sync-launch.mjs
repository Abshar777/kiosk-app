/**
 * Regenerates .claude/launch.json from .env.
 *
 * launch.json's `port` must be a literal — it cannot interpolate env vars — so
 * it would silently drift the moment someone changed a port in .env. Generating
 * it keeps the two in step.
 *
 *   bun scripts/sync-launch.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, resolveConfig } from "./env.mjs";

const { apiPort, webPort } = resolveConfig();

const launch = {
  version: "0.0.1",
  configurations: [
    {
      name: "api",
      runtimeExecutable: "bun",
      runtimeArgs: ["scripts/dev.mjs", "api"],
      port: apiPort,
    },
    {
      name: "web",
      runtimeExecutable: "bun",
      runtimeArgs: ["scripts/dev.mjs", "web"],
      port: webPort,
    },
  ],
};

const dir = join(ROOT, ".claude");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "launch.json"), `${JSON.stringify(launch, null, 2)}\n`);

console.log(`  .claude/launch.json updated — api:${apiPort} web:${webPort}`);
