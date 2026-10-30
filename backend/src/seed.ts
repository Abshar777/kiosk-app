/**
 * Seeds the kiosk database with the dummy catalogue plus a few months of
 * synthetic enrollment history, so the admin dashboard and reports have
 * something meaningful to show on a fresh install.
 *
 *   bun run seed          # seed if empty
 *   bun run seed --force  # wipe and reseed
 *   bun run reset         # delete the database file entirely, then seed
 */
import { db, fromBool } from './db.ts';
import { SEED_CATEGORIES, SEED_COURSES, courseImage } from './data/courses.ts';
import { newEnrollmentCode, newGatewayRef, newId, newPaymentReference, nowIso } from './lib/ids.ts';
import { seedDefaultConfig } from './repo/settings.ts';

const force = process.argv.includes('--force');

const existing = db.query('SELECT COUNT(*) AS count FROM courses').get() as { count: number };
if (existing.count > 0 && !force) {
  console.log(`  Database already has ${existing.count} courses. Use --force to wipe and reseed.`);
  process.exit(0);
}

if (force) {
  console.log('  --force: clearing existing data…');
  // Order matters: children before parents, since foreign keys are enforced.
  db.exec('DELETE FROM activity_logs');
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM enrollments');
  db.exec('DELETE FROM courses');
  db.exec('DELETE FROM categories');
}

seedDefaultConfig();

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categoryIdBySlug = new Map<string, string>();
const insertCategory = db.query(
  'INSERT INTO categories (id, name, slug, is_active, created_at) VALUES ($id, $name, $slug, 1, $now)',
);

for (const category of SEED_CATEGORIES) {
  const id = newId();
  insertCategory.run({ $id: id, $name: category.name, $slug: category.slug, $now: nowIso() });
  categoryIdBySlug.set(category.slug, id);
}
console.log(`  Seeded ${SEED_CATEGORIES.length} categories`);

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const insertCourse = db.query(`
  INSERT INTO courses (
    id, slug, name, short_description, full_description, learning_outcomes,
    category_id, mode, level, duration_weeks, duration_label, instructor, batches,
    has_certificate, price, original_price, currency, image_url, is_active, rating,
    enrollment_count, created_at, updated_at
  ) VALUES (
    $id, $slug, $name, $shortDescription, $fullDescription, $learningOutcomes,
    $categoryId, $mode, $level, $durationWeeks, $durationLabel, $instructor, $batches,
    $hasCertificate, $price, $originalPrice, $currency, $imageUrl, $isActive, $rating,
    $enrollmentCount, $createdAt, $updatedAt
  )
`);

interface SeededCourse {
  id: string;
  name: string;
  price: number;
  batchIds: string[];
  batchLabels: string[];
}

const seededCourses: SeededCourse[] = [];
const now = nowIso();

for (const [index, course] of SEED_COURSES.entries()) {
  const categoryId = categoryIdBySlug.get(course.categorySlug);
  if (!categoryId) throw new Error(`Unknown category slug: ${course.categorySlug}`);

  const id = newId();
  const batches = course.batches.map((batch) => ({ ...batch, id: newId() }));

  // Stagger creation dates so "newest" sorting is meaningful out of the box.
  const createdAt = new Date(Date.now() - (SEED_COURSES.length - index) * 86_400_000).toISOString();

  insertCourse.run({
    $id: id,
    $slug: course.slug,
    $name: course.name,
    $shortDescription: course.shortDescription,
    $fullDescription: course.fullDescription,
    $learningOutcomes: JSON.stringify(course.learningOutcomes),
    $categoryId: categoryId,
    $mode: course.mode,
    $level: course.level,
    $durationWeeks: course.durationWeeks,
    $durationLabel: `${course.durationWeeks} week${course.durationWeeks === 1 ? '' : 's'}`,
    $instructor: JSON.stringify({ ...course.instructor, avatarUrl: null }),
    $batches: JSON.stringify(batches),
    $hasCertificate: fromBool(course.hasCertificate),
    $price: course.price,
    $originalPrice: course.originalPrice,
    $currency: 'AED',
    $imageUrl: courseImage(course.slug),
    $isActive: fromBool(true),
    $rating: course.rating,
    $enrollmentCount: course.enrollmentSeed,
    $createdAt: createdAt,
    $updatedAt: now,
  });

  seededCourses.push({
    id,
    name: course.name,
    price: course.price,
    batchIds: batches.map((b) => b.id),
    batchLabels: batches.map((b) => b.label),
  });
}
console.log(`  Seeded ${SEED_COURSES.length} courses`);

