import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { audit } from '../../services/audit.js';
import { getInt } from '../../services/params.js';
import { enqueueEmail } from '../../services/mailer.js';
import { computeStockLevels } from './costing.js';
import { newCode, ymdVN } from './lines.js';

/**
 * Tính lại tồn tối thiểu, số lượng đặt lại, nhà cung cấp mặc định từ doanh số (nhật ký SALE) và thời gian giao.
 * Cột nào đã bị ghi đè (…Overridden) thì giữ nguyên - điều kiện nằm ngay trong câu UPDATE nên không ghi đè nhầm khi chạy song song.
 */
export async function recomputeStockLevels({ editionId, conn } = {}) {
  const days = await getInt('SALES_AVG_DAYS');
  const safetyStock = await getInt('SAFETY_STOCK_DEFAULT');
  const leadMap = new Map((await query('SELECT supplierId, leadTimeDays FROM Supplier', [], conn)).map((s) => [s.supplierId, s.leadTimeDays]));
  const rows = await query(
    `SELECT i.editionId, i.defaultSupplierId, i.supplierOverridden,
            (SELECT COALESCE(-SUM(sm.quantity), 0) FROM StockMovement sm
              WHERE sm.editionId = i.editionId AND sm.movementType = 'SALE' AND sm.createdAt >= NOW() - INTERVAL ? DAY) AS sold,
            (SELECT v.supplierId FROM ImportVoucher v
               JOIN ImportVoucherDetail d ON d.voucherId = v.voucherId
               JOIN Supplier s ON s.supplierId = v.supplierId
              WHERE d.editionId = i.editionId AND v.status = 'CONFIRMED' AND s.status = 'ACTIVE'
              ORDER BY v.confirmedAt DESC LIMIT 1) AS lastSupplierId
       FROM Inventory i
      WHERE NOT (i.minStockOverridden AND i.reorderOverridden AND i.supplierOverridden) ${editionId ? 'AND i.editionId = ?' : ''}`,
    editionId ? [days, editionId] : [days],
    conn,
  );
  for (const r of rows) {
    const supplierId = r.supplierOverridden ? r.defaultSupplierId : (r.lastSupplierId ?? r.defaultSupplierId);
    const leadTimeDays = leadMap.get(supplierId) ?? 7;
    const { minStockLevel, reorderQty } = computeStockLevels({ sold: Number(r.sold), days, leadTimeDays, safetyStock, horizonDays: days });
    await query(
      `UPDATE Inventory SET minStockLevel = IF(minStockOverridden, minStockLevel, ?),
                            reorderQty = IF(reorderOverridden, reorderQty, ?),
                            defaultSupplierId = IF(supplierOverridden, defaultSupplierId, COALESCE(?, defaultSupplierId))
        WHERE editionId = ?`,
      [minStockLevel, reorderQty, r.lastSupplierId ?? null, r.editionId],
      conn,
    );
  }
  return rows.length;
}

/** Tự tạo phiếu đặt hàng (gộp theo nhà cung cấp mặc định) cho ấn bản có khả dụng < tồn tối thiểu và chưa có phiếu đang chờ nhận. */
export async function createAutoPurchaseOrders() {
  const stillNeeded = `NOT EXISTS (SELECT 1 FROM PurchaseOrderDetail d JOIN PurchaseOrder po ON po.purchaseOrderId = d.purchaseOrderId
                         WHERE d.editionId = ? AND po.status IN ('OPEN','PARTIALLY_RECEIVED') AND d.qtyReceived < d.qtyOrdered)`;
  const cands = await query(
    `SELECT i.editionId, i.defaultSupplierId AS supplierId
       FROM Inventory i JOIN Edition e ON e.editionId = i.editionId JOIN Supplier s ON s.supplierId = i.defaultSupplierId
      WHERE i.minStockLevel > 0 AND i.qtyAvailable < i.minStockLevel AND e.businessStatus <> 'DISCONTINUED' AND s.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM PurchaseOrderDetail d JOIN PurchaseOrder po ON po.purchaseOrderId = d.purchaseOrderId
                         WHERE d.editionId = i.editionId AND po.status IN ('OPEN','PARTIALLY_RECEIVED') AND d.qtyReceived < d.qtyOrdered)
      ORDER BY i.defaultSupplierId, i.editionId`,
  );
  const bySupplier = new Map();
  for (const c of cands) bySupplier.set(c.supplierId, [...(bySupplier.get(c.supplierId) || []), c.editionId]);

  let created = 0;
  for (const [supplierId, editionIds] of bySupplier) {
    created += await withTx(async (conn) => {
      const lines = [];
      for (const editionId of editionIds) {
        // khóa dòng tồn kho rồi kiểm tra lại trong transaction
        const [inv] = await query('SELECT qtyAvailable, minStockLevel, reorderQty FROM Inventory WHERE editionId = ? FOR UPDATE', [editionId], conn);
        const [{ ok }] = await query(`SELECT ${stillNeeded} AS ok`, [editionId], conn);
        if (!inv || !ok || inv.qtyAvailable >= inv.minStockLevel) continue;
        lines.push({ editionId, qty: Math.max(inv.reorderQty ?? 0, inv.minStockLevel - inv.qtyAvailable, 1) });
      }
      if (!lines.length) return 0;
      const purchaseOrderId = uuid(),
        poCode = newCode('PO');
      await query('INSERT INTO PurchaseOrder (purchaseOrderId, poCode, supplierId, isAuto) VALUES (?,?,?,TRUE)', [purchaseOrderId, poCode, supplierId], conn);
      for (const l of lines)
        await query(
          'INSERT INTO PurchaseOrderDetail (poDetailId, purchaseOrderId, editionId, qtyOrdered) VALUES (?,?,?,?)',
          [uuid(), purchaseOrderId, l.editionId, l.qty],
          conn,
        );
      await audit(conn, {
        action: 'AUTO_CREATE',
        entityType: 'PURCHASE_ORDER',
        entityId: purchaseOrderId,
        newValue: { poCode, supplierId, lines: lines.length },
      });
      return 1;
    });
  }
  return created;
}

