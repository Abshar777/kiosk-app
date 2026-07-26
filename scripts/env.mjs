/**
 * Single source of truth for ports and derived URLs.
 *
 * Everything that needs a port — the API, the kiosk, and the generated
 * .claude/launch.json — reads it from here, so changing a port means editing
 * one line in .env rather than hunting through three files.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Loads .env / .env.local without overriding anything already in the shell. */
export function loadEnv() {
  for (const name of [".env", ".env.local"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;

    for (const rawLine of readFileSync(path, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const separator = line.indexOf("=");
      if (separator === -1) continue;

      const key = line.slice(0, separator).trim();
      if (!key || key in process.env) continue;

      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

export function resolveConfig() {
  loadEnv();

  // Deliberately NOT falling back to `PORT` here. A launcher (the preview
  // manager, a PaaS) sets `PORT` for the process it is starting, so honouring it
  // made the web server resolve the API's port to its own — the kiosk then
  // called itself and every request 404'd. In a two-server repo the port must
  // be named unambiguously.
  const apiPort = Number(process.env.API_PORT ?? 4000);
  const webPort = Number(process.env.WEB_PORT ?? 3000);
  const apiHost = process.env.API_HOST ?? "0.0.0.0";

  // Browsers can't call 0.0.0.0 — advertise a reachable host instead.
  const publicHost = apiHost === "0.0.0.0" ? "localhost" : apiHost;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://${publicHost}:${apiPort}`;

  return { apiPort, webPort, apiHost, apiUrl };
}
