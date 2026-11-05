import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { normalizeIsbn } from '../../utils/text.js';
import { audit } from '../../services/audit.js';
import { badRequest, notFound, conflict, unprocessable } from '../../utils/errors.js';
import { weightedAverageCost, costAfterAdjustment, toCents } from './costing.js';

const PAGE_SIZE = 20;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const rand4 = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
const money = (cents) => (cents / 100).toFixed(2);

/**
 * Chuẩn hóa dòng hàng (theo editionId hoặc isbn). Không ném lỗi: trả { resolved, errors }
 * để dùng cho cả "xem trước" (báo lỗi từng dòng) lẫn tạo phiếu thật.
 * Chặn ấn bản "Ngừng kinh doanh" (vẫn cho điều chỉnh tồn kho ở chỗ khác) và dòng trùng.
 */
export async function resolveLines(conn, lines, { needCost = true, allowDiscontinued = false } = {}) {
  const ids = [...new Set(lines.map((l) => l.editionId).filter(Boolean))];
  const isbns = [...new Set(lines.filter((l) => !l.editionId && l.isbn).map((l) => normalizeIsbn(l.isbn)))];
  const found = [];
  if (ids.length)
    found.push(
      ...(await query(
        `SELECT e.editionId, e.isbn, e.businessStatus, w.title FROM Edition e JOIN Work w ON w.workId = e.workId WHERE e.editionId IN (?)`,
        [ids],
        conn,
      )),
    );
  if (isbns.length)
    found.push(
      ...(await query(
        `SELECT e.editionId, e.isbn, e.businessStatus, w.title FROM Edition e JOIN Work w ON w.workId = e.workId WHERE e.isbn IN (?)`,
        [isbns],
        conn,
      )),
    );
  const byId = new Map(found.map((e) => [e.editionId, e]));
  const byIsbn = new Map(found.map((e) => [e.isbn, e]));

  const resolved = [],
    errors = [],
    seen = new Set();
  lines.forEach((l, idx) => {
    const row = idx + 1;
    const ed = l.editionId ? byId.get(l.editionId) : byIsbn.get(normalizeIsbn(l.isbn || ''));
    if (!ed) return errors.push({ row, code: 'EDITION_NOT_FOUND', message: `Không tìm thấy ấn bản (${l.editionId || l.isbn})` });
    if (ed.businessStatus === 'DISCONTINUED' && !allowDiscontinued)
      return errors.push({ row, code: 'EDITION_DISCONTINUED', message: `"${ed.title}" đã ngừng kinh doanh, không thể chọn trong phiếu nhập mới` });
    if (seen.has(ed.editionId)) return errors.push({ row, code: 'DUPLICATE_LINE', message: `"${ed.title}" bị trùng trong phiếu` });
    if (needCost && !(l.unitCost >= 0)) return errors.push({ row, code: 'INVALID_COST', message: 'Giá nhập không hợp lệ' });
    seen.add(ed.editionId);
    resolved.push({
      editionId: ed.editionId,
      isbn: ed.isbn,
      title: ed.title,
      quantity: l.quantity,
      unitCost: needCost ? toCents(l.unitCost) / 100 : undefined,
    });
  });
  return { resolved, errors };
}

async function assertPoUsable(conn, purchaseOrderId, supplierId, resolved) {
  const [po] = await query('SELECT * FROM PurchaseOrder WHERE purchaseOrderId = ?', [purchaseOrderId], conn);
  if (!po) throw notFound('Không tìm thấy phiếu đặt hàng');
  if (!['OPEN', 'PARTIALLY_RECEIVED'].includes(po.status)) throw conflict('Phiếu đặt hàng không còn chờ nhận', 'PO_NOT_OPEN');
  if (po.supplierId !== supplierId) throw unprocessable('Phiếu đặt hàng thuộc nhà cung cấp khác', 'PO_SUPPLIER_MISMATCH');
  const details = await query('SELECT editionId FROM PurchaseOrderDetail WHERE purchaseOrderId = ?', [purchaseOrderId], conn);
  const allowed = new Set(details.map((d) => d.editionId));
  const extra = resolved.filter((r) => !allowed.has(r.editionId));
  if (extra.length)
    throw unprocessable(
      'Có đầu sách không thuộc phiếu đặt hàng',
      'PO_LINE_MISMATCH',
      extra.map((r) => ({ isbn: r.isbn, title: r.title })),
    );
}