/** Tự đóng phiếu đặt hàng quá PO_AUTO_CLOSE_DAYS ngày chưa nhận đủ. */
export async function autoClosePurchaseOrders() {
  const days = await getInt('PO_AUTO_CLOSE_DAYS');
  const stale = await query(`SELECT purchaseOrderId FROM PurchaseOrder WHERE status IN ('OPEN','PARTIALLY_RECEIVED') AND createdAt < NOW() - INTERVAL ? DAY`, [
    days,
  ]);
  for (const { purchaseOrderId } of stale) {
    await withTx(async (conn) => {
      const r = await query(
        `UPDATE PurchaseOrder SET status='AUTO_CLOSED', closedAt=NOW() WHERE purchaseOrderId=? AND status IN ('OPEN','PARTIALLY_RECEIVED')`,
        [purchaseOrderId],
        conn,
      );
      if (r.affectedRows === 1)
        await audit(conn, { action: 'AUTO_CLOSE', entityType: 'PURCHASE_ORDER', entityId: purchaseOrderId, reason: `Quá ${days} ngày chưa nhận đủ` });
    });
  }
  return stale.length;
}

/** Tự hủy phiếu nhập nháp quá IMPORT_DRAFT_AUTO_CANCEL_DAYS ngày chưa xác nhận. */
export async function cancelStaleVoucherDrafts() {
  const days = await getInt('IMPORT_DRAFT_AUTO_CANCEL_DAYS');
  const stale = await query(`SELECT voucherId FROM ImportVoucher WHERE status='DRAFT' AND createdAt < NOW() - INTERVAL ? DAY`, [days]);
  for (const { voucherId } of stale) {
    await withTx(async (conn) => {
      const r = await query(`UPDATE ImportVoucher SET status='CANCELLED' WHERE voucherId=? AND status='DRAFT'`, [voucherId], conn);
      if (r.affectedRows === 1)
        await audit(conn, { action: 'AUTO_CANCEL', entityType: 'IMPORT_VOUCHER', entityId: voucherId, reason: `Quá ${days} ngày chưa xác nhận` });
    });
  }
  return stale.length;
}

/** Email tóm tắt mỗi ngày các ấn bản dưới mức tồn tối thiểu (dedupeKey theo ngày + người nhận => không gửi trùng). */
export async function sendLowStockDigest() {
  const rows = await query(
    `SELECT e.isbn, w.title, i.qtyAvailable, i.minStockLevel
       FROM Inventory i JOIN Edition e ON e.editionId = i.editionId JOIN Work w ON w.workId = e.workId
      WHERE i.qtyAvailable < i.minStockLevel AND e.businessStatus <> 'DISCONTINUED'
      ORDER BY (i.minStockLevel - i.qtyAvailable) DESC LIMIT 100`,
  );
  if (!rows.length) return 0;
  const recipients = await query(`SELECT accountId, email FROM Account WHERE role IN ('STAFF','ADMIN') AND status = 'ACTIVE'`);
  const body =
    `Có ${rows.length} ấn bản dưới mức tồn tối thiểu:\n\n` +
    rows.map((r) => `- ${r.title} (ISBN ${r.isbn}): khả dụng ${r.qtyAvailable}, tối thiểu ${r.minStockLevel}`).join('\n');
  await withTx(async (conn) => {
    for (const r of recipients) {
      await enqueueEmail(conn, {
        dedupeKey: `low-stock:${ymdVN()}:${r.accountId}`,
        to: r.email,
        subject: `Cảnh báo tồn kho: ${rows.length} ấn bản dưới mức tối thiểu`,
        body,
      });
    }
  });
  return recipients.length;
}
