import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repository's .env regardless of working directory.
 *
 * Bun only auto-loads .env from the process's cwd, and the backend is normally
 * started with `--cwd backend` — where the repo-root .env is invisible. That
 * silently dropped ADMIN_PASSWORD, so the API generated a throwaway password
 * and rejected the configured one.
 *
 * Resolved from this file's own location, not cwd, so it behaves the same from
 * a shell, a systemd unit or a Windows service.
 */
function loadRootEnv(): void {
  const backendRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const repoRoot = dirname(backendRoot);

  // Later files win over earlier ones, and nothing overrides the real
  // environment — an explicit var beats a file, as every other tool behaves.
  for (const file of ['.env', '.env.local']) {
    for (const base of [repoRoot, backendRoot]) {
      const path = join(base, file);
      if (!existsSync(path)) continue;

      for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const separator = line.indexOf('=');
        if (separator === -1) continue;

        const key = line.slice(0, separator).trim();
        if (!key || key in process.env) continue;

        let value = line.slice(separator + 1).trim();
        // Strip matching surrounding quotes: ADMIN_PASSWORD="secret" should not
        // make the quotes part of the password.
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
}

// Run on import, not on call: ES imports are hoisted, so a function call placed
// at the top of index.ts would still execute AFTER every other module had been
// evaluated — and several read process.env as they load.
loadRootEnv();
