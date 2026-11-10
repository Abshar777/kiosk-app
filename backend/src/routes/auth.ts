import {
  clearedSessionCookieHeader,
  createSessionToken,
  hasValidSession,
  isCorrectPassword,
  sessionCookieHeader,
} from '../lib/auth.ts';
import { json, readJson, unauthorized } from '../lib/http.ts';
import { route } from '../router.ts';

/** Slows down brute-forcing without needing a store or a dependency. */
const FAILURE_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

route.post('/api/admin/login', async ({ req }) => {
  const body = await readJson(req);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!password || !isCorrectPassword(password)) {
    await sleep(FAILURE_DELAY_MS);
    throw unauthorized('Incorrect password');
  }

  const token = createSessionToken();

  // Returned in the body as well as the cookie: a browser on another site
  // cannot keep the cookie, so it holds this and sends it as a bearer token
  // instead. Same-origin callers can ignore it and let the cookie work.
  return json(
    { ok: true, token },
    { headers: { 'Set-Cookie': sessionCookieHeader(req, token) } },
  );
});

route.post('/api/admin/logout', ({ req }) =>
  json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookieHeader(req) } }),
);

/** Lets the admin UI decide between rendering and redirecting to the login. */
route.get('/api/admin/session', ({ req }) => json({ isAuthenticated: hasValidSession(req) }));
