import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { escapeLike, nameLike } from '../../utils/text.js';
import { audit } from '../../services/audit.js';
import { notFound, unprocessable, conflict } from '../../utils/errors.js';
import { resolveLines } from './lines.js';
import { recomputeStockLevels } from './inventory.jobs.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 20;

export async function listInventory({ q, filter, page }) {
  const where = [],
    params = [];
  if (q) {
    const n = nameLike(['w.title'], q);
    where.push(`(${n.sql} OR e.isbn LIKE ?)`);
    params.push(...n.params, `%${escapeLike(q)}%`);
  }
  if (filter === 'below_min') where.push('i.qtyAvailable < i.minStockLevel');
  if (filter === 'out_of_stock') where.push('i.qtyAvailable = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM Inventory i JOIN Edition e ON e.editionId = i.editionId JOIN Work w ON w.workId = e.workId JOIN Publisher p ON p.publisherId = e.publisherId`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from} ${w}`, params);
  const items = await query(
    `SELECT e.editionId, e.isbn, w.title, p.name AS publisher, e.businessStatus, e.costPrice,
            i.qtyOnHand, i.qtyReserved, i.qtyAvailable, i.qtyPendingInspection, i.minStockLevel, i.reorderQty,
            i.defaultSupplierId, i.minStockOverridden, i.reorderOverridden, i.supplierOverridden,
            (i.qtyAvailable < i.minStockLevel) AS belowMin
       ${from} ${w} ORDER BY belowMin DESC, w.title LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, PAGE_SIZE)],
  );
  return paged(
    items.map((r) => ({ ...r, belowMin: !!r.belowMin })),
    total,
    page,
    PAGE_SIZE,
  );
}

export async function getInventory(editionId) {
  const [row] = await query(
    `SELECT e.editionId, e.isbn, w.title, e.businessStatus, e.costPrice, i.*
       FROM Inventory i JOIN Edition e ON e.editionId = i.editionId JOIN Work w ON w.workId = e.workId WHERE i.editionId = ?`,
    [editionId],
  );
  if (!row) throw notFound('Không tìm thấy ấn bản');
  return row;
}

export async function listMovements(editionId, page) {
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM StockMovement WHERE editionId = ?', [editionId]);
  const items = await query(
    `SELECT m.movementId, m.movementType, m.quantity, m.qtyAfter, m.referenceType, m.referenceId, m.reason, m.createdAt,
            st.fullName AS performedByName
       FROM StockMovement m LEFT JOIN Staff st ON st.staffId = m.performedBy
      WHERE m.editionId = ? ORDER BY m.createdAt DESC, m.movementId LIMIT ? OFFSET ?`,
    [editionId, ...limitOffset(page, PAGE_SIZE)],
  );
  return paged(items, total, page, PAGE_SIZE);
}

/** Ghi đè tồn tối thiểu / số lượng đặt lại / nhà cung cấp mặc định (giá trị ghi đè không bị tính lại). */
export async function updateSettings(actor, editionId, d) {
  return withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM Inventory WHERE editionId = ? FOR UPDATE', [editionId], conn);
    if (!cur) throw notFound('Không tìm thấy ấn bản');
    if (d.defaultSupplierId) {
      const [s] = await query('SELECT status FROM Supplier WHERE supplierId = ?', [d.defaultSupplierId], conn);
      if (!s) throw notFound('Không tìm thấy nhà cung cấp');
      if (s.status !== 'ACTIVE') throw unprocessable('Nhà cung cấp đã ngừng hợp tác', 'SUPPLIER_INACTIVE');
    }
    const sets = [],
      params = [];
    if (d.resetToAuto) sets.push('minStockOverridden = FALSE', 'reorderOverridden = FALSE', 'supplierOverridden = FALSE');
    if (d.minStockLevel !== undefined) {
      sets.push('minStockLevel = ?', 'minStockOverridden = TRUE');
      params.push(d.minStockLevel);
    }
    if (d.reorderQty !== undefined) {
      sets.push('reorderQty = ?', 'reorderOverridden = TRUE');
      params.push(d.reorderQty);
    }
    if (d.defaultSupplierId !== undefined) {
      sets.push('defaultSupplierId = ?', 'supplierOverridden = TRUE');
      params.push(d.defaultSupplierId);
    }
    await query(`UPDATE Inventory SET ${sets.join(', ')} WHERE editionId = ?`, [...params, editionId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE_STOCK_SETTINGS',
      entityType: 'INVENTORY',
      entityId: editionId,
      oldValue: { minStockLevel: cur.minStockLevel, reorderQty: cur.reorderQty, defaultSupplierId: cur.defaultSupplierId },
      newValue: d,
    });
    if (d.resetToAuto) await recomputeStockLevels({ editionId, conn });
    const [after] = await query('SELECT * FROM Inventory WHERE editionId = ?', [editionId], conn);
    return after;
  });
}

/**
 * Kiểm kê / điều chỉnh tồn kho (client quét mã vạch rồi gửi ISBN + số đếm thực tế).
 * Mỗi dòng đặt lại tồn thực tế; chênh lệch ghi vào nhật ký biến động và trả về như phiếu chênh lệch.
 * type: ADJUST (kiểm kê) hoặc DAMAGE (hư hỏng, chỉ giảm). Ấn bản "Ngừng kinh doanh" vẫn được điều chỉnh.
 * Nếu tồn mới < số đã giữ cho đơn hàng thì chặn cả đợt (việc tự hủy đơn đặt muộn nhất + hoàn tiền làm cùng module đặt hàng).
 */
export async function adjustStock(actor, { reason, lines }) {
  return withTx(async (conn) => {
    const { resolved, errors } = await resolveLines(
      conn,
      lines.map((l) => ({ editionId: l.editionId, isbn: l.isbn, quantity: l.actualQty })),
      { needCost: false, allowDiscontinued: true },
    );
    if (errors.length) throw unprocessable('Có dòng hàng không hợp lệ', 'INVALID_LINES', errors);
    const typeByEdition = new Map(resolved.map((r, i) => [r.editionId, lines[i].type])); // không dòng nào bị loại nên thứ tự khớp
    const batchId = uuid();
    const report = [],
      problems = [];

    for (const r of [...resolved].sort((a, b) => a.editionId.localeCompare(b.editionId))) {
      // khóa theo thứ tự cố định
      const type = typeByEdition.get(r.editionId);
      const [inv] = await query('SELECT qtyOnHand, qtyReserved FROM Inventory WHERE editionId = ? FOR UPDATE', [r.editionId], conn);
      const actual = r.quantity,
        diff = actual - inv.qtyOnHand;
      const line = { editionId: r.editionId, isbn: r.isbn, title: r.title, type, before: inv.qtyOnHand, after: actual, diff };
      if (type === 'DAMAGE' && diff > 0) {
        problems.push({ isbn: r.isbn, code: 'DAMAGE_INCREASE', message: 'Hư hỏng chỉ được làm giảm tồn kho' });
        continue;
      }
      if (actual < inv.qtyReserved) {
        problems.push({
          isbn: r.isbn,
          code: 'BELOW_RESERVED',
          message: `Tồn mới (${actual}) thấp hơn số đang giữ cho đơn hàng (${inv.qtyReserved})`,
          reserved: inv.qtyReserved,
        });
        continue;
      }
      report.push(line);
      if (diff === 0) continue;
      await query('UPDATE Inventory SET qtyOnHand = ? WHERE editionId = ?', [actual, r.editionId], conn);
      await query(
        `INSERT INTO StockMovement (movementId, editionId, movementType, quantity, qtyAfter, referenceType, referenceId, reason, performedBy)
                   VALUES (?,?,?,?,?,?,?,?,?)`,
        [uuid(), r.editionId, type, diff, actual, 'STOCK_TAKE', batchId, reason, actor.staffId],
        conn,
      );
    }
    if (problems.length) throw conflict('Không thể điều chỉnh: có dòng vi phạm', 'ADJUST_REJECTED', problems); // rollback cả đợt
    await audit(conn, { actorId: actor.accountId, action: 'STOCK_TAKE', entityType: 'STOCK_TAKE', entityId: batchId, newValue: { lines: report }, reason });
    return { batchId, changed: report.filter((l) => l.diff !== 0).length, lines: report };
  });
}

/**
 * Kiểm hàng "chờ kiểm" (hoàn về / trả hàng): cuốn nguyên vẹn cộng vào tồn thực tế, cuốn hư hỏng bị loại khỏi hàng chờ kiểm.
 * (Việc đưa hàng vào "chờ kiểm" sẽ do module đơn hàng/trả hàng thực hiện.)
 */
export async function inspectPending(actor, editionId, { goodQty, damagedQty, reason }) {
  return withTx(async (conn) => {
    const [inv] = await query('SELECT qtyOnHand, qtyPendingInspection FROM Inventory WHERE editionId = ? FOR UPDATE', [editionId], conn);
    if (!inv) throw notFound('Không tìm thấy ấn bản');
    if (goodQty + damagedQty > inv.qtyPendingInspection) throw unprocessable(`Chỉ có ${inv.qtyPendingInspection} cuốn đang chờ kiểm`, 'EXCEEDS_PENDING');
    const qtyAfter = inv.qtyOnHand + goodQty;
    await query(
      'UPDATE Inventory SET qtyPendingInspection = qtyPendingInspection - ?, qtyOnHand = ? WHERE editionId = ?',
      [goodQty + damagedQty, qtyAfter, editionId],
      conn,
    );
    if (goodQty > 0) {
      await query(
        `INSERT INTO StockMovement (movementId, editionId, movementType, quantity, qtyAfter, referenceType, reason, performedBy) VALUES (?,?,?,?,?,?,?,?)`,
        [uuid(), editionId, 'RESTORE', goodQty, qtyAfter, 'INSPECTION', reason ?? 'Kiểm hàng chờ kiểm: còn nguyên vẹn', actor.staffId],
        conn,
      );
    }
    await audit(conn, { actorId: actor.accountId, action: 'INSPECT', entityType: 'INVENTORY', entityId: editionId, newValue: { goodQty, damagedQty }, reason });
    return { editionId, qtyOnHand: qtyAfter, qtyPendingInspection: inv.qtyPendingInspection - goodQty - damagedQty };
  });
}
