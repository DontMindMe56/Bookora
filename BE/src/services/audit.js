import { query } from '../db.js';
import { uuid } from '../utils/security.js';

/** Ghi lịch sử thao tác (chỉ ghi thêm). Truyền conn để cùng transaction với thay đổi chính. */
export async function audit(conn, { actorId = null, action, entityType, entityId = null, oldValue = null, newValue = null, reason = null }) {
  await query(
    `INSERT INTO AuditLog (logId, actorId, action, entityType, entityId, oldValue, newValue, reason)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      uuid(),
      actorId,
      action,
      entityType,
      entityId,
      oldValue === null ? null : JSON.stringify(oldValue),
      newValue === null ? null : JSON.stringify(newValue),
      reason,
    ],
    conn,
  );
}
