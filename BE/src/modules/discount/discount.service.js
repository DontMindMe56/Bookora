import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { escapeLike } from '../../utils/text.js';
import { audit } from '../../services/audit.js';
import { notFound, conflict, unprocessable } from '../../utils/errors.js';
import { getCart } from '../cart/cart.service.js';
import { vnd } from '../../utils/format.js';

const PAGE_SIZE = 20;
const normalizeCode = (c = '') => c.trim().toUpperCase();

const phaseSql = `CASE WHEN d.status = 'INACTIVE' THEN 'PAUSED'
                       WHEN d.status = 'EXPIRED' OR d.endAt <= NOW() THEN 'ENDED'
                       WHEN d.totalUsageLimit IS NOT NULL AND d.usedCount >= d.totalUsageLimit THEN 'USED_UP'
                       WHEN d.startAt > NOW() THEN 'SCHEDULED' ELSE 'RUNNING' END`;

// ---------------------------------------------------------------------------
// Tính giảm giá
// ---------------------------------------------------------------------------

/**
 * Các dòng hàng đủ điều kiện của mã: loại sách đang khuyến mãi (excludeOnSale) và giới hạn theo thể loại
 * (thể loại được chọn + thể loại con trực tiếp). `lines` = [{ editionId, quantity, unitPrice, listPrice }].
 */
async function eligibleLines(conn, code, lines) {
  let list = lines;
  if (code.excludeOnSale) list = list.filter((l) => l.unitPrice >= l.listPrice);
  if (!list.length) return [];
  const cats = (await query('SELECT categoryId FROM DiscountCodeCategory WHERE discountCodeId = ?', [code.discountCodeId], conn)).map((r) => r.categoryId);
  if (!cats.length) return list;
  const ok = await query(
    `SELECT DISTINCT e.editionId FROM Edition e JOIN WorkCategory wc ON wc.workId = e.workId
      WHERE e.editionId IN (?) AND wc.categoryId IN (SELECT categoryId FROM Category WHERE categoryId IN (?) OR parentId IN (?))`,
    [list.map((l) => l.editionId), cats, cats],
    conn,
  );
  const allowed = new Set(ok.map((r) => r.editionId));
  return list.filter((l) => allowed.has(l.editionId));
}

/** Số tiền giảm (đồng, làm tròn xuống): PERCENT có trần maxDiscount; FIXED; không vượt tiền hàng đủ điều kiện. */
export function computeDiscount(code, eligibleSubtotal) {
  let amount = code.type === 'PERCENT' ? Math.floor((eligibleSubtotal * code.value) / 100) : Math.floor(code.value);
  if (code.maxDiscount != null) amount = Math.min(amount, code.maxDiscount);
  return Math.max(0, Math.min(amount, eligibleSubtotal));
}

/**
 * Kiểm tra và tính giảm giá cho một mã. Ném 422 với `code` lỗi rõ ràng.
 * `code` là dòng DiscountCode (đã khóa FOR UPDATE nếu đang trong luồng đặt hàng).
 */
async function evaluate(conn, code, customerId, lines) {
  const now = new Date();
  if (code.status === 'INACTIVE') throw unprocessable('Mã giảm giá đã ngừng áp dụng', 'CODE_INACTIVE');
  if (code.status === 'EXPIRED' || code.endAt <= now) throw unprocessable('Mã giảm giá đã hết hạn', 'CODE_EXPIRED');
  if (code.startAt > now) throw unprocessable('Mã giảm giá chưa đến thời gian áp dụng', 'CODE_NOT_STARTED');
  if (code.totalUsageLimit != null && code.usedCount >= code.totalUsageLimit) throw unprocessable('Mã giảm giá đã hết lượt sử dụng', 'CODE_USED_UP');
  if (code.perCustomerLimit != null) {
    const [{ n }] = await query(
      'SELECT COUNT(*) AS n FROM DiscountCodeUsage WHERE discountCodeId = ? AND customerId = ? AND returnedAt IS NULL',
      [code.discountCodeId, customerId],
      conn,
    );
    if (n >= code.perCustomerLimit) throw unprocessable('Bạn đã dùng hết số lượt của mã này', 'CODE_CUSTOMER_LIMIT');
  }
  const eligible = await eligibleLines(conn, code, lines);
  const eligibleSubtotal = eligible.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  if (eligibleSubtotal <= 0) throw unprocessable('Mã không áp dụng cho các sản phẩm trong đơn hàng', 'CODE_NOT_APPLICABLE');
  if (code.minOrderValue != null && eligibleSubtotal < code.minOrderValue) {
    throw unprocessable(`Đơn hàng chưa đạt giá trị tối thiểu ${vnd(code.minOrderValue)} để dùng mã`, 'CODE_MIN_ORDER', {
      minOrderValue: code.minOrderValue,
      eligibleSubtotal,
    });
  }
  const amount = computeDiscount(code, eligibleSubtotal);
  return { discountCodeId: code.discountCodeId, code: code.code, amount, eligibleSubtotal, subtotal };
}

