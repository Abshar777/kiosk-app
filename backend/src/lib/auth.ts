import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { truncatedByComment } from './loadEnv.ts';

/**
 * Admin authentication.
 *
 * The session lives in a signed, httpOnly cookie. Nothing secret is ever sent
 * to the browser's JavaScript — the previous design put the shared token in
 * NEXT_PUBLIC_ADMIN_TOKEN, which Next.js inlines into the client bundle, so the
 * "secret" shipped in readable JS to every visitor.
 */

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // One working day.

/** Human-friendly: no look-alike characters, grouped for reading aloud. */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () =>
    Array.from(randomBytes(4))
      .map((byte) => alphabet[byte % alphabet.length])
      .join('');
  return `${pick()}-${pick()}-${pick()}`;
}

const generatedPassword = process.env.ADMIN_PASSWORD ? null : generatePassword();

/** The password in force for this run. */
const adminPassword = process.env.ADMIN_PASSWORD ?? (generatedPassword as string);

/**
 * Signing key for session cookies. Regenerated each boot unless pinned, which
 * simply means a restart logs admins out — an acceptable trade for never
 * shipping a default secret.
 */
const sessionSecret = process.env.ADMIN_SESSION_SECRET ?? randomBytes(32).toString('hex');

/**
 * A short, non-reversible fingerprint.
 *
 * Enough to tell "the password I typed" from "the password the server has"
 * without ever writing either to a log. Eight hex characters of SHA-256 cannot
 * be worked backwards, and a mismatch is all the diagnosis needs.
 */
const fingerprint = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 8);

/**
 * An unquoted '#' silently halves a value, and the result looks exactly like a
 * wrong password. Say so plainly rather than letting it be debugged twice.
 */
function warnAboutTruncation(): void {
  for (const key of truncatedByComment) {
    console.warn(
      `  ⚠ ${key} in .env is cut short by a '#': everything from the '#' onward ` +
        `is read as a comment.`,
    );
    console.warn(`    Quote it to keep the whole value:  ${key}="your#value"`);
  }
}

/** Prints the generated password once, so an operator is never locked out. */
export function announceAdminPassword(): void {
  warnAboutTruncation();

  if (!generatedPassword) {
    console.log(
      `  Admin: password set from ADMIN_PASSWORD ` +
        `(${adminPassword.length} chars, fingerprint ${fingerprint(adminPassword)})`,
    );
    if (!process.env.ADMIN_SESSION_SECRET) {
      console.log(
        '  Admin: ADMIN_SESSION_SECRET is not set — every restart will sign admins out.',
      );
    }
    return;
  }
  console.log('');
  console.log('  ⚠ No ADMIN_PASSWORD set. Generated one for this run:');
  console.log('');
  console.log(`        admin password:  ${generatedPassword}`);
  console.log('');
  console.log('    Set ADMIN_PASSWORD in .env to make it permanent.');
  console.log('');
}

/** Constant-time compare, so a wrong guess leaks nothing through timing. */
function matches(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself be a leak.
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function isCorrectPassword(candidate: string): boolean {
  const ok = matches(candidate, adminPassword);
  if (!ok) explainMismatch(candidate);
  return ok;
}

/**
 * Says why a password was refused, without revealing either side.
 *
 * The common causes are mundane and invisible from the browser: a stale
 * generated password after a restart, or a quoted or space-padded value in
 * .env. Naming them beats guessing.
 */
function explainMismatch(candidate: string): void {
  const source = generatedPassword ? 'generated for this run' : 'ADMIN_PASSWORD';
  console.warn(
    `  Admin login refused. Expected: ${source}, ${adminPassword.length} chars, ` +
      `fingerprint ${fingerprint(adminPassword)}. ` +
      `Received: ${candidate.length} chars, fingerprint ${fingerprint(candidate)}.`,
  );

  if (candidate.trim() !== candidate) {
    console.warn('    The submitted password has leading or trailing whitespace.');
  }
  if (candidate.length === adminPassword.length) {
    console.warn('    Same length — likely a different value, not a formatting slip.');
  }
  if (fingerprint(candidate.trim()) === fingerprint(adminPassword)) {
    console.warn('    It matches once trimmed: strip the surrounding whitespace.');
  }
  if (generatedPassword) {
    console.warn(
      '    No ADMIN_PASSWORD is configured, so this password changes on every restart.',
    );
  }
  if (truncatedByComment.has('ADMIN_PASSWORD')) {
    console.warn(
      "    ADMIN_PASSWORD in .env is cut short by an unquoted '#'. Quote it: " +
        'ADMIN_PASSWORD="your#value"',
    );
  } else if (candidate.startsWith(adminPassword) && candidate.length > adminPassword.length) {
    // The submitted value begins with the configured one — the classic shape of
    // a .env value that lost its tail to a comment or a stray space.
    console.warn(
      '    What you typed starts with the configured password and is longer: the ' +
        'value in .env is probably truncated.',
    );
  }
}

const sign = (payload: string): string =>
  createHmac('sha256', sessionSecret).update(payload).digest('base64url');

export function createSessionToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function isValidSessionToken(token: string): boolean {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  if (!matches(signature, sign(payload))) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp: number };
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function hasValidSession(req: Request): boolean {
  const token = readCookie(req, SESSION_COOKIE);
  return token !== null && isValidSessionToken(token);
}

/**
 * `Secure` has to be conditional, not constant.
 *
 * On the kiosk the admin panel is served over plain HTTP on localhost, where a
 * Secure cookie is simply never stored — sign-in would appear to succeed and
 * then every request would 401. Over HTTPS, omitting it would be the real
 * mistake. So we decide per request, from how the request actually arrived.
 */
function isSecureRequest(req: Request): boolean {
  // Behind the Next.js proxy or any reverse proxy, the original scheme only
  // survives in X-Forwarded-Proto.
  const forwarded = req.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https';
  return new URL(req.url).protocol === 'https:';
}

function cookieParts(req: Request, value: string, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookieHeader(req: Request, token: string): string {
  return cookieParts(req, token, Math.floor(SESSION_TTL_MS / 1000));
}

export function clearedSessionCookieHeader(req: Request): string {
  return cookieParts(req, '', 0);
}
