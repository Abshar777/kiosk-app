import type {
  Batch,
  Category,
  Course,
  CourseQuery,
  Instructor,
  Paginated,
} from '@course-lms/shared';
import { DURATION_BUCKETS } from '@course-lms/shared';
import { db, fromBool, parseJson, toBool } from '../db.ts';
import { newId, nowIso, slugify } from '../lib/ids.ts';

interface CourseRow {
  id: string;
  slug: string;
  name: string;
  short_description: string;
  full_description: string;
  learning_outcomes: string;
  category_id: string;
  category_name: string;
  mode: string;
  level: string;
  duration_weeks: number;
  duration_label: string;
  instructor: string;
  batches: string;
  has_certificate: number;
  price: number;
  original_price: number | null;
  currency: string;
  image_url: string;
  is_active: number;
  rating: number | null;
  enrollment_count: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_INSTRUCTOR: Instructor = { name: '', title: '', bio: '', avatarUrl: null };

function mapCourse(row: CourseRow): Course {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    learningOutcomes: parseJson<string[]>(row.learning_outcomes, []),
    categoryId: row.category_id,
    categoryName: row.category_name,
    mode: row.mode as Course['mode'],
    level: row.level as Course['level'],
    durationWeeks: row.duration_weeks,
    durationLabel: row.duration_label,
    instructor: parseJson<Instructor>(row.instructor, DEFAULT_INSTRUCTOR),
    batches: parseJson<Batch[]>(row.batches, []),
    hasCertificate: toBool(row.has_certificate),
    price: row.price,
    originalPrice: row.original_price,
    currency: row.currency,
    imageUrl: row.image_url,
    isActive: toBool(row.is_active),
    enrollmentCount: row.enrollment_count,
    rating: row.rating,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COURSE = `
  SELECT c.*, cat.name AS category_name
  FROM courses c
  JOIN categories cat ON cat.id = c.category_id
`;

const ORDER_BY: Record<string, string> = {
  popular: 'c.enrollment_count DESC, c.rating DESC',
  price_asc: 'c.price ASC, c.name ASC',
  price_desc: 'c.price DESC, c.name ASC',
  name_asc: 'c.name COLLATE NOCASE ASC',
  name_desc: 'c.name COLLATE NOCASE DESC',
  newest: 'c.created_at DESC',
};

export function listCourses(query: CourseQuery): Paginated<Course> {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (!query.includeInactive) where.push('c.is_active = 1');

  if (query.q?.trim()) {
    // Match the course name, its blurb, its category and its instructor so a
    // student searching "Priya" or "Design" still lands somewhere sensible.
    params.$q = `%${query.q.trim().toLowerCase()}%`;
    where.push(`(
      LOWER(c.name) LIKE $q
      OR LOWER(c.short_description) LIKE $q
      OR LOWER(cat.name) LIKE $q
      OR LOWER(c.instructor) LIKE $q
    )`);
  }

  if (query.category) {
    params.$category = query.category;
    where.push('(c.category_id = $category OR cat.slug = $category)');
  }
  if (query.mode) {
    params.$mode = query.mode;
    where.push('c.mode = $mode');
  }
  if (query.level) {
    params.$level = query.level;
    where.push('c.level = $level');
  }
  if (query.duration) {
    const bucket = DURATION_BUCKETS.find((b) => b.id === query.duration);
    if (bucket) {
      params.$minWeeks = bucket.minWeeks;
      where.push('c.duration_weeks >= $minWeeks');
      if (bucket.maxWeeks !== null) {
        params.$maxWeeks = bucket.maxWeeks;
        where.push('c.duration_weeks <= $maxWeeks');
      }
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = ORDER_BY[query.sort ?? 'popular'] ?? ORDER_BY.popular;

  const total = (
    db
      .query(`SELECT COUNT(*) AS count FROM courses c JOIN categories cat ON cat.id = c.category_id ${whereSql}`)
      .get(params) as { count: number }
  ).count;

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));

  const rows = db
    .query(`${SELECT_COURSE} ${whereSql} ORDER BY ${orderSql} LIMIT $limit OFFSET $offset`)
    .all({ ...params, $limit: pageSize, $offset: (page - 1) * pageSize }) as CourseRow[];

  return {
    items: rows.map(mapCourse),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function getCourse(idOrSlug: string, includeInactive = false): Course | null {
  const row = db
    .query(
      `${SELECT_COURSE} WHERE (c.id = $key OR c.slug = $key) ${includeInactive ? '' : 'AND c.is_active = 1'} LIMIT 1`,
    )
    .get({ $key: idOrSlug }) as CourseRow | null;
  return row ? mapCourse(row) : null;
}

export interface CourseInput {
  name: string;
  shortDescription: string;
  fullDescription: string;
  learningOutcomes: string[];
  categoryId: string;
  mode: Course['mode'];
  level: Course['level'];
  durationWeeks: number;
  durationLabel?: string;
  instructor: Instructor;
  batches: Batch[];
  hasCertificate: boolean;
  price: number;
  originalPrice: number | null;
  currency: string;
  imageUrl: string;
  isActive: boolean;
  rating?: number | null;
  enrollmentCount?: number;
}

/** Ensures the generated slug is unique by appending -2, -3, … when needed. */
function uniqueSlug(name: string, excludeId?: string): string {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const clash = db
      .query('SELECT id FROM courses WHERE slug = $slug AND id != $id LIMIT 1')
      .get({ $slug: candidate, $id: excludeId ?? '' }) as { id: string } | null;
    if (!clash) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

export function createCourse(input: CourseInput): Course {
  const id = newId();
  const now = nowIso();
  db.query(
    `INSERT INTO courses (
      id, slug, name, short_description, full_description, learning_outcomes,
      category_id, mode, level, duration_weeks, duration_label, instructor, batches,
      has_certificate, price, original_price, currency, image_url, is_active, rating,
      enrollment_count, created_at, updated_at
    ) VALUES (
      $id, $slug, $name, $shortDescription, $fullDescription, $learningOutcomes,
      $categoryId, $mode, $level, $durationWeeks, $durationLabel, $instructor, $batches,
      $hasCertificate, $price, $originalPrice, $currency, $imageUrl, $isActive, $rating,
      $enrollmentCount, $createdAt, $updatedAt
    )`,
  ).run({
    $id: id,
    $slug: uniqueSlug(input.name),
    $name: input.name,
    $shortDescription: input.shortDescription,
    $fullDescription: input.fullDescription,
    $learningOutcomes: JSON.stringify(input.learningOutcomes),
    $categoryId: input.categoryId,
    $mode: input.mode,
    $level: input.level,
    $durationWeeks: input.durationWeeks,
    $durationLabel: input.durationLabel ?? `${input.durationWeeks} weeks`,
    $instructor: JSON.stringify(input.instructor),
    $batches: JSON.stringify(input.batches),
    $hasCertificate: fromBool(input.hasCertificate),
    $price: input.price,
    $originalPrice: input.originalPrice,
    $currency: input.currency,
    $imageUrl: input.imageUrl,
    $isActive: fromBool(input.isActive),
    $rating: input.rating ?? null,
    $enrollmentCount: input.enrollmentCount ?? 0,
    $createdAt: now,
    $updatedAt: now,
  });
  return getCourse(id, true)!;
}

const COLUMN_BY_FIELD: Record<string, string> = {
  name: 'name',
  shortDescription: 'short_description',
  fullDescription: 'full_description',
  categoryId: 'category_id',
  mode: 'mode',
  level: 'level',
  durationWeeks: 'duration_weeks',
  durationLabel: 'duration_label',
  hasCertificate: 'has_certificate',
  price: 'price',
  originalPrice: 'original_price',
  currency: 'currency',
  imageUrl: 'image_url',
  isActive: 'is_active',
  rating: 'rating',
};

const JSON_FIELDS: Record<string, string> = {
  learningOutcomes: 'learning_outcomes',
  instructor: 'instructor',
  batches: 'batches',
};

export function updateCourse(id: string, patch: Partial<CourseInput>): Course | null {
  const existing = getCourse(id, true);
  if (!existing) return null;

  const sets: string[] = [];
  const params: Record<string, unknown> = { $id: id };

  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    if (!(field in patch)) continue;
    const value = (patch as Record<string, unknown>)[field];
    sets.push(`${column} = $${field}`);
    params[`$${field}`] = typeof value === 'boolean' ? fromBool(value) : (value ?? null);
  }
  for (const [field, column] of Object.entries(JSON_FIELDS)) {
    if (!(field in patch)) continue;
    sets.push(`${column} = $${field}`);
    params[`$${field}`] = JSON.stringify((patch as Record<string, unknown>)[field]);
  }
  if (patch.name) {
    sets.push('slug = $slug');
    params.$slug = uniqueSlug(patch.name, id);
  }
  if (patch.durationWeeks !== undefined && patch.durationLabel === undefined) {
    sets.push('duration_label = $autoDurationLabel');
    params.$autoDurationLabel = `${patch.durationWeeks} weeks`;
  }

  if (sets.length === 0) return existing;

  sets.push('updated_at = $updatedAt');
  params.$updatedAt = nowIso();

  db.query(`UPDATE courses SET ${sets.join(', ')} WHERE id = $id`).run(
    params as Record<string, string | number | null>,
  );
  return getCourse(id, true);
}

/**
 * Courses with enrollment history are soft-deleted (disabled) so historical
 * records keep their foreign key. Untouched courses are removed outright.
 */
export function deleteCourse(id: string): 'deleted' | 'disabled' | 'missing' {
  const existing = getCourse(id, true);
  if (!existing) return 'missing';

  const { count } = db
    .query('SELECT COUNT(*) AS count FROM enrollments WHERE course_id = $id')
    .get({ $id: id }) as { count: number };

  if (count > 0) {
    db.query('UPDATE courses SET is_active = 0, updated_at = $now WHERE id = $id').run({
      $id: id,
      $now: nowIso(),
    });
    return 'disabled';
  }
  db.query('DELETE FROM courses WHERE id = $id').run({ $id: id });
  return 'deleted';
}

export function setCourseActive(id: string, isActive: boolean): Course | null {
  const result = db
    .query('UPDATE courses SET is_active = $isActive, updated_at = $now WHERE id = $id')
    .run({ $id: id, $isActive: fromBool(isActive), $now: nowIso() });
  return result.changes > 0 ? getCourse(id, true) : null;
}

export function incrementEnrollmentCount(courseId: string): void {
  db.query('UPDATE courses SET enrollment_count = enrollment_count + 1 WHERE id = $id').run({
    $id: courseId,
  });
}

/** Decrements a batch's available seats, never below zero. */
export function reserveBatchSeat(courseId: string, batchId: string): void {
  const course = getCourse(courseId, true);
  if (!course) return;
  const batches = course.batches.map((batch) =>
    batch.id === batchId
      ? { ...batch, seatsAvailable: Math.max(0, batch.seatsAvailable - 1) }
      : batch,
  );
  db.query('UPDATE courses SET batches = $batches WHERE id = $id').run({
    $id: courseId,
    $batches: JSON.stringify(batches),
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  is_active: number;
  course_count?: number;
}

const mapCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  isActive: toBool(row.is_active),
  courseCount: row.course_count ?? 0,
});

export function listCategories(includeInactive = false): Category[] {
  const rows = db
    .query(
      `SELECT cat.*, (
         SELECT COUNT(*) FROM courses c WHERE c.category_id = cat.id AND c.is_active = 1
       ) AS course_count
       FROM categories cat
       ${includeInactive ? '' : 'WHERE cat.is_active = 1'}
       ORDER BY cat.name COLLATE NOCASE ASC`,
    )
    .all() as CategoryRow[];
  return rows.map(mapCategory);
}

export function getCategory(idOrSlug: string): Category | null {
  const row = db
    .query('SELECT * FROM categories WHERE id = $key OR slug = $key LIMIT 1')
    .get({ $key: idOrSlug }) as CategoryRow | null;
  return row ? mapCategory(row) : null;
}

export function createCategory(name: string): Category {
  const id = newId();
  db.query(
    'INSERT INTO categories (id, name, slug, is_active, created_at) VALUES ($id, $name, $slug, 1, $now)',
  ).run({ $id: id, $name: name, $slug: slugify(name), $now: nowIso() });
  return getCategory(id)!;
}

export function updateCategory(
  id: string,
  patch: { name?: string; isActive?: boolean },
): Category | null {
  const sets: string[] = [];
  const params: Record<string, string | number> = { $id: id };
  if (patch.name !== undefined) {
    sets.push('name = $name', 'slug = $slug');
    params.$name = patch.name;
    params.$slug = slugify(patch.name);
  }
  if (patch.isActive !== undefined) {
    sets.push('is_active = $isActive');
    params.$isActive = fromBool(patch.isActive);
  }
  if (sets.length === 0) return getCategory(id);
  db.query(`UPDATE categories SET ${sets.join(', ')} WHERE id = $id`).run(params);
  return getCategory(id);
}

export function deleteCategory(id: string): 'deleted' | 'in_use' | 'missing' {
  if (!getCategory(id)) return 'missing';
  const { count } = db
    .query('SELECT COUNT(*) AS count FROM courses WHERE category_id = $id')
    .get({ $id: id }) as { count: number };
  if (count > 0) return 'in_use';
  db.query('DELETE FROM categories WHERE id = $id').run({ $id: id });
  return 'deleted';
}
