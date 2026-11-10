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
/**
 * Keys whose unquoted value was cut short by a '#'. Surfaced at startup so a
 * password that silently lost half of itself is visible immediately, instead of
 * presenting as "the password is wrong".
 */
export const truncatedByComment = new Set<string>();

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
        if (!key) continue;

        const raw = line.slice(separator + 1).trim();
        const quoted =
          (raw.startsWith('"') && raw.endsWith('"') && raw.length > 1) ||
          (raw.startsWith("'") && raw.endsWith("'") && raw.length > 1);

        let value: string;
        if (quoted) {
          value = raw.slice(1, -1);
        } else {
          // An unquoted '#' opens a comment, so KEY=abc#def is the value
          // 'abc'. Every dotenv parser behaves this way, Bun's
          // included — matching it here keeps one file from meaning two
          // different things depending on which loader reached it first.
          const comment = raw.indexOf('#');
          value = (comment === -1 ? raw : raw.slice(0, comment)).trim();
          if (comment !== -1 && value !== '') truncatedByComment.add(key);
        }

        // Recorded even when the variable is already set, because Bun parses
        // .env before any of this runs: the value is long gone by now, but the
        // raw line still shows why it is shorter than it looks.
        if (key in process.env) continue;
        process.env[key] = value;
      }
    }
  }
}

// Run on import, not on call: ES imports are hoisted, so a function call placed
// at the top of index.ts would still execute AFTER every other module had been
// evaluated — and several read process.env as they load.
loadRootEnv();