async function insertDetails(conn, voucherId, resolved) {
  let totalQty = 0,
    totalCents = 0;
  for (const r of resolved) {
    const cents = toCents(r.unitCost),
      lineCents = r.quantity * cents;
    await query(
      `INSERT INTO ImportVoucherDetail (detailId, voucherId, editionId, quantity, unitCost, lineTotal) VALUES (?,?,?,?,?,?)`,
      [uuid(), voucherId, r.editionId, r.quantity, money(cents), money(lineCents)],
      conn,
    );
    totalQty += r.quantity;
    totalCents += lineCents;
  }
  await query('UPDATE ImportVoucher SET totalQuantity = ?, totalAmount = ? WHERE voucherId = ?', [totalQty, money(totalCents), voucherId], conn);
  return { totalQuantity: totalQty, totalAmount: totalCents / 100 };
}

/** Xem trước (nhập Excel/nhập tay): trả dòng hợp lệ và lỗi từng dòng, không ghi dữ liệu. */
export async function previewLines(supplierId, lines) {
  const [sup] = await query('SELECT supplierId, status FROM Supplier WHERE supplierId = ?', [supplierId]);
  if (!sup) throw notFound('Không tìm thấy nhà cung cấp');
  const { resolved, errors } = await resolveLines(undefined, lines);
  const totalAmount = resolved.reduce((s, r) => s + r.quantity * toCents(r.unitCost), 0) / 100;
  return { supplierActive: sup.status === 'ACTIVE', valid: resolved, errors, totalQuantity: resolved.reduce((s, r) => s + r.quantity, 0), totalAmount };
}

export async function createDraft(actor, d) {
  return withTx(async (conn) => {
    const [sup] = await query('SELECT supplierId, status FROM Supplier WHERE supplierId = ? FOR SHARE', [d.supplierId], conn);
    if (!sup) throw notFound('Không tìm thấy nhà cung cấp');
    if (sup.status !== 'ACTIVE') throw unprocessable('Nhà cung cấp đã ngừng hợp tác', 'SUPPLIER_INACTIVE');
    const { resolved, errors } = await resolveLines(conn, d.lines);
    if (errors.length) throw unprocessable('Có dòng hàng không hợp lệ', 'INVALID_LINES', errors);
    if (d.purchaseOrderId) await assertPoUsable(conn, d.purchaseOrderId, d.supplierId, resolved);

    const voucherId = uuid();
    const voucherCode = d.voucherCode || `PN${ymd()}-${rand4()}`;
    try {
      await query(
        `INSERT INTO ImportVoucher (voucherId, voucherCode, supplierId, purchaseOrderId, importDate, createdBy) VALUES (?,?,?,?,?,?)`,
        [voucherId, voucherCode, d.supplierId, d.purchaseOrderId ?? null, d.importDate, actor.staffId],
        conn,
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw conflict('Mã phiếu nhập đã tồn tại trong nhà cung cấp này', 'VOUCHER_CODE_EXISTS');
      throw e;
    }
    const totals = await insertDetails(conn, voucherId, resolved);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CREATE',
      entityType: 'IMPORT_VOUCHER',
      entityId: voucherId,
      newValue: { voucherCode, supplierId: d.supplierId, ...totals },
    });
    return { voucherId, voucherCode, status: 'DRAFT', ...totals };
  });
}

