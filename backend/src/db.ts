import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DATABASE_PATH ?? new URL('../data/kiosk.sqlite', import.meta.url).pathname;

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });

// WAL keeps reads fast while the kiosk writes enrollments; foreign keys are off
// by default in SQLite and must be enabled per connection.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS courses (
    id                 TEXT PRIMARY KEY,
    slug               TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    short_description  TEXT NOT NULL,
    full_description   TEXT NOT NULL,
    learning_outcomes  TEXT NOT NULL DEFAULT '[]',
    category_id        TEXT NOT NULL REFERENCES categories(id),
    mode               TEXT NOT NULL,
    level              TEXT NOT NULL,
    duration_weeks     INTEGER NOT NULL,
    duration_label     TEXT NOT NULL,
    instructor         TEXT NOT NULL DEFAULT '{}',
    batches            TEXT NOT NULL DEFAULT '[]',
    has_certificate    INTEGER NOT NULL DEFAULT 1,
    price              REAL NOT NULL,
    original_price     REAL,
    currency           TEXT NOT NULL DEFAULT 'INR',
    image_url          TEXT NOT NULL DEFAULT '',
    is_active          INTEGER NOT NULL DEFAULT 1,
    rating             REAL,
    -- Denormalized so "sort by popular" stays a single indexed scan. Seeded with
    -- historical numbers, then incremented as enrollments are confirmed.
    enrollment_count   INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enrollments (
    id             TEXT PRIMARY KEY,
    enrollment_id  TEXT NOT NULL UNIQUE,
    course_id      TEXT NOT NULL REFERENCES courses(id),
    course_name    TEXT NOT NULL,
    batch_id       TEXT,
    batch_label    TEXT,
    full_name      TEXT NOT NULL,
    mobile         TEXT NOT NULL,
    amount         REAL NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'INR',
    status         TEXT NOT NULL DEFAULT 'draft',
    created_at     TEXT NOT NULL,
    confirmed_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS payments (
    id              TEXT PRIMARY KEY,
    reference       TEXT NOT NULL UNIQUE,
    enrollment_id   TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    method          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    gateway_ref     TEXT,
    instrument      TEXT,
    failure_reason  TEXT,
    refunded_amount REAL,
    created_at      TEXT NOT NULL,
    completed_at    TEXT,
    refunded_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id          TEXT PRIMARY KEY,
    event       TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    message     TEXT NOT NULL,
    metadata    TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_courses_active   ON courses(is_active);
  CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category_id);
  CREATE INDEX IF NOT EXISTS idx_enroll_course    ON enrollments(course_id);
  CREATE INDEX IF NOT EXISTS idx_enroll_mobile    ON enrollments(mobile);
  CREATE INDEX IF NOT EXISTS idx_enroll_created   ON enrollments(created_at);
  CREATE INDEX IF NOT EXISTS idx_enroll_status    ON enrollments(status);
  CREATE INDEX IF NOT EXISTS idx_pay_enrollment   ON payments(enrollment_id);
  CREATE INDEX IF NOT EXISTS idx_pay_status       ON payments(status);
  CREATE INDEX IF NOT EXISTS idx_pay_created      ON payments(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_created     ON activity_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_entity      ON activity_logs(entity_type, entity_id);
`);

/** SQLite has no boolean type — 0/1 integers round-trip through these. */
export const toBool = (value: unknown): boolean => value === 1 || value === true;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