// ---------------------------------------------------------------------------
// Synthetic enrollment history
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Aarav', 'Diya', 'Ishaan', 'Ananya', 'Rohan', 'Meera', 'Kabir', 'Sara',
  'Advait', 'Nithya', 'Zaid', 'Layla', 'Omar', 'Fatima', 'Hassan', 'Noor',
  'Vivek', 'Aisha', 'Rehan', 'Tara', 'Karthik', 'Shreya', 'Imran', 'Divya',
];
const LAST_NAMES = [
  'Sharma', 'Nair', 'Khan', 'Menon', 'Patel', 'Iyer', 'Ahmed', 'Reddy',
  'Kapoor', 'Pillai', 'Hussain', 'Verma', 'Thomas', 'Joseph', 'Rahman', 'Das',
];
const METHODS = ['upi', 'upi', 'upi', 'card', 'card', 'netbanking'] as const;

/**
 * Mulberry32 — a tiny seeded PRNG. Using a fixed seed keeps the demo data
 * identical across reseeds, which makes screenshots and tests reproducible.
 */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = makeRandom(20260726);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

const insertEnrollment = db.query(`
  INSERT INTO enrollments (
    id, enrollment_id, course_id, course_name, batch_id, batch_label,
    full_name, mobile, amount, currency, status, created_at, confirmed_at
  ) VALUES (
    $id, $enrollmentId, $courseId, $courseName, $batchId, $batchLabel,
    $fullName, $mobile, $amount, $currency, $status, $createdAt, $confirmedAt
  )
`);

const insertPayment = db.query(`
  INSERT INTO payments (
    id, reference, enrollment_id, method, status, amount, currency,
    gateway_ref, instrument, failure_reason, refunded_amount,
    created_at, completed_at, refunded_at
  ) VALUES (
    $id, $reference, $enrollmentId, $method, $status, $amount, $currency,
    $gatewayRef, $instrument, $failureReason, $refundedAmount,
    $createdAt, $completedAt, $refundedAt
  )
`);

const HISTORY_DAYS = 90;
let enrollmentTotal = 0;
let paymentTotal = 0;

for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
  // Weekends are busier at a walk-in kiosk; today gets a handful either way.
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const count = Math.floor(random() * (isWeekend ? 7 : 4)) + (daysAgo === 0 ? 2 : 0);

  for (let i = 0; i < count; i++) {
    const course = pick(seededCourses);
    const batchIndex = course.batchIds.length ? Math.floor(random() * course.batchIds.length) : -1;

    const createdAt = new Date(date);
    createdAt.setHours(9 + Math.floor(random() * 11), Math.floor(random() * 60), 0, 0);
    const createdIso = createdAt.toISOString();

    // ~88% succeed, ~8% fail outright, ~4% succeed then get refunded.
    const roll = random();
    const outcome = roll < 0.88 ? 'success' : roll < 0.96 ? 'failed' : 'refunded';

    const enrollmentId = newId();
    const fullName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const mobile = `+919${Math.floor(random() * 900_000_000 + 100_000_000)}`;

    insertEnrollment.run({
      $id: enrollmentId,
      $enrollmentId: newEnrollmentCode(),
      $courseId: course.id,
      $courseName: course.name,
      $batchId: batchIndex >= 0 ? (course.batchIds[batchIndex] as string) : null,
      $batchLabel: batchIndex >= 0 ? (course.batchLabels[batchIndex] as string) : null,
      $fullName: fullName,
      $mobile: mobile,
      $amount: course.price,
      $currency: 'AED',
      $status: outcome === 'failed' ? 'failed' : outcome === 'refunded' ? 'refunded' : 'confirmed',
      $createdAt: createdIso,
      $confirmedAt: outcome === 'failed' ? null : createdIso,
    });
    enrollmentTotal++;

    const method = pick(METHODS);
    const instrument =
      method === 'upi'
        ? `${fullName.split(' ')[0]?.toLowerCase()}@okaxis`
        : method === 'card'
          ? `•••• ${Math.floor(random() * 9000 + 1000)}`
          : 'HDFC Bank';

    insertPayment.run({
      $id: newId(),
      $reference: newPaymentReference(),
      $enrollmentId: enrollmentId,
      $method: method,
      $status: outcome,
      $amount: course.price,
      $currency: 'AED',
      $gatewayRef: outcome === 'failed' ? null : newGatewayRef(),
      $instrument: instrument,
      $failureReason: outcome === 'failed' ? 'Card declined by the issuing bank' : null,
      $refundedAmount: outcome === 'refunded' ? course.price : null,
      $createdAt: createdIso,
      $completedAt: outcome === 'failed' ? null : createdIso,
      $refundedAt: outcome === 'refunded' ? new Date(createdAt.getTime() + 86_400_000).toISOString() : null,
    });
    paymentTotal++;
  }
}

console.log(`  Seeded ${enrollmentTotal} enrollments and ${paymentTotal} payments over ${HISTORY_DAYS} days`);
console.log('  Done.');