async function lockVoucher(conn, voucherId) {
  const [v] = await query('SELECT * FROM ImportVoucher WHERE voucherId = ? FOR UPDATE', [voucherId], conn);
  if (!v) throw notFound('Không tìm thấy phiếu nhập');
  return v;
}

/** Sửa phiếu nháp: thay toàn bộ dòng hàng (phiếu đã xác nhận không sửa được). */
export async function updateDraft(actor, voucherId, d) {
  return withTx(async (conn) => {
    const v = await lockVoucher(conn, voucherId);
    if (v.status !== 'DRAFT') throw conflict('Chỉ sửa được phiếu nhập chưa xác nhận', 'VOUCHER_NOT_EDITABLE');
    let totals;
    if (d.lines) {
      const { resolved, errors } = await resolveLines(conn, d.lines);
      if (errors.length) throw unprocessable('Có dòng hàng không hợp lệ', 'INVALID_LINES', errors);
      const poId = d.purchaseOrderId === undefined ? v.purchaseOrderId : d.purchaseOrderId;
      if (poId) await assertPoUsable(conn, poId, v.supplierId, resolved);
      await query('DELETE FROM ImportVoucherDetail WHERE voucherId = ?', [voucherId], conn);
      totals = await insertDetails(conn, voucherId, resolved);
    }
    if (d.importDate) await query('UPDATE ImportVoucher SET importDate = ? WHERE voucherId = ?', [d.importDate, voucherId], conn);
    if (d.purchaseOrderId !== undefined) await query('UPDATE ImportVoucher SET purchaseOrderId = ? WHERE voucherId = ?', [d.purchaseOrderId, voucherId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE',
      entityType: 'IMPORT_VOUCHER',
      entityId: voucherId,
      newValue: { importDate: d.importDate, ...totals },
    });
    return { voucherId, status: 'DRAFT', ...(totals || {}) };
  });
}

export async function cancelDraft(actor, voucherId, reason) {
  return withTx(async (conn) => {
    const v = await lockVoucher(conn, voucherId);
    if (v.status !== 'DRAFT') throw conflict('Chỉ hủy được phiếu nhập chưa xác nhận (phiếu đã xác nhận cần phiếu điều chỉnh)', 'VOUCHER_NOT_CANCELLABLE');
    await query(`UPDATE ImportVoucher SET status = 'CANCELLED' WHERE voucherId = ?`, [voucherId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CANCEL',
      entityType: 'IMPORT_VOUCHER',
      entityId: voucherId,
      oldValue: { status: 'DRAFT' },
      newValue: { status: 'CANCELLED' },
      reason,
    });
    return { voucherId, status: 'CANCELLED' };
  });
}

/**
 * Xác nhận nhập kho: đối chiếu số thực nhận (có thể kèm ISBN đã quét), tăng tồn thực tế,
 * tính lại giá vốn bình quân gia quyền, ghi nhật ký biến động, cập nhật phiếu đặt hàng. Tất cả trong một transaction.
 * `lines` (tùy chọn) phải phủ đủ mọi dòng của phiếu; không gửi => nhận đúng như phiếu.
 */
