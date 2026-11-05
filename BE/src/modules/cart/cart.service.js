import { pool, query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { getInt } from '../../services/params.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';

/** owner = { customerId } hoặc { sessionId } */
const ownerWhere = (o) => (o.customerId ? ['ci.customerId = ?', o.customerId] : ['ci.sessionId = ?', o.sessionId]);

/** Xem giỏ: báo từng dòng đổi giá / hết hàng / ngừng bán; dòng lỗi không làm hỏng dòng khác. */
export async function getCart(owner, conn = pool) {
  const [cond, val] = ownerWhere(owner);
  const rows = await query(
    `SELECT ci.editionId, ci.quantity, ci.priceAtAdd, e.isbn, e.format, e.listPrice, e.salePrice, e.businessStatus,
            COALESCE(e.coverImageUrl, '/uploads/covers/default.webp') AS coverImageUrl, w.workId, w.title, COALESCE(i.qtyAvailable, 0) AS qtyAvailable
       FROM CartItem ci
       JOIN Edition e ON e.editionId = ci.editionId
       JOIN Work w ON w.workId = e.workId
       LEFT JOIN Inventory i ON i.editionId = e.editionId
      WHERE ${cond} ORDER BY ci.addedAt`,
    [val],
    conn,
  );

  let subtotal = 0;
  const items = rows.map((r) => {
    const price = r.salePrice ?? r.listPrice;
    const issues = [];
    if (r.businessStatus !== 'ON_SALE') issues.push({ code: 'UNAVAILABLE', message: 'Sách không còn bán' });
    else if (r.qtyAvailable <= 0) issues.push({ code: 'OUT_OF_STOCK', message: 'Sách đã hết hàng' });
    else if (r.quantity > r.qtyAvailable) issues.push({ code: 'INSUFFICIENT_STOCK', message: `Chỉ còn ${r.qtyAvailable} cuốn`, available: r.qtyAvailable });
    if (r.priceAtAdd != null && r.priceAtAdd !== price)
      issues.push({ code: 'PRICE_CHANGED', message: 'Giá đã thay đổi', oldPrice: r.priceAtAdd, newPrice: price });
    const purchasable = !issues.some((x) => ['UNAVAILABLE', 'OUT_OF_STOCK', 'INSUFFICIENT_STOCK'].includes(x.code));
    const lineTotal = price * r.quantity;
    if (purchasable) subtotal += lineTotal;
    return {
      editionId: r.editionId,
      workId: r.workId,
      title: r.title,
      isbn: r.isbn,
      format: r.format,
      coverImageUrl: r.coverImageUrl,
      quantity: r.quantity,
      unitPrice: price,
      listPrice: r.listPrice,
      lineTotal,
      purchasable,
      issues,
    };
  });
  return { items, subtotal, itemCount: items.reduce((s, i) => s + i.quantity, 0) };
}

async function loadEdition(conn, editionId) {
  const [e] = await query(
    `SELECT e.editionId, e.businessStatus, e.listPrice, e.salePrice, COALESCE(i.qtyAvailable,0) AS qtyAvailable
       FROM Edition e LEFT JOIN Inventory i ON i.editionId = e.editionId WHERE e.editionId = ?`,
    [editionId],
    conn,
  );
  if (!e || e.businessStatus !== 'ON_SALE') throw notFound('Ấn bản không còn được bán', 'EDITION_NOT_AVAILABLE');
  return e;
}

const lockOwner = (conn, o) => o.customerId && query('SELECT 1 FROM Customer WHERE customerId = ? FOR UPDATE', [o.customerId], conn);

async function setQuantity(conn, owner, edition, quantity) {
  await query(
    `INSERT INTO CartItem (cartItemId, customerId, sessionId, editionId, quantity, priceAtAdd) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), priceAtAdd = VALUES(priceAtAdd)`,
    [uuid(), owner.customerId ?? null, owner.customerId ? null : owner.sessionId, edition.editionId, quantity, edition.salePrice ?? edition.listPrice],
    conn,
  );
}

/** Thêm ấn bản: thêm lại cùng ấn bản thì cộng dồn; kiểm tra ≤ tối đa/dòng và ≤ khả dụng. */
export async function addItem(owner, editionId, qty) {
  const max = await getInt('CART_MAX_QTY_PER_LINE');
  await withTx(async (conn) => {
    const edition = await loadEdition(conn, editionId);
    const [cond, val] = ownerWhere(owner);
    await lockOwner(conn, owner);
    const [cur] = await query(`SELECT quantity FROM CartItem ci WHERE ${cond} AND ci.editionId = ?`, [val, editionId], conn);
    const next = (cur?.quantity ?? 0) + qty;
    if (next > max) throw unprocessable(`Mỗi ấn bản tối đa ${max} cuốn trong giỏ`, 'CART_LINE_LIMIT', { max, current: cur?.quantity ?? 0 });
    if (next > edition.qtyAvailable)
      throw conflict(`Chỉ còn ${edition.qtyAvailable} cuốn trong kho`, 'INSUFFICIENT_STOCK', { available: edition.qtyAvailable });
    await setQuantity(conn, owner, edition, next);
  });
  return getCart(owner);
}

/** Đổi số lượng; vượt giới hạn thì báo lỗi và giữ số lượng hợp lệ gần nhất. */
export async function updateItem(owner, editionId, qty) {
  const max = await getInt('CART_MAX_QTY_PER_LINE');
  await withTx(async (conn) => {
    const edition = await loadEdition(conn, editionId);
    const [cond, val] = ownerWhere(owner);
    await lockOwner(conn, owner);
    const [cur] = await query(`SELECT quantity FROM CartItem ci WHERE ${cond} AND ci.editionId = ?`, [val, editionId], conn);
    if (!cur) throw notFound('Ấn bản không có trong giỏ', 'NOT_IN_CART');
    const allowed = Math.min(max, edition.qtyAvailable);
    if (qty > allowed) throw unprocessable(`Số lượng tối đa có thể đặt là ${allowed}`, 'QUANTITY_EXCEEDED', { allowed, kept: cur.quantity });
    await setQuantity(conn, owner, edition, qty);
  });
  return getCart(owner);
}

export async function removeItem(owner, editionId) {
  const [cond, val] = ownerWhere(owner);
  await query(`DELETE ci FROM CartItem ci WHERE ${cond} AND ci.editionId = ?`, [val, editionId]);
  return getCart(owner);
}

/** Đăng nhập: gộp giỏ khách vãng lai vào giỏ tài khoản (trùng thì cộng dồn, vẫn bị giới hạn/dòng). */
export async function mergeGuestCart(conn, sessionId, customerId) {
  if (!sessionId || !customerId) return;
  const max = await getInt('CART_MAX_QTY_PER_LINE');
  const guestRows = await query('SELECT editionId, quantity, priceAtAdd FROM CartItem WHERE sessionId = ? FOR UPDATE', [sessionId], conn);
  for (const g of guestRows) {
    await query(
      `INSERT INTO CartItem (cartItemId, customerId, sessionId, editionId, quantity, priceAtAdd) VALUES (?,?,NULL,?,LEAST(?,?),?)
       ON DUPLICATE KEY UPDATE quantity = LEAST(quantity + VALUES(quantity), ?)`,
      [uuid(), customerId, g.editionId, g.quantity, max, g.priceAtAdd, max],
      conn,
    );
  }
  await query('DELETE FROM CartItem WHERE sessionId = ?', [sessionId], conn);
}
