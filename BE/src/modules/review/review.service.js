import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { audit } from '../../services/audit.js';
import { getInt } from '../../services/params.js';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { escapeLike, nameLike } from '../../utils/text.js';
import { limitOffset, paged } from '../../utils/pagination.js';
import { checkReviewText, maskName } from './review.filter.js';

const PAGE_SIZE = 10;

function assertText(comment) {
  const problem = checkReviewText(comment);
  if (problem) throw unprocessable(problem, 'REVIEW_REJECTED');
}

async function findEligibleOrder(customerId, editionId, conn) {
  const [o] = await query(
    `SELECT o.orderId, o.deliveredAt FROM Orders o JOIN OrderItem oi ON oi.orderId = o.orderId
      WHERE o.customerId = ? AND oi.editionId = ? AND o.orderStatus = 'COMPLETED' AND o.deliveredAt IS NOT NULL
      ORDER BY o.deliveredAt DESC LIMIT 1`,
    [customerId, editionId],
    conn,
  );
  if (!o) throw forbidden('Chỉ đánh giá được sách bạn đã nhận', 'REVIEW_NOT_PURCHASED');
  const [{ expired }] = await query('SELECT ? < NOW() - INTERVAL ? DAY AS expired', [o.deliveredAt, await getInt('REVIEW_WINDOW_DAYS')], conn);
  if (expired) throw unprocessable('Đã quá thời hạn đánh giá', 'REVIEW_WINDOW_EXPIRED');
  return o;
}

export async function createReview(customerId, { editionId, rating, comment }) {
  assertText(comment);
  return withTx(async (conn) => {
    const o = await findEligibleOrder(customerId, editionId, conn);
    const [dup] = await query('SELECT reviewId FROM Review WHERE customerId = ? AND editionId = ? FOR UPDATE', [customerId, editionId], conn);
    if (dup) throw conflict('Bạn đã đánh giá ấn bản này', 'REVIEW_EXISTS');
    const reviewId = uuid();
    await query(
      'INSERT INTO Review (reviewId, editionId, customerId, orderId, rating, comment) VALUES (?,?,?,?,?,?)',
      [reviewId, editionId, customerId, o.orderId, rating, comment ?? null],
      conn,
    );
    return getMine(reviewId, customerId, conn);
  });
}

async function getMine(reviewId, customerId, conn) {
  const [r] = await query(
    `SELECT r.reviewId, r.editionId, r.rating, r.comment, r.status, r.createdAt, w.title
       FROM Review r JOIN Edition e ON e.editionId = r.editionId JOIN Work w ON w.workId = e.workId
      WHERE r.reviewId = ? AND r.customerId = ?`,
    [reviewId, customerId],
    conn,
  );
  if (!r) throw notFound('Không tìm thấy đánh giá');
  return r;
}

export async function updateReview(customerId, reviewId, patch) {
  await getMine(reviewId, customerId);
  if (patch.comment !== undefined) assertText(patch.comment);
  const sets = Object.keys(patch).map((k) => `${k} = ?`);
  await query(`UPDATE Review SET ${sets.join(', ')} WHERE reviewId = ?`, [...Object.values(patch), reviewId]);
  return getMine(reviewId, customerId);
}

export async function deleteReview(customerId, reviewId) {
  await getMine(reviewId, customerId);
  await withTx(async (conn) => {
    await query('DELETE FROM ReviewReport WHERE reviewId = ?', [reviewId], conn);
    await query('DELETE FROM Review WHERE reviewId = ?', [reviewId], conn);
  });
  return { reviewId, deleted: true };
}

export async function listMine(customerId) {
  const items = await query(
    `SELECT r.reviewId, r.editionId, r.rating, r.comment, r.status, r.createdAt, w.workId, w.title
       FROM Review r JOIN Edition e ON e.editionId = r.editionId JOIN Work w ON w.workId = e.workId
      WHERE r.customerId = ? ORDER BY r.createdAt DESC`,
    [customerId],
  );
  return { items, total: items.length };
}