export async function confirmVoucher(actor, voucherId, lines) {
  return withTx(async (conn) => {
    const v = await lockVoucher(conn, voucherId);
    if (v.status !== 'DRAFT') throw conflict('Phiếu nhập đã được xác nhận hoặc đã hủy', 'VOUCHER_NOT_CONFIRMABLE');
    const details = await query(
      `SELECT d.detailId, d.editionId, d.quantity, d.unitCost, e.isbn, w.title
         FROM ImportVoucherDetail d JOIN Edition e ON e.editionId = d.editionId JOIN Work w ON w.workId = e.workId
        WHERE d.voucherId = ? ORDER BY d.editionId`,
      [voucherId],
      conn,
    );
    if (!details.length) throw unprocessable('Phiếu nhập chưa có dòng hàng', 'EMPTY_VOUCHER');

    // Số thực nhận từng dòng + đối chiếu ISBN quét
    const received = new Map(details.map((d) => [d.detailId, d.quantity]));
    if (lines) {
      const given = new Map(lines.map((l) => [l.detailId, l]));
      if (given.size !== lines.length) throw unprocessable('Có dòng bị lặp trong dữ liệu xác nhận', 'DUPLICATE_LINE');
      const missing = details.filter((d) => !given.has(d.detailId)).map((d) => ({ detailId: d.detailId, isbn: d.isbn, title: d.title }));
      if (missing.length || given.size !== details.length) throw unprocessable('Cần xác nhận đủ mọi dòng của phiếu', 'MISSING_LINES', missing);
      const mismatch = [];
      for (const d of details) {
        const l = given.get(d.detailId);
        if (l.isbn && normalizeIsbn(l.isbn) !== d.isbn) mismatch.push({ detailId: d.detailId, expected: d.isbn, scanned: l.isbn });
        received.set(d.detailId, l.receivedQty);
      }
      if (mismatch.length) throw unprocessable('ISBN quét không khớp với dòng hàng', 'ISBN_MISMATCH', mismatch);
    }
    if (![...received.values()].some((q) => q > 0)) throw unprocessable('Không có cuốn nào được nhận', 'EMPTY_RECEIPT');

    // Ghi số thực nhận vào phiếu (dòng nhận 0 cuốn thì bỏ) - vẫn còn DRAFT nên trigger cho phép
    const final = [];
    for (const d of details) {
      const qty = received.get(d.detailId);
      if (qty === 0) {
        await query('DELETE FROM ImportVoucherDetail WHERE detailId = ?', [d.detailId], conn);
        continue;
      }
      if (qty !== d.quantity) {
        const lineCents = qty * toCents(d.unitCost);
        await query('UPDATE ImportVoucherDetail SET quantity = ?, lineTotal = ? WHERE detailId = ?', [qty, money(lineCents), d.detailId], conn);
      }
      final.push({ ...d, quantity: qty, orderedQuantity: d.quantity });
    }

    let totalQty = 0,
      totalCents = 0;
    for (const d of final) {
      // đã sắp theo editionId => khóa theo thứ tự cố định, tránh deadlock
      const [inv] = await query('SELECT qtyOnHand FROM Inventory WHERE editionId = ? FOR UPDATE', [d.editionId], conn);
      if (!inv) throw new Error(`Thiếu dòng Inventory cho ${d.editionId}`);
      const [ed] = await query('SELECT costPrice FROM Edition WHERE editionId = ? FOR UPDATE', [d.editionId], conn);
      const unitCost = Number(d.unitCost);
      const newCost = weightedAverageCost({ onHand: inv.qtyOnHand, currentCost: ed.costPrice, qty: d.quantity, unitCost });
      const qtyAfter = inv.qtyOnHand + d.quantity;
      await query('UPDATE Inventory SET qtyOnHand = ? WHERE editionId = ?', [qtyAfter, d.editionId], conn);
      await query('UPDATE Edition SET costPrice = ? WHERE editionId = ?', [newCost, d.editionId], conn);
      await query(
        `INSERT INTO StockMovement (movementId, editionId, movementType, quantity, qtyAfter, referenceType, referenceId, performedBy)
                   VALUES (?,?,?,?,?,?,?,?)`,
        [uuid(), d.editionId, 'IMPORT', d.quantity, qtyAfter, 'IMPORT_VOUCHER', voucherId, actor.staffId],
        conn,
      );
      totalQty += d.quantity;
      totalCents += d.quantity * toCents(unitCost);
    }

    await query(
      `UPDATE ImportVoucher SET status='CONFIRMED', totalQuantity=?, totalAmount=?, confirmedBy=?, confirmedAt=NOW() WHERE voucherId=?`,
      [totalQty, money(totalCents), actor.staffId, voucherId],
      conn,
    );

    if (v.purchaseOrderId) await applyReceiptToPo(conn, v.purchaseOrderId, final);

    await audit(conn, {
      actorId: actor.accountId,
      action: 'CONFIRM',
      entityType: 'IMPORT_VOUCHER',
      entityId: voucherId,
      oldValue: { status: 'DRAFT' },
      newValue: {
        status: 'CONFIRMED',
        totalQuantity: totalQty,
        totalAmount: totalCents / 100,
        adjustedLines: final.filter((f) => f.quantity !== f.orderedQuantity).map((f) => ({ isbn: f.isbn, ordered: f.orderedQuantity, received: f.quantity })),
      },
    });
    return { voucherId, status: 'CONFIRMED', totalQuantity: totalQty, totalAmount: totalCents / 100 };
  });
}

