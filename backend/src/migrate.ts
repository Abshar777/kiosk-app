/**
 * Idempotent data migrations for an existing database.
 *
 * Schema changes need nothing here — every table is `CREATE TABLE IF NOT
 * EXISTS`, so a new one like `pos_sales` appears on boot. This is only for data
 * already written under older assumptions, which no DDL will fix.
 *
 *   bun run --cwd backend migrate
 */
import { db } from './db.ts';
import { getConfig, updateConfig } from './repo/settings.ts';

let changed = 0;

function step(label: string, run: () => number): void {
  const count = run();
  changed += count;
  console.log(`  ${count > 0 ? '✓' : '·'} ${label}: ${count} row(s)`);
}

console.log('\n  Running migrations\n');

// INR -> AED. Prices are not converted: the numbers are the amounts the academy
// charges, and re-denominating them would silently change what students pay.
for (const table of ['courses', 'enrollments', 'payments']) {
  step(`${table} currency INR -> AED`, () => {
    const result = db
      .query(`UPDATE ${table} SET currency = 'AED' WHERE currency = 'INR'`)
      .run();
    return result.changes;
  });
}

step('kiosk currency setting', () => {
  const { kiosk } = getConfig();
  if (kiosk.currency !== 'INR' && kiosk.currencySymbol !== '₹') return 0;
  updateConfig({ kiosk: { ...kiosk, currency: 'AED', currencySymbol: 'AED' } });
  return 1;
});

console.log(
  changed > 0
    ? `\n  Done — ${changed} row(s) updated.\n`
    : '\n  Nothing to do; the database is already up to date.\n',
);