async function findByCode(conn, rawCode, forUpdate = false) {
  const [row] = await query(`SELECT * FROM DiscountCode WHERE code = ? ${forUpdate ? 'FOR UPDATE' : ''}`, [normalizeCode(rawCode)], conn);
  if (!row) throw unprocessable('Mã giảm giá không tồn tại', 'CODE_NOT_FOUND');
  return row;
}

// ---------------------------------------------------------------------------
// Phía khách hàng / luồng đặt hàng
// ---------------------------------------------------------------------------

/** Xem trước mức giảm theo giỏ hàng hiện tại (chưa trừ lượt). */
export async function previewForCart(customerId, rawCode) {
  const cart = await getCart({ customerId });
  const lines = cart.items
    .filter((i) => i.purchasable)
    .map((i) => ({ editionId: i.editionId, quantity: i.quantity, unitPrice: i.unitPrice, listPrice: i.listPrice }));
  if (!lines.length) throw unprocessable('Giỏ hàng không có sản phẩm có thể đặt', 'CART_EMPTY');
  const code = await findByCode(undefined, rawCode);
  const r = await evaluate(undefined, code, customerId, lines);
  return { ...r, totalAfterDiscount: r.subtotal - r.amount };
}

/** Đánh giá mã trên một tập dòng hàng cho trước (báo giá checkout) — không khóa, không trừ lượt. */
export async function evaluateCodeForLines(customerId, rawCode, lines, conn) {
  const code = await findByCode(conn, rawCode);
  return evaluate(conn, code, customerId, lines);
}

/**
 * DÙNG TRONG TRANSACTION ĐẶT HÀNG (trước khi INSERT Orders): khóa dòng mã, kiểm tra lại toàn bộ điều kiện
 * rồi tăng usedCount trong cùng transaction => nhiều khách đặt cùng lúc không vượt tổng lượt / lượt mỗi khách.
 * Trả { discountCodeId, amount }. Sau khi INSERT Orders phải gọi `recordDiscountUsage`.
 */
export async function claimDiscountCode(conn, { code: rawCode, customerId, lines }) {
  const code = await findByCode(conn, rawCode, true);
  const r = await evaluate(conn, code, customerId, lines);
  await query('UPDATE DiscountCode SET usedCount = usedCount + 1 WHERE discountCodeId = ?', [code.discountCodeId], conn);
  return { discountCodeId: code.discountCodeId, amount: r.amount };
}

/** Ghi lượt dùng gắn với đơn (mỗi đơn tối đa một mã). Gọi sau khi đã INSERT Orders, cùng transaction. */
export async function recordDiscountUsage(conn, { discountCodeId, customerId, orderId }) {
  await query(
    'INSERT INTO DiscountCodeUsage (usageId, discountCodeId, customerId, orderId) VALUES (?,?,?,?)',
    [uuid(), discountCodeId, customerId, orderId],
    conn,
  );
}

/**
 * Trả lượt mã ĐÚNG MỘT LẦN khi đơn hủy / hết hạn thanh toán / hoàn về / trả hàng.
 * Chống trùng bằng cờ Orders.discountReturnedAt (UPDATE có điều kiện => chỉ một lời gọi thắng).
 * Trả true nếu lần gọi này đã trả lượt.
 */
