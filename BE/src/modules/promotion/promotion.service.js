import { pool, query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { escapeLike } from '../../utils/text.js';
import { audit } from '../../services/audit.js';
import { notFound, conflict, unprocessable } from '../../utils/errors.js';

const PAGE_SIZE = 20;
const MAX_REPORTED = 20; // số ấn bản vi phạm tối đa trả về trong thông báo lỗi

/** Giá sau khuyến mãi (đồng, số nguyên). PERCENT làm tròn tới đồng gần nhất. */
export function promoPrice(listPrice, discountType, discountValue) {
  const off = discountType === 'PERCENT' ? Math.round((listPrice * discountValue) / 100) : Math.round(discountValue);
  return listPrice - off;
}
/** Cùng công thức, viết bằng SQL để kiểm tra hàng loạt. */
const priceSql = (type) => (type === 'PERCENT' ? 'e.listPrice - ROUND(e.listPrice * ? / 100)' : 'e.listPrice - ?');

/**
 * Điều kiện chọn ấn bản theo phạm vi. `tgt` = { sql, params }: tập targetId (danh sách trực tiếp hoặc truy vấn PromotionTarget).
 * Thể loại: tính thể loại được chọn và các thể loại con trực tiếp (cùng quy tắc với bộ lọc sách).
 */
function scopeCondition(scopeType, tgt) {
  switch (scopeType) {
    case 'EDITION':
    case 'ISBN_LIST':
      return { sql: `e.editionId IN ${tgt.sql}`, params: [...tgt.params] };
    case 'PUBLISHER':
      return { sql: `e.publisherId IN ${tgt.sql}`, params: [...tgt.params] };
    case 'CATEGORY':
      return {
        sql: `EXISTS (SELECT 1 FROM WorkCategory wc WHERE wc.workId = e.workId AND wc.categoryId IN
                (SELECT categoryId FROM Category WHERE categoryId IN ${tgt.sql} OR parentId IN ${tgt.sql}))`,
        params: [...tgt.params, ...tgt.params],
      };
    default:
      throw new Error(`scopeType không hợp lệ: ${scopeType}`);
  }
}

/** Tên đối tượng cho thông báo/chi tiết. */
const phaseSql = `CASE WHEN p.status = 'INACTIVE' THEN 'PAUSED'
                       WHEN p.status = 'EXPIRED' OR p.endAt <= NOW() THEN 'ENDED'
                       WHEN p.startAt > NOW() THEN 'SCHEDULED' ELSE 'RUNNING' END`;

// ---------------------------------------------------------------------------
// Kiểm tra dữ liệu chiến dịch
// ---------------------------------------------------------------------------

/** Chuyển danh sách đầu vào (ISBN hoặc id) thành id đối tượng, báo lỗi nếu có mục không tồn tại. */
async function resolveTargets(conn, scopeType, targets) {
  const uniq = [...new Set(targets)];
  if (scopeType === 'ISBN_LIST') {
    const rows = await query('SELECT isbn, editionId FROM Edition WHERE isbn IN (?)', [uniq], conn);
    const found = new Map(rows.map((r) => [r.isbn, r.editionId]));
    const unknown = uniq.filter((i) => !found.has(i));
    if (unknown.length) throw unprocessable('Có ISBN không tồn tại trong danh mục', 'UNKNOWN_ISBN', { isbns: unknown.slice(0, 100) });
    return uniq.map((i) => found.get(i));
  }
  const table = { EDITION: ['Edition', 'editionId'], CATEGORY: ['Category', 'categoryId'], PUBLISHER: ['Publisher', 'publisherId'] }[scopeType];
  const rows = await query(`SELECT ${table[1]} AS id FROM ${table[0]} WHERE ${table[1]} IN (?)`, [uniq], conn);
  const ok = new Set(rows.map((r) => r.id));
  const unknown = uniq.filter((i) => !ok.has(i));
  if (unknown.length) throw unprocessable('Có đối tượng áp dụng không tồn tại', 'UNKNOWN_TARGET', { ids: unknown.slice(0, 100) });
  return uniq;
}

/**
 * Kiểm tra giá khuyến mãi trên toàn bộ ấn bản thuộc phạm vi:
 *  - giá sau KM phải >= 1 đồng
 *  - giá thấp hơn giá vốn bình quân => chặn, trừ khi admin xác nhận bán lỗ kèm lý do.
 */
async function checkPricing(conn, { scopeType, targetIds, discountType, discountValue, allowBelowCost }) {
  const tgt = { sql: '(?)', params: [targetIds] };
  const sc = scopeCondition(scopeType, tgt);
  const base = `FROM Edition e JOIN Work w ON w.workId = e.workId WHERE ${sc.sql}`;
  const calc = priceSql(discountType);

  const bad = await query(
    `SELECT e.isbn, w.title, e.listPrice, ${calc} AS promoPrice ${base} AND ${calc} < 1 LIMIT ${MAX_REPORTED}`,
    [discountValue, ...sc.params, discountValue],
    conn,
  );
  if (bad.length) throw unprocessable('Mức giảm làm giá bán nhỏ hơn 1 đồng với một số ấn bản', 'PROMO_INVALID_PRICE', { editions: bad });

  const [{ n }] = await query(`SELECT COUNT(*) AS n ${base}`, sc.params, conn);
  let belowCost = [];
  if (!allowBelowCost) {
    belowCost = await query(
      `SELECT e.isbn, w.title, e.listPrice, e.costPrice, ${calc} AS promoPrice ${base} AND e.costPrice > 0 AND ${calc} < e.costPrice
        ORDER BY e.isbn LIMIT ${MAX_REPORTED}`,
      [discountValue, ...sc.params, discountValue],
      conn,
    );
    if (belowCost.length) {
      throw unprocessable('Giá khuyến mãi thấp hơn giá vốn bình quân. Cần quản trị viên xác nhận bán lỗ kèm lý do.', 'PROMO_BELOW_COST', {
        editions: belowCost,
      });
    }
  }
  return { matchedEditions: n };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listPromotions({ q, phase, page }) {
  const where = [],
    params = [];
  if (q) {
    where.push('p.name LIKE ?');
    params.push(`%${escapeLike(q)}%`);
  }
  if (phase) {
    where.push(`${phaseSql} = ?`);
    params.push(phase);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM Promotion p ${w}`, params);
  const items = await query(
    `SELECT p.promotionId, p.name, p.scopeType, p.discountType, p.discountValue, p.startAt, p.endAt, p.status,
            ${phaseSql} AS phase, p.allowBelowCost,
            (SELECT COUNT(*) FROM PromotionTarget t WHERE t.promotionId = p.promotionId) AS targetCount,
            (SELECT COUNT(*) FROM Edition e WHERE e.salePromotionId = p.promotionId) AS appliedEditions
       FROM Promotion p ${w} ORDER BY p.startAt DESC, p.promotionId LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { items, page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
}

async function loadTargets(conn, promo) {
  const ids = (await query('SELECT targetId FROM PromotionTarget WHERE promotionId = ?', [promo.promotionId], conn)).map((r) => r.targetId);
  if (!ids.length) return [];
  switch (promo.scopeType) {
    case 'CATEGORY':
      return query('SELECT categoryId AS id, name FROM Category WHERE categoryId IN (?) ORDER BY name', [ids], conn);
    case 'PUBLISHER':
      return query('SELECT publisherId AS id, name FROM Publisher WHERE publisherId IN (?) ORDER BY name', [ids], conn);
    default:
      return query(
        `SELECT e.editionId AS id, e.isbn, w.title AS name FROM Edition e JOIN Work w ON w.workId = e.workId WHERE e.editionId IN (?) ORDER BY w.title`,
        [ids],
        conn,
      );
  }
}

export async function getPromotion(promotionId) {
  const [p] = await query(`SELECT p.*, ${phaseSql} AS phase FROM Promotion p WHERE p.promotionId = ?`, [promotionId]);
  if (!p) throw notFound('Không tìm thấy chiến dịch khuyến mãi');
  const targets = await loadTargets(pool, p);
  const [{ appliedEditions }] = await query('SELECT COUNT(*) AS appliedEditions FROM Edition WHERE salePromotionId = ?', [promotionId]);
  return { ...p, targets, appliedEditions };
}

export async function createPromotion(actor, d) {
  const out = await withTx(async (conn) => {
    const targetIds = await resolveTargets(conn, d.scopeType, d.targets);
    const { matchedEditions } = await checkPricing(conn, { ...d, targetIds });
    const promotionId = uuid();
    await query(
      `INSERT INTO Promotion (promotionId, name, scopeType, discountType, discountValue, startAt, endAt, status, allowBelowCost, belowCostReason, createdBy)
       VALUES (?,?,?,?,?,?,?, 'ACTIVE', ?,?,?)`,
      [
        promotionId,
        d.name,
        d.scopeType,
        d.discountType,
        d.discountValue,
        d.startAt,
        d.endAt,
        d.allowBelowCost,
        d.allowBelowCost ? d.belowCostReason : null,
        actor.staffId,
      ],
      conn,
    );
    for (const t of targetIds) await query('INSERT INTO PromotionTarget (promotionId, targetId) VALUES (?,?)', [promotionId, t], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CREATE',
      entityType: 'PROMOTION',
      entityId: promotionId,
      newValue: { ...d, targets: targetIds },
      reason: d.allowBelowCost ? d.belowCostReason : null,
    });
    return { promotionId, matchedEditions };
  });
  await applyPromotions().catch((e) => console.error('[promotion] apply:', e.message)); // áp ngay nếu đã đến giờ
  return out;
}

export async function updatePromotion(actor, promotionId, patch) {
  const out = await withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM Promotion WHERE promotionId = ? FOR UPDATE', [promotionId], conn);
    if (!cur) throw notFound('Không tìm thấy chiến dịch khuyến mãi');

    const next = { ...cur };
    for (const k of ['name', 'scopeType', 'discountType', 'discountValue', 'startAt', 'endAt', 'status', 'allowBelowCost']) {
      if (patch[k] !== undefined) next[k] = patch[k];
    }
    if (patch.allowBelowCost !== undefined || patch.belowCostReason !== undefined) {
      next.belowCostReason = next.allowBelowCost ? (patch.belowCostReason ?? cur.belowCostReason) : null;
    }
    if (next.allowBelowCost && !next.belowCostReason) throw unprocessable('Bán lỗ phải kèm lý do', 'BELOW_COST_REASON_REQUIRED');
    if (!(next.startAt < next.endAt)) throw unprocessable('Thời gian bắt đầu phải trước thời gian kết thúc', 'INVALID_TIME_RANGE');

    // Chiến dịch đã hết hạn: chỉ sửa được khi gia hạn (endAt ở tương lai) => chạy lại
    if (cur.status === 'EXPIRED') {
      if (next.endAt <= new Date())
        throw conflict('Chiến dịch đã kết thúc. Hãy gia hạn (đặt thời gian kết thúc ở tương lai) hoặc tạo chiến dịch mới', 'PROMOTION_ENDED');
      if (patch.status === undefined) next.status = 'ACTIVE';
    }
    if (patch.scopeType !== undefined && patch.scopeType !== cur.scopeType && !patch.targets) {
      throw unprocessable('Đổi phạm vi phải gửi kèm danh sách đối tượng áp dụng', 'TARGETS_REQUIRED');
    }

    let targetIds = null;
    if (patch.targets) targetIds = await resolveTargets(conn, next.scopeType, patch.targets);
    else targetIds = (await query('SELECT targetId FROM PromotionTarget WHERE promotionId = ?', [promotionId], conn)).map((r) => r.targetId);

    // Kiểm tra lại giá khi đổi mức giảm / phạm vi / bỏ xác nhận bán lỗ
    const pricingChanged = patch.targets || ['scopeType', 'discountType', 'discountValue', 'allowBelowCost'].some((k) => patch[k] !== undefined);
    if (pricingChanged)
      await checkPricing(conn, {
        scopeType: next.scopeType,
        targetIds,
        discountType: next.discountType,
        discountValue: next.discountValue,
        allowBelowCost: next.allowBelowCost,
      });

    const sets = [],
      params = [],
      oldValue = {},
      newValue = {};
    for (const k of ['name', 'scopeType', 'discountType', 'discountValue', 'startAt', 'endAt', 'status', 'allowBelowCost', 'belowCostReason']) {
      const a = cur[k],
        b = next[k];
      const same = a instanceof Date ? a.getTime() === new Date(b).getTime() : k === 'allowBelowCost' ? Number(a) === Number(b) : String(a) === String(b);
      if (same) continue;
      sets.push(`${k} = ?`);
      params.push(b);
      oldValue[k] = a;
      newValue[k] = b;
    }
    if (patch.targets) {
      await query('DELETE FROM PromotionTarget WHERE promotionId = ?', [promotionId], conn);
      for (const t of targetIds) await query('INSERT INTO PromotionTarget (promotionId, targetId) VALUES (?,?)', [promotionId, t], conn);
      newValue.targets = targetIds;
    }
    if (!sets.length && !patch.targets) return { promotionId, changed: false };
    if (sets.length) await query(`UPDATE Promotion SET ${sets.join(', ')} WHERE promotionId = ?`, [...params, promotionId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE',
      entityType: 'PROMOTION',
      entityId: promotionId,
      oldValue,
      newValue,
      reason: next.allowBelowCost ? next.belowCostReason : null,
    });
    return { promotionId, changed: true };
  });
  if (out.changed) await applyPromotions().catch((e) => console.error('[promotion] apply:', e.message));
  return out;
}

/** Chiến dịch chưa bắt đầu => xóa hẳn. Đã bắt đầu => chỉ dừng (INACTIVE) để giữ lịch sử. */
export async function removePromotion(actor, promotionId) {
  const out = await withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM Promotion WHERE promotionId = ? FOR UPDATE', [promotionId], conn);
    if (!cur) throw notFound('Không tìm thấy chiến dịch khuyến mãi');
    const [{ applied }] = await query('SELECT COUNT(*) AS applied FROM Edition WHERE salePromotionId = ?', [promotionId], conn);
    if (cur.startAt > new Date() && applied === 0) {
      await query('DELETE FROM PromotionTarget WHERE promotionId = ?', [promotionId], conn);
      await query('DELETE FROM Promotion WHERE promotionId = ?', [promotionId], conn);
      await audit(conn, { actorId: actor.accountId, action: 'DELETE', entityType: 'PROMOTION', entityId: promotionId, oldValue: cur });
      return { deleted: true };
    }
    if (cur.status !== 'INACTIVE') {
      await query(`UPDATE Promotion SET status = 'INACTIVE' WHERE promotionId = ?`, [promotionId], conn);
      await audit(conn, {
        actorId: actor.accountId,
        action: 'DEACTIVATE',
        entityType: 'PROMOTION',
        entityId: promotionId,
        oldValue: { status: cur.status },
        newValue: { status: 'INACTIVE' },
      });
    }
    return { deleted: false, status: 'INACTIVE' };
  });
  await applyPromotions().catch((e) => console.error('[promotion] apply:', e.message)); // gỡ giá KM ngay
  return out;
}

