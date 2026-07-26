// Loads the repo-root .env before anything reads gateway credentials.
import { env } from './lib/env.ts';
import { handle } from './router.ts';
import { seedDefaultConfig } from './repo/settings.ts';

// Importing a route module registers its handlers on the router.
import './routes/public.ts';
import './routes/gateway.ts';
import './routes/admin.ts';
import './routes/uploads.ts';

seedDefaultConfig();

// API_PORT wins over PORT so the API and the kiosk can't collide when both are
// launched from the same shell.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? process.env.API_HOST ?? '0.0.0.0',
  // Payment and upload requests should never hang the kiosk indefinitely.
  idleTimeout: 30,
  fetch: handle,
  error(error) {
    console.error('[server] unhandled error', error);
    return new Response(
      JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  },
});

console.log(`  Course LMS API listening on http://localhost:${server.port}`);
console.log(`  Health check: http://localhost:${server.port}/api/health`);
console.log(
  `  Razorpay: ${
    env.isRazorpayConfigured
      ? `configured (${env.isRazorpayTestMode ? 'TEST mode' : 'LIVE mode'})`
      : 'not configured — set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET'
  }`,
);
