import { query, withTx } from '../../db.js';
import { audit } from '../../services/audit.js';
import { invalidateParams } from '../../services/params.js';
import { notFound, unprocessable } from '../../utils/errors.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 50;
// Giới hạn [min, max] của từng tham số (GIẢ ĐỊNH của nhóm phát triển, cần chủ cửa hàng xác nhận); tham số chưa liệt kê: số nguyên dương.
const RANGES = {
  CART_MAX_QTY_PER_LINE: [1, 99],
  COD_DISABLE_RETURNED_COUNT: [1, 20],
  COD_DISABLE_WINDOW_DAYS: [1, 365],
  COD_LIMIT: [1, 50_000_000],
  CUSTOMER_SESSION_DAYS: [1, 365],
  DEFAULT_PACKAGING_WEIGHT_GRAM: [1, 5000],
  FREE_SHIPPING_THRESHOLD: [0, 10_000_000],
  GHN_SYNC_STALE_MINUTES: [1, 1440],
  GUEST_CART_TTL_DAYS: [1, 90],
  IMPORT_DRAFT_AUTO_CANCEL_DAYS: [1, 365],
  LOGIN_LOCK_MINUTES: [1, 1440],
  MAX_ADDRESSES: [1, 50],
  MAX_LOGIN_FAILS: [1, 20],
  MEMBER_CART_TTL_DAYS: [1, 365],
  PAYMENT_TIMEOUT_MINUTES: [5, 1440],
  PO_AUTO_CLOSE_DAYS: [1, 365],
  RESET_LINK_MINUTES: [5, 1440],
  RETRY_BACKOFF_MINUTES: [1, 1440], // mỗi phần tử của danh sách
  RETRY_MAX_ATTEMPTS: [1, 10],
  RETURNED_AUTO_RECEIVE_DAYS: [1, 90],
  REVIEW_REPORT_HIDE_COUNT: [1, 50],
  REVIEW_WINDOW_DAYS: [1, 365],
  SAFETY_STOCK_DEFAULT: [0, 1000],
  SALES_AVG_DAYS: [1, 365],
  SEPAY_GRACE_MINUTES: [1, 120],
  SET_PASSWORD_LINK_HOURS: [1, 168],
  STAFF_SESSION_IDLE_MINUTES: [5, 1440],
  UNVERIFIED_ACCOUNT_TTL_DAYS: [1, 90],
  VERIFY_LINK_HOURS: [1, 168],
};
const MAX_BACKOFF_STEPS = 10;

export function validateParam(key, value) {
  const v = String(value).trim();
  const isList = key === 'RETRY_BACKOFF_MINUTES';
  const parts = isList ? v.split(',').map((s) => s.trim()) : [v];
  if (!parts.every((s) => /^\d+$/.test(s) && Number(s) <= 1_000_000_000)) {
    throw unprocessable(isList ? 'Cần danh sách số phút nguyên dương, cách nhau bằng dấu phẩy' : 'Giá trị phải là số nguyên dương', 'INVALID_PARAM_VALUE');
  }
  const [min, max] = RANGES[key] ?? [1, 1_000_000_000];
  if (isList && parts.length > MAX_BACKOFF_STEPS) throw unprocessable(`Tối đa ${MAX_BACKOFF_STEPS} lần thử lại`, 'INVALID_PARAM_VALUE');
  if (!parts.every((s) => Number(s) >= min && Number(s) <= max)) {
    throw unprocessable(`Giá trị phải từ ${min} đến ${max.toLocaleString('en-US')}${isList ? ' (mỗi lần thử lại)' : ''}`, 'INVALID_PARAM_VALUE', {
      key,
      min,
      max,
    });
  }
  return parts
    .map(String)
    .map((s) => String(Number(s)))
    .join(isList ? ',' : '');
}

export const listParams = () => query('SELECT paramKey, paramValue, description, updatedAt FROM SystemParameter ORDER BY paramKey');

export async function updateParam(actor, key, value, reason) {
  const next = validateParam(key, value);
  return withTx(async (conn) => {
    const [cur] = await query('SELECT paramValue FROM SystemParameter WHERE paramKey = ? FOR UPDATE', [key], conn);
    if (!cur) throw notFound('Không tìm thấy tham số');
    await query('UPDATE SystemParameter SET paramValue = ?, updatedBy = ? WHERE paramKey = ?', [next, actor.staffId, key], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE',
      entityType: 'PARAMETER',
      newValue: { key, value: next },
      oldValue: { key, value: cur.paramValue },
      reason,
    });
    invalidateParams();
    return { paramKey: key, paramValue: next };
  });
}

export async function listAuditLogs({ actorId, entityType, entityId, action, from, to, page }) {
  const where = [],
    params = [];
  if (actorId) {
    where.push('l.actorId = ?');
    params.push(actorId);
  }
  if (entityType) {
    where.push('l.entityType = ?');
    params.push(entityType.toUpperCase());
  }
  if (entityId) {
    where.push('l.entityId = ?');
    params.push(entityId);
  }
  if (action) {
    where.push('l.action = ?');
    params.push(action.toUpperCase());
  }
  if (from) {
    where.push('l.createdAt >= ?');
    params.push(from);
  }
  if (to) {
    where.push('l.createdAt < ?');
    params.push(to);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM AuditLog l ${w}`, params);
  const items = await query(
    `SELECT l.logId, l.actorId, a.email AS actorEmail, l.action, l.entityType, l.entityId, l.oldValue, l.newValue, l.reason, l.createdAt
       FROM AuditLog l LEFT JOIN Account a ON a.accountId = l.actorId ${w} ORDER BY l.createdAt DESC, l.logId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, PAGE_SIZE)],
  );
  return paged(items, total, page, PAGE_SIZE);
}
