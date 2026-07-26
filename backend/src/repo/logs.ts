import type { ActivityLog, LogEvent } from '@course-lms/shared';
import { db, parseJson } from '../db.ts';
import { newId, nowIso } from '../lib/ids.ts';

interface LogRow {
  id: string;
  event: string;
  entity_type: string;
  entity_id: string;
  message: string;
  metadata: string | null;
  created_at: string;
}

const mapLog = (row: LogRow): ActivityLog => ({
  id: row.id,
  event: row.event as LogEvent,
  entityType: row.entity_type as ActivityLog['entityType'],
  entityId: row.entity_id,
  message: row.message,
  metadata: parseJson<Record<string, unknown> | null>(row.metadata, null),
  createdAt: row.created_at,
});

/**
 * Append-only audit trail for enrollments and payments, per the kiosk's
 * logging requirement. Never throws — a logging failure must not roll back a
 * successful enrollment.
 */
export function log(
  event: LogEvent,
  entityType: ActivityLog['entityType'],
  entityId: string,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    db.query(
      `INSERT INTO activity_logs (id, event, entity_type, entity_id, message, metadata, created_at)
       VALUES ($id, $event, $entityType, $entityId, $message, $metadata, $createdAt)`,
    ).run({
      $id: newId(),
      $event: event,
      $entityType: entityType,
      $entityId: entityId,
      $message: message,
      $metadata: metadata ? JSON.stringify(metadata) : null,
      $createdAt: nowIso(),
    });
  } catch (error) {
    console.error('[log] failed to persist activity log', error);
  }
}

export function listLogs(options: { entityType?: string; entityId?: string; limit?: number } = {}): ActivityLog[] {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (options.entityType) {
    where.push('entity_type = $entityType');
    params.$entityType = options.entityType;
  }
  if (options.entityId) {
    where.push('entity_id = $entityId');
    params.$entityId = options.entityId;
  }
  params.$limit = Math.min(500, options.limit ?? 100);

  const rows = db
    .query(
      `SELECT * FROM activity_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT $limit`,
    )
    .all(params) as LogRow[];
  return rows.map(mapLog);
}