export async function releaseDiscountCode(conn, orderId) {
  const [res] = await conn.query(
    'UPDATE Orders SET discountReturnedAt = NOW() WHERE orderId = ? AND discountCodeId IS NOT NULL AND discountReturnedAt IS NULL',
    [orderId],
  );
  if (res.affectedRows !== 1) return false;
  const [order] = await query('SELECT discountCodeId FROM Orders WHERE orderId = ?', [orderId], conn);
  await query('UPDATE DiscountCodeUsage SET returnedAt = NOW() WHERE orderId = ? AND returnedAt IS NULL', [orderId], conn);
  await query('UPDATE DiscountCode SET usedCount = GREATEST(usedCount - 1, 0) WHERE discountCodeId = ?', [order.discountCodeId], conn);
  return true;
}

// ---------------------------------------------------------------------------
// Quản trị
// ---------------------------------------------------------------------------

export async function listCodes({ q, phase, page }) {
  const where = [],
    params = [];
  if (q) {
    where.push('d.code LIKE ?');
    params.push(`%${escapeLike(q.toUpperCase())}%`);
  }
  if (phase) {
    where.push(`${phaseSql} = ?`);
    params.push(phase);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM DiscountCode d ${w}`, params);
  const items = await query(`SELECT d.*, ${phaseSql} AS phase FROM DiscountCode d ${w} ORDER BY d.startAt DESC, d.code LIMIT ? OFFSET ?`, [
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  ]);
  return { items, page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
}

export async function getCode(discountCodeId) {
  const [d] = await query(`SELECT d.*, ${phaseSql} AS phase FROM DiscountCode d WHERE d.discountCodeId = ?`, [discountCodeId]);
  if (!d) throw notFound('Không tìm thấy mã giảm giá');
  const categories = await query(
    `SELECT c.categoryId, c.name FROM DiscountCodeCategory dc JOIN Category c ON c.categoryId = dc.categoryId WHERE dc.discountCodeId = ? ORDER BY c.name`,
    [discountCodeId],
  );
  const [{ activeUses }] = await query('SELECT COUNT(*) AS activeUses FROM DiscountCodeUsage WHERE discountCodeId = ? AND returnedAt IS NULL', [
    discountCodeId,
  ]);
  return { ...d, categories, activeUses };
}

async function checkCategories(conn, categoryIds) {
  if (!categoryIds?.length) return [];
  const uniq = [...new Set(categoryIds)];
  const rows = await query('SELECT categoryId FROM Category WHERE categoryId IN (?)', [uniq], conn);
  if (rows.length !== uniq.length) throw unprocessable('Có thể loại không tồn tại', 'UNKNOWN_CATEGORY');
  return uniq;
}

export async function createCode(actor, d) {
  return withTx(async (conn) => {
    const code = normalizeCode(d.code);
    const [dup] = await query('SELECT discountCodeId FROM DiscountCode WHERE code = ?', [code], conn);
    if (dup) throw conflict('Mã giảm giá này đã tồn tại', 'CODE_EXISTS');
    const categories = await checkCategories(conn, d.categoryIds);
    const discountCodeId = uuid();
    await query(
      `INSERT INTO DiscountCode (discountCodeId, code, type, value, minOrderValue, maxDiscount, totalUsageLimit, perCustomerLimit, excludeOnSale, startAt, endAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        discountCodeId,
        code,
        d.type,
        d.value,
        d.minOrderValue ?? null,
        d.maxDiscount ?? null,
        d.totalUsageLimit ?? null,
        d.perCustomerLimit ?? null,
        d.excludeOnSale,
        d.startAt,
        d.endAt,
      ],
      conn,
    );
    for (const c of categories) await query('INSERT INTO DiscountCodeCategory (discountCodeId, categoryId) VALUES (?,?)', [discountCodeId, c], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CREATE',
      entityType: 'DISCOUNT_CODE',
      entityId: discountCodeId,
      newValue: { ...d, code, categoryIds: categories },
    });
    return { discountCodeId, code };
  });
}

const PATCHABLE = ['value', 'type', 'minOrderValue', 'maxDiscount', 'totalUsageLimit', 'perCustomerLimit', 'excludeOnSale', 'startAt', 'endAt', 'status'];