/** Công khai: chỉ đánh giá VISIBLE; tên người đánh giá được rút gọn. Điểm trung bình luôn tính trực tiếp từ bảng Review nên sửa/xóa/ẩn có hiệu lực ngay. */
export async function listWorkReviews(workId, { rating, page }) {
  const [work] = await query('SELECT workId FROM Work WHERE workId = ?', [workId]);
  if (!work) throw notFound('Không tìm thấy sách');
  const from = `FROM Review r JOIN Edition e ON e.editionId = r.editionId JOIN Customer c ON c.customerId = r.customerId WHERE e.workId = ? AND r.status = 'VISIBLE'`;
  const dist = await query(`SELECT r.rating, COUNT(*) AS n ${from} GROUP BY r.rating`, [workId]);
  const counts = Object.fromEntries([1, 2, 3, 4, 5].map((s) => [s, dist.find((d) => d.rating === s)?.n ?? 0]));
  const count = Object.values(counts).reduce((a, b) => a + b, 0);
  const average = count ? Math.round((Object.entries(counts).reduce((a, [s, n]) => a + s * n, 0) / count) * 10) / 10 : null;

  const params = rating ? [workId, rating] : [workId];
  const rows = await query(
    `SELECT r.reviewId, r.rating, r.comment, r.createdAt, e.format, c.fullName ${from} ${rating ? 'AND r.rating = ?' : ''}
      ORDER BY r.createdAt DESC, r.reviewId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, PAGE_SIZE)],
  );
  const items = rows.map(({ fullName, ...r }) => ({ ...r, reviewer: maskName(fullName) }));
  return { average, count, counts, ...paged(items, rating ? counts[rating] : count, page, PAGE_SIZE) };
}

export async function reportReview(customerId, reviewId, reason) {
  return withTx(async (conn) => {
    const [r] = await query('SELECT reviewId, customerId, status FROM Review WHERE reviewId = ? FOR UPDATE', [reviewId], conn);
    if (!r) throw notFound('Không tìm thấy đánh giá');
    if (r.customerId === customerId) throw unprocessable('Không thể báo cáo đánh giá của chính mình', 'REVIEW_SELF_REPORT');
    const ins = await query('INSERT IGNORE INTO ReviewReport (reviewId, reporterId, reason) VALUES (?,?,?)', [reviewId, customerId, reason ?? null], conn);
    if (!ins.affectedRows) throw conflict('Bạn đã báo cáo đánh giá này', 'REVIEW_ALREADY_REPORTED');
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM ReviewReport WHERE reviewId = ?', [reviewId], conn);
    const autoHidden = r.status === 'VISIBLE' && n >= (await getInt('REVIEW_REPORT_HIDE_COUNT'));
    if (autoHidden) {
      await query(`UPDATE Review SET status = 'HIDDEN', hiddenBy = 'AUTO' WHERE reviewId = ?`, [reviewId], conn);
      await audit(conn, { action: 'HIDE', entityType: 'REVIEW', entityId: reviewId, newValue: { hiddenBy: 'AUTO', reports: n } });
    }
    return { reviewId, reported: true, autoHidden };
  });
}

export async function listAllReviews({ status, q, page }) {
  const where = [],
    params = [];
  if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (q) {
    const n = nameLike(['w.title', 'r.comment'], q);
    where.push(`(${n.sql} OR e.isbn LIKE ?)`);
    params.push(...n.params, `%${escapeLike(q)}%`);
  }
  const from = `FROM Review r JOIN Edition e ON e.editionId = r.editionId JOIN Work w ON w.workId = e.workId JOIN Customer c ON c.customerId = r.customerId
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from}`, params);
  const items = await query(
    `SELECT r.reviewId, r.rating, r.comment, r.status, r.hiddenBy, r.createdAt, e.isbn, w.title, c.fullName AS customerName,
            (SELECT COUNT(*) FROM ReviewReport rp WHERE rp.reviewId = r.reviewId) AS reportCount
       ${from} ORDER BY reportCount DESC, r.createdAt DESC, r.reviewId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, PAGE_SIZE)],
  );
  return paged(items, total, page, PAGE_SIZE);
}

export async function setVisibility(actor, reviewId, visible, reason) {
  return withTx(async (conn) => {
    const [r] = await query('SELECT status, hiddenBy FROM Review WHERE reviewId = ? FOR UPDATE', [reviewId], conn);
    if (!r) throw notFound('Không tìm thấy đánh giá');
    const status = visible ? 'VISIBLE' : 'HIDDEN';
    if (r.status === status) throw conflict(visible ? 'Đánh giá đang hiển thị' : 'Đánh giá đã bị ẩn', 'REVIEW_STATE_UNCHANGED');
    await query('UPDATE Review SET status = ?, hiddenBy = ? WHERE reviewId = ?', [status, visible ? null : 'ADMIN', reviewId], conn);
    if (visible) await query('DELETE FROM ReviewReport WHERE reviewId = ?', [reviewId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: visible ? 'SHOW' : 'HIDE',
      entityType: 'REVIEW',
      entityId: reviewId,
      oldValue: { status: r.status, hiddenBy: r.hiddenBy },
      newValue: { status, hiddenBy: visible ? null : 'ADMIN' },
      reason,
    });
    return { reviewId, status };
  });
}
