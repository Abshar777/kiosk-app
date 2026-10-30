import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Bun loads `.env` relative to the process CWD. The API is normally started
 * from `backend/`, but gateway credentials live in the repo-root `.env` so both
 * workspaces can share them — so walk up and load the first one we find.
 *
 * Existing environment variables always win; a shell export or a deployment
 * secret must never be silently overridden by a checked-out file.
 */
function loadDotEnv(): void {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth++) {
    for (const name of ['.env.local', '.env']) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;

      for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const separator = line.indexOf('=');
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

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadDotEnv();

export const env = {
  get razorpayKeyId(): string | undefined {
    return process.env.RAZORPAY_KEY_ID;
  },
  get razorpayKeySecret(): string | undefined {
    return process.env.RAZORPAY_KEY_SECRET;
  },
  get razorpayCurrency(): string {
    return process.env.RAZORPAY_CURRENCY ?? 'AED';
  },
  get isRazorpayConfigured(): boolean {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  },
  /** True for `rzp_test_*` keys — surfaced in the UI so nobody mistakes a demo for a real charge. */
  get isRazorpayTestMode(): boolean {
    return (process.env.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test');
  },
};