async function applyReceiptToPo(conn, purchaseOrderId, final) {
  await query('SELECT purchaseOrderId FROM PurchaseOrder WHERE purchaseOrderId = ? FOR UPDATE', [purchaseOrderId], conn);
  for (const d of final) {
    await query(
      'UPDATE PurchaseOrderDetail SET qtyReceived = qtyReceived + ? WHERE purchaseOrderId = ? AND editionId = ?',
      [d.quantity, purchaseOrderId, d.editionId],
      conn,
    );
  }
  const [{ open }] = await query(
    'SELECT COUNT(*) AS open FROM PurchaseOrderDetail WHERE purchaseOrderId = ? AND qtyReceived < qtyOrdered',
    [purchaseOrderId],
    conn,
  );
  await query(
    `UPDATE PurchaseOrder SET status = ?, closedAt = ? WHERE purchaseOrderId = ? AND status IN ('OPEN','PARTIALLY_RECEIVED')`,
    [open ? 'PARTIALLY_RECEIVED' : 'RECEIVED', open ? null : new Date(), purchaseOrderId],
    conn,
  );
}

/**
 * Phiếu điều chỉnh giá nhập (chỉ ADMIN gọi ở route). Phiếu gốc không bị sửa; giá vốn được tính lại theo chênh lệch.
 * OrderItem.costPrice đã chốt khi xuất kho nên báo cáo kỳ cũ không bị tính lại.
 */
