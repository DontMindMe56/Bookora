import { query } from '../../db.js';
import { escapeLike, nameLike, foldD, accentPattern } from '../../utils/text.js';
import { AppError, notFound } from '../../utils/errors.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const CUSTOMER_PAGE = 10;
const STAFF_PAGE = 20;

// ---------------------------------------------------------------------------
// Tra cứu
// ---------------------------------------------------------------------------

const publicOrder = (o, staff) => {
  const { idempotencyKey, stockRestoredAt, discountReturnedAt, ...rest } = o;
  if (!staff) {
    delete rest.customerId;
    delete rest.customerName;
    delete rest.customerEmail;
  }
  return rest;
};

/** Chi tiết đơn. Truyền customerId để chỉ cho xem đơn của chính mình (đơn của người khác => 404). */
export async function getOrder(orderId, { customerId, staff = false } = {}, conn) {
  const [o] = await query(
    `SELECT o.*, dc.code AS discountCode, c.fullName AS customerName, a.email AS customerEmail
       FROM Orders o JOIN Customer c ON c.customerId = o.customerId JOIN Account a ON a.accountId = c.accountId
       LEFT JOIN DiscountCode dc ON dc.discountCodeId = o.discountCodeId
      WHERE o.orderId = ? ${customerId ? 'AND o.customerId = ?' : ''}`,
    customerId ? [orderId, customerId] : [orderId],
    conn,
  );
  if (!o) throw notFound('Không tìm thấy đơn hàng');
  const items = await query(
    `SELECT oi.editionId, oi.quantity, oi.unitPrice, oi.lineTotal, e.isbn, COALESCE(e.coverImageUrl, '/uploads/covers/default.webp') AS coverImageUrl, w.workId, w.title
       FROM OrderItem oi JOIN Edition e ON e.editionId = oi.editionId JOIN Work w ON w.workId = e.workId
      WHERE oi.orderId = ? ORDER BY w.title, oi.orderItemId`,
    [orderId],
    conn,
  );
  const shipments = await query(`SELECT direction, status, ghnOrderCode, createdAt FROM Shipment WHERE orderId = ? ORDER BY createdAt`, [orderId], conn);
  return { ...publicOrder(o, staff), items, shipments };
}

export async function listMyOrders(customerId, { status, page }) {
  const where = ['o.customerId = ?'],
    params = [customerId];
  if (status) {
    where.push('o.orderStatus = ?');
    params.push(status);
  }
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM Orders o WHERE ${where.join(' AND ')}`, params);
  const items = await query(
    `SELECT o.orderId, o.orderCode, o.orderStatus, o.paymentStatus, o.shippingStatus, o.paymentMethod, o.totalAmount, o.paymentExpiresAt, o.createdAt,
            (SELECT COALESCE(SUM(oi.quantity), 0) FROM OrderItem oi WHERE oi.orderId = o.orderId) AS itemCount,
            (SELECT w.title FROM OrderItem oi JOIN Edition e ON e.editionId = oi.editionId JOIN Work w ON w.workId = e.workId
              WHERE oi.orderId = o.orderId ORDER BY oi.orderItemId LIMIT 1) AS firstTitle
       FROM Orders o WHERE ${where.join(' AND ')} ORDER BY o.createdAt DESC, o.orderId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, CUSTOMER_PAGE)],
  );
  return paged(items, total, page, CUSTOMER_PAGE);
}

const ci = (expr) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_0900_ai_ci`; // JSON_UNQUOTE trả về utf8mb4_bin: ép lại để tìm không phân biệt hoa thường/dấu

/** Nhân viên: tìm theo mã đơn, SĐT / tên người nhận, tên khách, mã vận đơn; lọc theo trạng thái. */
export async function searchOrders({ q, status, paymentStatus, shippingStatus, page }) {
  const where = [],
    params = [];
  if (status) {
    where.push('o.orderStatus = ?');
    params.push(status);
  }
  if (paymentStatus) {
    where.push('o.paymentStatus = ?');
    params.push(paymentStatus);
  }
  if (shippingStatus) {
    where.push('o.shippingStatus = ?');
    params.push(shippingStatus);
  }
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const name = nameLike(['c.fullName'], q);
    where.push(`(o.orderCode LIKE ? OR ${name.sql}
                 OR ${ci("JSON_UNQUOTE(JSON_EXTRACT(o.shippingAddressSnapshot, '$.phone'))")} LIKE ?
                 OR ${foldD(ci("JSON_UNQUOTE(JSON_EXTRACT(o.shippingAddressSnapshot, '$.receiverName'))"))} LIKE ?
                 OR EXISTS (SELECT 1 FROM Shipment s WHERE s.orderId = o.orderId AND s.ghnOrderCode LIKE ?))`);
    params.push(`%${escapeLike(q.toUpperCase())}%`, ...name.params, like, accentPattern(q), like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM Orders o JOIN Customer c ON c.customerId = o.customerId';
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from} ${w}`, params);
  const items = await query(
    `SELECT o.orderId, o.orderCode, o.orderStatus, o.paymentStatus, o.shippingStatus, o.paymentMethod, o.totalAmount, o.createdAt, o.confirmedAt,
            c.fullName AS customerName,
            JSON_UNQUOTE(JSON_EXTRACT(o.shippingAddressSnapshot, '$.receiverName')) AS receiverName,
            JSON_UNQUOTE(JSON_EXTRACT(o.shippingAddressSnapshot, '$.phone')) AS receiverPhone,
            (SELECT s.ghnOrderCode FROM Shipment s WHERE s.orderId = o.orderId AND s.direction = 'FORWARD') AS ghnOrderCode
       ${from} ${w} ORDER BY o.createdAt DESC, o.orderId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(page, STAFF_PAGE)],
  );
  return paged(items, total, page, STAFF_PAGE);
}

/** Dữ liệu in lại phiếu đóng gói (frontend tự dàn trang in). Tiền thu hộ = tổng đơn nếu COD, 0 nếu đã/đang thanh toán trực tuyến. */
export async function packingSlip(orderId) {
  const o = await getOrder(orderId, { staff: true });
  if (!['CONFIRMED', 'PACKING', 'COMPLETED'].includes(o.orderStatus)) {
    throw new AppError(409, 'ORDER_NOT_PACKABLE', 'Đơn hàng chưa được xác nhận nên chưa có phiếu đóng gói');
  }
  return {
    orderCode: o.orderCode,
    createdAt: o.createdAt,
    note: o.note,
    receiver: {
      name: o.shippingAddressSnapshot.receiverName,
      phone: o.shippingAddressSnapshot.phone,
      address: [o.shippingAddressSnapshot.detail, o.shippingAddressSnapshot.ward, o.shippingAddressSnapshot.district, o.shippingAddressSnapshot.province]
        .filter(Boolean)
        .join(', '),
    },
    items: o.items.map((i) => ({ isbn: i.isbn, title: i.title, quantity: i.quantity })),
    codAmount: o.paymentMethod === 'COD' ? o.totalAmount : 0,
    ghnOrderCode: o.shipments.find((s) => s.direction === 'FORWARD')?.ghnOrderCode ?? null,
  };
}
