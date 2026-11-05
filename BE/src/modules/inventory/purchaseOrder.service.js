import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { normalizeIsbn } from '../../utils/text.js';
import { audit } from '../../services/audit.js';
import { notFound, conflict, unprocessable } from '../../utils/errors.js';
import { resolveLines, newCode } from './lines.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 20;

export async function createPurchaseOrder(actor, { supplierId, lines }) {
  return withTx(async (conn) => {
    const [sup] = await query('SELECT status FROM Supplier WHERE supplierId = ? FOR SHARE', [supplierId], conn);
    if (!sup) throw notFound('Không tìm thấy nhà cung cấp');
    if (sup.status !== 'ACTIVE') throw unprocessable('Nhà cung cấp đã ngừng hợp tác', 'SUPPLIER_INACTIVE');
    const { resolved, errors } = await resolveLines(conn, lines, { needCost: false });
    if (errors.length) throw unprocessable('Có dòng hàng không hợp lệ', 'INVALID_LINES', errors);
    const purchaseOrderId = uuid(),
      poCode = newCode('PO');
    await query('INSERT INTO PurchaseOrder (purchaseOrderId, poCode, supplierId, isAuto) VALUES (?,?,?,FALSE)', [purchaseOrderId, poCode, supplierId], conn);
    for (const r of resolved) {
      await query(
        'INSERT INTO PurchaseOrderDetail (poDetailId, purchaseOrderId, editionId, qtyOrdered) VALUES (?,?,?,?)',
        [uuid(), purchaseOrderId, r.editionId, r.quantity],
        conn,
      );
    }
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CREATE',
      entityType: 'PURCHASE_ORDER',
      entityId: purchaseOrderId,
      newValue: { poCode, supplierId, lines: resolved.length },
    });
    return { purchaseOrderId, poCode, status: 'OPEN' };
  });
}

export async function cancelPurchaseOrder(actor, purchaseOrderId, reason) {
  return withTx(async (conn) => {
    const [po] = await query('SELECT status FROM PurchaseOrder WHERE purchaseOrderId = ? FOR UPDATE', [purchaseOrderId], conn);
    if (!po) throw notFound('Không tìm thấy phiếu đặt hàng');
    if (!['OPEN', 'PARTIALLY_RECEIVED'].includes(po.status)) throw conflict('Phiếu đặt hàng đã đóng', 'PO_NOT_OPEN');
    await query(`UPDATE PurchaseOrder SET status = 'CANCELLED', closedAt = NOW() WHERE purchaseOrderId = ?`, [purchaseOrderId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CANCEL',
      entityType: 'PURCHASE_ORDER',
      entityId: purchaseOrderId,
      oldValue: { status: po.status },
      newValue: { status: 'CANCELLED' },
      reason,
    });
    return { purchaseOrderId, status: 'CANCELLED' };
  });
}

export async function listPurchaseOrders({ status, supplierId, page }) {
  const where = [],
    params = [];
  if (status) {
    where.push('po.status = ?');
    params.push(status);
  }
  if (supplierId) {
    where.push('po.supplierId = ?');
    params.push(supplierId);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM PurchaseOrder po ${w}`, params);
  const items = await query(
    `SELECT po.*, s.name AS supplierName FROM PurchaseOrder po JOIN Supplier s ON s.supplierId = po.supplierId ${w}
      ORDER BY po.createdAt DESC LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, PAGE_SIZE)],
  );
  return paged(items, total, page, PAGE_SIZE);
}

export async function getPurchaseOrder(purchaseOrderId) {
  const [po] = await query(
    'SELECT po.*, s.name AS supplierName FROM PurchaseOrder po JOIN Supplier s ON s.supplierId = po.supplierId WHERE po.purchaseOrderId = ?',
    [purchaseOrderId],
  );
  if (!po) throw notFound('Không tìm thấy phiếu đặt hàng');
  const details = await query(
    `SELECT d.editionId, e.isbn, w.title, d.qtyOrdered, d.qtyReceived
       FROM PurchaseOrderDetail d JOIN Edition e ON e.editionId = d.editionId JOIN Work w ON w.workId = e.workId
      WHERE d.purchaseOrderId = ? ORDER BY w.title`,
    [purchaseOrderId],
  );
  return { ...po, details };
}

/** Quét ISBN đầu tiên khi lập phiếu nhập: tìm các phiếu đặt hàng đang chờ nhận có chứa ấn bản này. */
export async function findOpenPurchaseOrdersByIsbn(isbn) {
  return query(
    `SELECT po.purchaseOrderId, po.poCode, po.supplierId, s.name AS supplierName, po.createdAt, d.qtyOrdered, d.qtyReceived
       FROM PurchaseOrder po
       JOIN PurchaseOrderDetail d ON d.purchaseOrderId = po.purchaseOrderId
       JOIN Edition e ON e.editionId = d.editionId
       JOIN Supplier s ON s.supplierId = po.supplierId
      WHERE e.isbn = ? AND po.status IN ('OPEN','PARTIALLY_RECEIVED') AND d.qtyReceived < d.qtyOrdered
      ORDER BY po.createdAt`,
    [normalizeIsbn(isbn)],
  );
}