export async function updateCode(actor, discountCodeId, patch) {
  return withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM DiscountCode WHERE discountCodeId = ? FOR UPDATE', [discountCodeId], conn);
    if (!cur) throw notFound('Không tìm thấy mã giảm giá');

    const next = { ...cur };
    for (const k of PATCHABLE) if (patch[k] !== undefined) next[k] = patch[k];
    if (!(next.startAt < next.endAt)) throw unprocessable('Thời gian bắt đầu phải trước thời gian kết thúc', 'INVALID_TIME_RANGE');
    if (next.type === 'PERCENT' && next.value > 100) throw unprocessable('Phần trăm giảm không vượt quá 100', 'INVALID_VALUE');
    if (next.totalUsageLimit != null && next.totalUsageLimit < cur.usedCount) {
      throw unprocessable(`Tổng lượt không được nhỏ hơn số lượt đã dùng (${cur.usedCount})`, 'LIMIT_BELOW_USED');
    }
    if (cur.status === 'EXPIRED') {
      // gia hạn => chạy lại
      if (next.endAt <= new Date()) throw conflict('Mã đã hết hạn. Hãy gia hạn (đặt thời gian kết thúc ở tương lai) hoặc tạo mã mới', 'CODE_ENDED');
      if (patch.status === undefined) next.status = 'ACTIVE';
    }

    const sets = [],
      params = [],
      oldValue = {},
      newValue = {};
    for (const k of PATCHABLE) {
      const a = cur[k],
        b = next[k];
      const same = a instanceof Date ? a.getTime() === new Date(b).getTime() : k === 'excludeOnSale' ? Number(a) === Number(b) : String(a) === String(b);
      if (same) continue;
      sets.push(`${k} = ?`);
      params.push(b);
      oldValue[k] = a;
      newValue[k] = b;
    }
    if (patch.categoryIds) {
      const categories = await checkCategories(conn, patch.categoryIds);
      await query('DELETE FROM DiscountCodeCategory WHERE discountCodeId = ?', [discountCodeId], conn);
      for (const c of categories) await query('INSERT INTO DiscountCodeCategory (discountCodeId, categoryId) VALUES (?,?)', [discountCodeId, c], conn);
      newValue.categoryIds = categories;
    }
    if (!sets.length && !patch.categoryIds) return { discountCodeId, changed: false };
    if (sets.length) await query(`UPDATE DiscountCode SET ${sets.join(', ')} WHERE discountCodeId = ?`, [...params, discountCodeId], conn);
    await audit(conn, { actorId: actor.accountId, action: 'UPDATE', entityType: 'DISCOUNT_CODE', entityId: discountCodeId, oldValue, newValue });
    return { discountCodeId, changed: true };
  });
}

/** Mã chưa từng có đơn dùng => xóa hẳn; ngược lại chuyển "Ngừng áp dụng" (INACTIVE) để giữ lịch sử đơn. */
export async function removeCode(actor, discountCodeId) {
  return withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM DiscountCode WHERE discountCodeId = ? FOR UPDATE', [discountCodeId], conn);
    if (!cur) throw notFound('Không tìm thấy mã giảm giá');
    const [{ used }] = await query(
      `SELECT (SELECT COUNT(*) FROM DiscountCodeUsage WHERE discountCodeId = ?) + (SELECT COUNT(*) FROM Orders WHERE discountCodeId = ?) AS used`,
      [discountCodeId, discountCodeId],
      conn,
    );
    if (used > 0) {
      if (cur.status !== 'INACTIVE') {
        await query(`UPDATE DiscountCode SET status = 'INACTIVE' WHERE discountCodeId = ?`, [discountCodeId], conn);
        await audit(conn, {
          actorId: actor.accountId,
          action: 'DEACTIVATE',
          entityType: 'DISCOUNT_CODE',
          entityId: discountCodeId,
          oldValue: { status: cur.status },
          newValue: { status: 'INACTIVE' },
        });
      }
      return { deleted: false, status: 'INACTIVE' };
    }
    await query('DELETE FROM DiscountCodeCategory WHERE discountCodeId = ?', [discountCodeId], conn);
    await query('DELETE FROM DiscountCode WHERE discountCodeId = ?', [discountCodeId], conn);
    await audit(conn, { actorId: actor.accountId, action: 'DELETE', entityType: 'DISCOUNT_CODE', entityId: discountCodeId, oldValue: cur });
    return { deleted: true };
  });
}

/** Job: mã quá hạn => "Hết hiệu lực". */
export async function expireDiscountCodes() {
  const res = await query(`UPDATE DiscountCode SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND endAt <= NOW()`);
  return { expired: res.affectedRows };
}