// ---------------------------------------------------------------------------
// Job: áp dụng / gỡ giá khuyến mãi
// ---------------------------------------------------------------------------

/** Khóa toàn cục (theo tên) trên một kết nối riêng: nhiều instance cùng chạy job không giẫm lên nhau. */
async function withNamedLock(name, fn) {
  const conn = await pool.getConnection();
  try {
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [name]);
    if (got !== 1) return null;
    try {
      return await fn(conn);
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/**
 * Đồng bộ Edition.salePrice với các chiến dịch đang chạy:
 *  1. chiến dịch quá hạn => EXPIRED;
 *  2. mỗi ấn bản lấy giá THẤP NHẤT trong các chiến dịch đang chạy;
 *  3. ấn bản có giá KM nhập tay (salePromotionId NULL) chỉ bị thay khi giá chiến dịch thấp hơn;
 *  4. ấn bản hết chiến dịch => gỡ giá KM;
 *  5. không tự bán lỗ: chiến dịch chưa xác nhận bán lỗ bị bỏ qua với ấn bản mà giá vốn (đã đổi do nhập hàng) cao hơn giá KM.
 */
export async function applyPromotions() {
  return withNamedLock('bookstore:promotion_apply', async (conn) => {
    await conn.beginTransaction();
    try {
      const expired = (await conn.query(`UPDATE Promotion SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND endAt <= NOW()`))[0].affectedRows;

      const running = await query(`SELECT * FROM Promotion WHERE status = 'ACTIVE' AND startAt <= NOW() AND endAt > NOW()`, [], conn);
      const best = new Map(); // editionId => { price, promotionId }
      let skippedBelowCost = 0;
      for (const p of running) {
        const sc = scopeCondition(p.scopeType, { sql: '(SELECT targetId FROM PromotionTarget WHERE promotionId = ?)', params: [p.promotionId] });
        const rows = await query(`SELECT e.editionId, e.listPrice, e.costPrice FROM Edition e WHERE ${sc.sql}`, sc.params, conn);
        for (const e of rows) {
          const price = promoPrice(e.listPrice, p.discountType, p.discountValue);
          if (price < 1 || price >= e.listPrice) continue;
          if (!p.allowBelowCost && e.costPrice > 0 && price < e.costPrice) {
            skippedBelowCost++;
            continue;
          }
          const b = best.get(e.editionId);
          if (!b || price < b.price || (price === b.price && p.promotionId < b.promotionId)) best.set(e.editionId, { price, promotionId: p.promotionId });
        }
      }

      const managed = await query('SELECT editionId, salePrice, salePromotionId FROM Edition WHERE salePromotionId IS NOT NULL', [], conn);
      const managedMap = new Map(managed.map((r) => [r.editionId, r]));
      let applied = 0,
        cleared = 0;

      if (best.size) {
        const cur = new Map();
        const ids = [...best.keys()];
        for (let i = 0; i < ids.length; i += 1000) {
          const rows = await query(
            'SELECT editionId, salePrice, salePromotionId FROM Edition WHERE editionId IN (?) FOR UPDATE',
            [ids.slice(i, i + 1000)],
            conn,
          );
          rows.forEach((r) => cur.set(r.editionId, r));
        }
        for (const [editionId, b] of best) {
          const c = cur.get(editionId);
          if (!c) continue;
          if (c.salePromotionId == null && c.salePrice != null && c.salePrice <= b.price) continue; // giá nhập tay đang thấp hơn/bằng
          if (c.salePrice === b.price && c.salePromotionId === b.promotionId) continue;
          await query('UPDATE Edition SET salePrice = ?, salePromotionId = ? WHERE editionId = ?', [b.price, b.promotionId, editionId], conn);
          applied++;
        }
      }
      for (const [editionId] of managedMap) {
        if (best.has(editionId)) continue;
        await query('UPDATE Edition SET salePrice = NULL, salePromotionId = NULL WHERE editionId = ?', [editionId], conn);
        cleared++;
      }

      if (applied || cleared || expired) {
        await audit(conn, {
          actorId: null,
          action: 'APPLY',
          entityType: 'PROMOTION_JOB',
          newValue: { applied, cleared, expiredPromotions: expired, skippedBelowCost },
        });
      }
      await conn.commit();
      return { applied, cleared, expired, skippedBelowCost };
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });
}