export async function adjustCost(actor, voucherId, { detailId, newUnitCost, reason, attachmentUrl }) {
  return withTx(async (conn) => {
    const v = await lockVoucher(conn, voucherId);
    if (v.status !== 'CONFIRMED') throw conflict('Chỉ điều chỉnh giá nhập cho phiếu đã xác nhận', 'VOUCHER_NOT_CONFIRMED');
    const [d] = await query('SELECT * FROM ImportVoucherDetail WHERE detailId = ? AND voucherId = ?', [detailId, voucherId], conn);
    if (!d) throw notFound('Không tìm thấy dòng hàng trong phiếu');
    const [last] = await query('SELECT newUnitCost FROM CostAdjustment WHERE detailId = ? ORDER BY createdAt DESC, adjustmentId LIMIT 1', [detailId], conn);
    const oldUnitCost = Number(last ? last.newUnitCost : d.unitCost);
    const newCents = toCents(newUnitCost);
    if (newCents === toCents(oldUnitCost)) throw badRequest('Giá nhập mới trùng giá hiện tại', 'NO_CHANGE');

    const [inv] = await query('SELECT qtyOnHand FROM Inventory WHERE editionId = ? FOR UPDATE', [d.editionId], conn);
    const [ed] = await query('SELECT costPrice FROM Edition WHERE editionId = ? FOR UPDATE', [d.editionId], conn);
    const costAfter = costAfterAdjustment({ onHand: inv.qtyOnHand, currentCost: ed.costPrice, oldUnitCost, newUnitCost: newCents / 100, lotQty: d.quantity });
    const adjustmentId = uuid();
    await query(
      `INSERT INTO CostAdjustment (adjustmentId, voucherId, detailId, editionId, oldUnitCost, newUnitCost, costBefore, costAfter, reason, attachmentUrl, createdBy)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        adjustmentId,
        voucherId,
        detailId,
        d.editionId,
        oldUnitCost.toFixed(2),
        money(newCents),
        ed.costPrice,
        costAfter,
        reason,
        attachmentUrl ?? null,
        actor.staffId,
      ],
      conn,
    );
    await query('UPDATE Edition SET costPrice = ? WHERE editionId = ?', [costAfter, d.editionId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'COST_ADJUST',
      entityType: 'IMPORT_VOUCHER',
      entityId: voucherId,
      oldValue: { unitCost: oldUnitCost, costPrice: ed.costPrice },
      newValue: { unitCost: newCents / 100, costPrice: costAfter },
      reason,
    });
    return { adjustmentId, editionId: d.editionId, oldUnitCost, newUnitCost: newCents / 100, costBefore: ed.costPrice, costAfter };
  });
}

export async function getVoucher(voucherId) {
  const [v] = await query(
    `SELECT v.*, s.name AS supplierName, po.poCode FROM ImportVoucher v JOIN Supplier s ON s.supplierId = v.supplierId
       LEFT JOIN PurchaseOrder po ON po.purchaseOrderId = v.purchaseOrderId WHERE v.voucherId = ?`,
    [voucherId],
  );
  if (!v) throw notFound('Không tìm thấy phiếu nhập');
  const details = await query(
    `SELECT d.detailId, d.editionId, e.isbn, w.title, d.quantity, d.unitCost, d.lineTotal
       FROM ImportVoucherDetail d JOIN Edition e ON e.editionId = d.editionId JOIN Work w ON w.workId = e.workId
      WHERE d.voucherId = ? ORDER BY w.title`,
    [voucherId],
  );
  const adjustments = await query('SELECT * FROM CostAdjustment WHERE voucherId = ? ORDER BY createdAt', [voucherId]);
  return { ...v, details, adjustments };
}

export async function listVouchers({ status, supplierId, from, to, page }) {
  const where = [],
    params = [];
  if (status) {
    where.push('v.status = ?');
    params.push(status);
  }
  if (supplierId) {
    where.push('v.supplierId = ?');
    params.push(supplierId);
  }
  if (from) {
    where.push('v.importDate >= ?');
    params.push(from);
  }
  if (to) {
    where.push('v.importDate <= ?');
    params.push(to);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM ImportVoucher v ${w}`, params);
  const items = await query(
    `SELECT v.voucherId, v.voucherCode, v.supplierId, s.name AS supplierName, v.importDate, v.status, v.totalQuantity, v.totalAmount, v.createdAt, v.confirmedAt
       FROM ImportVoucher v JOIN Supplier s ON s.supplierId = v.supplierId ${w}
      ORDER BY v.createdAt DESC LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { items, page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
}

// ---------------- Phiếu đặt hàng nhà cung cấp ----------------

export async function createPurchaseOrder(actor, { supplierId, lines }) {
  return withTx(async (conn) => {
    const [sup] = await query('SELECT status FROM Supplier WHERE supplierId = ? FOR SHARE', [supplierId], conn);
    if (!sup) throw notFound('Không tìm thấy nhà cung cấp');
    if (sup.status !== 'ACTIVE') throw unprocessable('Nhà cung cấp đã ngừng hợp tác', 'SUPPLIER_INACTIVE');
    const { resolved, errors } = await resolveLines(conn, lines, { needCost: false });
    if (errors.length) throw unprocessable('Có dòng hàng không hợp lệ', 'INVALID_LINES', errors);
    const purchaseOrderId = uuid(),
      poCode = `PO${ymd()}-${rand4()}`;
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
    [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );
  return { items, page, pageSize: PAGE_SIZE, total, totalPages: Math.ceil(total / PAGE_SIZE) };
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
