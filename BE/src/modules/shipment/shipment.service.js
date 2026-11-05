import { setTimeout as sleep } from 'node:timers/promises';
import { query, withTx } from '../../db.js';
import { config } from '../../config.js';
import { uuid } from '../../utils/security.js';
import { audit } from '../../services/audit.js';
import { getInt } from '../../services/params.js';
import { ghnCall } from '../../services/ghn.js';
import { notifyOrder } from '../../services/notify.js';
import { enqueueEmail } from '../../services/mailer.js';
import { logIntegration } from '../../services/integrationLog.js';
import { AppError, conflict, notFound, unauthorized } from '../../utils/errors.js';
import { buildPackage, loadPackageLines } from '../order/quote.service.js';
import { createRefund, refundAmountForOrder } from '../refund/refund.service.js';
import { releaseDiscountCode } from '../discount/discount.service.js';
import { mapGhnStatus, shouldApply, TERMINAL } from './ghnStatus.js';
import { handleShipmentLoss } from './shipment.loss.js';

const shopHeaders = () => ({ ShopId: String(config.ghn.shopId) });

async function retry(fn) {
  const delays = config.ghn.retryDelaysMs;
  for (let i = 0; ; i++) {
    try {
      return await fn(i);
    } catch (e) {
      if (i >= delays.length) throw e;
      await sleep(delays[i]);
    }
  }
}

export const cancelWaybill = (ghnOrderCode, orderId) =>
  retry(async () => {
    const res = await ghnCall('/v2/switch-status/cancel', {
      headers: shopHeaders(),
      body: { order_codes: [ghnOrderCode], reason_code: 'GHN-CANCEL-OTHER', reason: 'Cửa hàng hủy đơn' },
      referenceId: orderId,
    });
    if ((res ?? []).some((r) => r.result === false)) throw new AppError(409, 'GHN_CANCEL_REJECTED', 'GHN từ chối hủy vận đơn (trạng thái không cho hủy)');
    return res;
  });

export function scheduleShipment(orderId) {
  if (config.ghn.autoCreate) setImmediate(() => ensureShipment(orderId).catch((e) => console.error('[shipment]', orderId, e.message)));
}

async function buildCreateBody(order) {
  const a = order.shippingAddressSnapshot;
  const items = await query(
    `SELECT oi.editionId, oi.quantity, w.title, e.weightGram, e.lengthMm, e.widthMm, e.heightMm
       FROM OrderItem oi JOIN Edition e ON e.editionId = oi.editionId JOIN Work w ON w.workId = e.workId WHERE oi.orderId = ? ORDER BY oi.orderItemId`,
    [order.orderId],
  );
  const pkg = buildPackage(await loadPackageLines(items), await getInt('DEFAULT_PACKAGING_WEIGHT_GRAM'));
  return {
    payment_type_id: 1,
    required_note: 'KHONGCHOXEMHANG',
    client_order_code: order.orderCode,
    to_name: a.receiverName,
    to_phone: a.phone,
    to_address: [a.detail, a.ward, a.district, a.province].filter(Boolean).join(', '),
    to_ward_code: a.ghnWardCode,
    to_district_id: a.ghnDistrictId,
    to_ward_name: a.ward,
    to_district_name: a.district,
    to_province_name: a.province,
    is_new_to_address: false,
    cod_amount: order.paymentMethod === 'COD' ? order.totalAmount : 0,
    content: `Sách đơn ${order.orderCode}`,
    ...pkg,
    insurance_value: Math.min(order.subtotal, 5_000_000),
    service_type_id: config.ghn.serviceTypeId,
    items: items.map((i) => ({ name: i.title.slice(0, 200), quantity: i.quantity, weight: i.weightGram })),
  };
}

export async function ensureShipment(orderId) {
  const claimed = await withTx(async (conn) => {
    const [o] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [orderId], conn);
    if (!o || !['CONFIRMED', 'PACKING'].includes(o.orderStatus)) return null;
    await query(
      `INSERT IGNORE INTO Shipment (shipmentId, orderId, direction, status, codAmount) VALUES (?,?, 'FORWARD', 'CREATED', ?)`,
      [uuid(), orderId, o.paymentMethod === 'COD' ? o.totalAmount : 0],
      conn,
    );
    // lastSyncAt != NULL nghĩa là đã có lần claim trước: tiến trình đó có thể đã tạo vận đơn bên GHN rồi mới chết trước khi ghi DB
    const [prev] = await query(`SELECT lastSyncAt FROM Shipment WHERE orderId = ? AND direction = 'FORWARD' FOR UPDATE`, [orderId], conn);
    const res = await query(
      `UPDATE Shipment SET lastSyncAt = NOW() WHERE orderId = ? AND direction = 'FORWARD' AND ghnOrderCode IS NULL AND status = 'CREATED'
          AND (lastSyncAt IS NULL OR lastSyncAt < NOW() - INTERVAL 1 MINUTE)`,
      [orderId],
      conn,
    );
    return res.affectedRows === 1 ? { order: o, recover: prev?.lastSyncAt != null } : null;
  });
  if (!claimed) return { created: false };
  const { order: claimedOrder, recover } = claimed;

  const body = await buildCreateBody(claimedOrder);
  let data;
  try {
    data = await retry(async (attempt) => {
      // Hỏi GHN trước khi tạo nếu đây là lần thử lại (trong cùng lời gọi) hoặc lần claim lại sau một lần claim trước bị đứt giữa chừng
      // => không tạo trùng vận đơn (và không để lại vận đơn mồ côi tính phí). Vận đơn GHN đã hủy (do ta hủy mồ côi trước đó) thì bỏ qua.
      if (attempt > 0 || recover) {
        const found = await ghnCall('/v2/shipping-order/detail-by-client-code', {
          method: 'GET',
          params: { client_order_code: claimedOrder.orderCode },
          referenceId: orderId,
        }).catch(() => null);
        if (found?.order_code && !['cancel', 'cancelled'].includes(String(found.status ?? '').toLowerCase()))
          return { order_code: found.order_code, total_fee: found.total_fee };
      }
      return ghnCall('/v2/shipping-order/create', { headers: shopHeaders(), body, referenceId: orderId });
    });
  } catch (e) {
    return { created: false, error: e.message };
  }

  const code = data?.order_code;
  if (!code) return { created: false, error: 'GHN không trả về mã vận đơn' };
  const ok = await withTx(async (conn) => {
    // Đơn có thể bị hủy trong lúc chờ GHN: khóa đơn và kiểm tra lại, nếu không còn xử lý thì không gắn vận đơn (bên dưới sẽ hủy vận đơn mồ côi)
    const [cur] = await query('SELECT orderStatus FROM Orders WHERE orderId = ? FOR UPDATE', [orderId], conn);
    if (!cur || !['CONFIRMED', 'PACKING'].includes(cur.orderStatus)) {
      await query(
        `UPDATE Shipment SET status = 'CANCELLED' WHERE orderId = ? AND direction = 'FORWARD' AND status = 'CREATED' AND ghnOrderCode IS NULL`,
        [orderId],
        conn,
      );
      return false;
    }
    const res = await query(
      `UPDATE Shipment SET ghnOrderCode = ?, status = 'WAITING_PICKUP', shippingFee = ? WHERE orderId = ? AND direction = 'FORWARD' AND status = 'CREATED'`,
      [code, Number.isFinite(Number(data.total_fee)) ? Math.round(Number(data.total_fee)) : null, orderId],
      conn,
    );
    if (res.affectedRows === 1)
      await query(`UPDATE Orders SET shippingStatus = 'WAITING_PICKUP' WHERE orderId = ? AND shippingStatus = 'NOT_CREATED'`, [orderId], conn);
    return res.affectedRows === 1;
  });
  if (!ok) await cancelWaybill(code, orderId).catch((e) => console.error('[shipment] không hủy được vận đơn mồ côi', code, e.message));
  return { created: ok, ghnOrderCode: code };
}

export async function retryPendingShipments() {
  const rows = await query(
    `SELECT o.orderId FROM Orders o LEFT JOIN Shipment s ON s.orderId = o.orderId AND s.direction = 'FORWARD'
      WHERE o.orderStatus IN ('CONFIRMED','PACKING') AND (s.shipmentId IS NULL OR (s.ghnOrderCode IS NULL AND s.status = 'CREATED'))
      ORDER BY o.confirmedAt LIMIT 50`,
  );
  for (const r of rows) await ensureShipment(r.orderId).catch((e) => console.error('[job:shipments]', r.orderId, e.message));
  return { tried: rows.length };
}

async function handover(conn, order, ship) {
  const res = await query('UPDATE Shipment SET pickedUpAt = NOW() WHERE shipmentId = ? AND pickedUpAt IS NULL', [ship.shipmentId], conn);
  if (res.affectedRows !== 1) return;
  if (order.stockRestoredAt) {
    await query(
      `INSERT INTO ExceptionItem (exceptionId, type, refType, refId, detail, dueAt, autoCloseAt) VALUES (?, 'GHN_CLAIM_FAILED', 'ORDER', ?, 'GHN lấy hàng của đơn đã hủy', NOW() + INTERVAL 3 DAY, NOW() + INTERVAL 30 DAY)`,
      [uuid(), order.orderId],
      conn,
    );
    return;
  }
  const items = await query(
    `SELECT oi.orderItemId, oi.editionId, oi.quantity, e.costPrice FROM OrderItem oi JOIN Edition e ON e.editionId = oi.editionId WHERE oi.orderId = ? ORDER BY oi.editionId`,
    [order.orderId],
    conn,
  );
  for (const it of items) {
    await query('SELECT editionId FROM Inventory WHERE editionId = ? FOR UPDATE', [it.editionId], conn);
    await query(
      'UPDATE Inventory SET qtyOnHand = qtyOnHand - ?, qtyReserved = qtyReserved - ? WHERE editionId = ?',
      [it.quantity, it.quantity, it.editionId],
      conn,
    );
    const [{ qtyOnHand }] = await query('SELECT qtyOnHand FROM Inventory WHERE editionId = ?', [it.editionId], conn);
    await query(
      `INSERT INTO StockMovement (movementId, editionId, movementType, quantity, qtyAfter, referenceType, referenceId, reason) VALUES (?,?, 'SALE', ?,?, 'ORDER', ?, 'GHN lấy hàng')`,
      [uuid(), it.editionId, -it.quantity, qtyOnHand, order.orderId],
      conn,
    );
    await query('UPDATE OrderItem SET costPrice = ? WHERE orderItemId = ?', [it.costPrice, it.orderItemId], conn);
  }
}

async function complete(conn, order) {
  if (!['CONFIRMED', 'PACKING'].includes(order.orderStatus)) return;
  const cod = order.paymentMethod === 'COD';
  await query(
    `UPDATE Orders SET orderStatus='COMPLETED', deliveredAt=NOW(), completedAt=NOW(), paymentStatus = ? WHERE orderId = ?`,
    [cod ? 'COD_COLLECTED' : order.paymentStatus, order.orderId],
    conn,
  );
  if (cod)
    await query(
      `INSERT IGNORE INTO PaymentTransaction (transactionId, orderId, provider, providerTxnId, amount, status) VALUES (?,?, 'COD', ?, ?, 'SUCCESS')`,
      [uuid(), order.orderId, order.orderId, order.totalAmount],
      conn,
    );
  await notifyOrder(conn, order, 'COMPLETED');
}

/** Thời điểm GHN ghi nhận trạng thái hiện tại (log khớp trạng thái, rồi updated_date); không có/không hợp lệ thì dùng giờ hiện tại. */
export function ghnEventTime(detail, now = new Date()) {
  const log = Array.isArray(detail?.log) ? detail.log.filter((l) => l?.status === detail.status && l.updated_date) : [];
  const raw = log.length ? log[log.length - 1].updated_date : detail?.updated_date;
  const t = raw ? new Date(raw) : null;
  return t && !Number.isNaN(t.getTime()) && t.getTime() <= now.getTime() ? t : now;
}

/**
 * GHN báo vận đơn bị hủy trong khi đơn của ta vẫn đang xử lý (hủy từ cổng GHN, không phải do API hủy đơn của ta — hủy của ta
 * đã đặt Shipment = CANCELLED trước nên không vào đây). Không tự tạo lại vận đơn (cần kiểm chứng GHN có cho trùng
 * client_order_code không): ghi ngoại lệ + báo nhân viên để hủy đơn hoặc xử lý tay.
 */
async function handleExternalCancel(conn, order) {
  if (!['CONFIRMED', 'PACKING'].includes(order.orderStatus)) return;
  await query(
    `INSERT INTO ExceptionItem (exceptionId, type, refType, refId, detail, dueAt, autoCloseAt) VALUES (?, 'GHN_CANCELLED', 'ORDER', ?, ?, NOW() + INTERVAL 3 DAY, NOW() + INTERVAL 30 DAY)`,
    [uuid(), order.orderId, `GHN đã hủy vận đơn của đơn ${order.orderCode} trong khi đơn còn đang xử lý`],
    conn,
  );
  await audit(conn, { action: 'GHN_CANCELLED', entityType: 'ORDER', entityId: order.orderId, reason: 'GHN hủy vận đơn từ phía GHN' });
  const staff = await query(`SELECT accountId, email FROM Account WHERE role IN ('STAFF','ADMIN') AND status = 'ACTIVE'`, [], conn);
  for (const r of staff)
    await enqueueEmail(conn, {
      dedupeKey: `ghn-cancelled:${order.orderId}:${r.accountId}`,
      to: r.email,
      subject: `GHN đã hủy vận đơn của đơn ${order.orderCode}`,
      body: `Vận đơn GHN của đơn ${order.orderCode} bị hủy từ phía GHN nhưng đơn vẫn đang xử lý. Vui lòng kiểm tra và hủy đơn (hoàn tiền nếu đã thanh toán) hoặc xử lý với GHN.`,
    });
}

async function applyGhnStatus(shipmentId, ghnStatus, eventAt = new Date()) {
  const next = mapGhnStatus(ghnStatus);
  if (!next) return { applied: false, reason: 'UNKNOWN_STATUS' };
  return withTx(async (conn) => {
    const [pre] = await query('SELECT orderId FROM Shipment WHERE shipmentId = ?', [shipmentId], conn);
    if (!pre) throw notFound('Không tìm thấy vận đơn');
    const [order] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [pre.orderId], conn);
    const [ship] = await query('SELECT * FROM Shipment WHERE shipmentId = ? FOR UPDATE', [shipmentId], conn);
    if (!shouldApply({ current: ship.status, next, lastEventAt: ship.lastGhnEventAt, eventAt })) {
      await query('UPDATE Shipment SET lastSyncAt = NOW() WHERE shipmentId = ?', [shipmentId], conn);
      return { applied: false, reason: 'STALE' };
    }
    await query(
      'UPDATE Shipment SET status = ?, lastGhnStatus = ?, lastGhnEventAt = ?, lastSyncAt = NOW() WHERE shipmentId = ?',
      [next, String(ghnStatus).slice(0, 50), eventAt, shipmentId],
      conn,
    );
    if (next !== ship.status || !ship.lastGhnEventAt) await query('UPDATE Orders SET shippingStatus = ? WHERE orderId = ?', [next, order.orderId], conn);
    if (ship.direction !== 'FORWARD') return { applied: true, status: next };

    if (['DELIVERING', 'FAILED', 'RETURNING', 'RETURNED', 'DELIVERED', 'LOST', 'DAMAGED'].includes(next)) await handover(conn, order, ship);
    if (next === 'DELIVERING') await notifyOrder(conn, order, 'DELIVERING');
    if (next === 'FAILED') await notifyOrder(conn, order, 'DELIVERY_FAILED', { dedupe: String(eventAt.getTime()) });
    if (next === 'RETURNING') await notifyOrder(conn, order, 'RETURNING');
    if (next === 'DELIVERED') await complete(conn, order);
    if (next === 'CANCELLED') await handleExternalCancel(conn, order);
    if (next === 'LOST' || next === 'DAMAGED') await handleShipmentLoss(conn, order, next);
    if (next === 'RETURNED' && ['CONFIRMED', 'PACKING'].includes(order.orderStatus))
      await query(`UPDATE Orders SET orderStatus='RETURNED' WHERE orderId=?`, [order.orderId], conn);
    return { applied: true, status: next };
  });
}

export async function handleGhnWebhook(token, body) {
  const rec = { provider: 'GHN', direction: 'IN', endpoint: 'POST /api/webhooks/ghn', request: JSON.stringify(body) };
  try {
    if (!config.ghn.webhookToken) throw new AppError(503, 'GHN_WEBHOOK_NOT_CONFIGURED', 'Chưa cấu hình GHN_WEBHOOK_TOKEN');
    if (token !== config.ghn.webhookToken) throw unauthorized('Token webhook không hợp lệ', 'INVALID_WEBHOOK_TOKEN');
    const code = body?.OrderCode ?? body?.order_code;
    const status = body?.Status ?? body?.status;
    if (!code || !status) throw new AppError(400, 'BAD_PAYLOAD', 'Payload không hợp lệ');
    const [ship] = await query('SELECT shipmentId FROM Shipment WHERE ghnOrderCode = ?', [String(code)]);
    if (!ship) {
      await logIntegration({ ...rec, response: 'unknown order', status: 200, success: true });
      return { applied: false, reason: 'UNKNOWN_ORDER' };
    }
    const t = body.Time ? new Date(body.Time) : new Date();
    const r = await applyGhnStatus(ship.shipmentId, status, Number.isNaN(t.getTime()) ? new Date() : t);
    await logIntegration({ ...rec, response: JSON.stringify(r), status: 200, success: true, referenceId: ship.shipmentId });
    return r;
  } catch (e) {
    await logIntegration({ ...rec, response: e.message, status: e.status ?? 500, success: false });
    throw e;
  }
}

export async function syncShipments() {
  const stale = await getInt('GHN_SYNC_STALE_MINUTES');
  const rows = await query(
    `SELECT shipmentId, ghnOrderCode FROM Shipment WHERE ghnOrderCode IS NOT NULL AND status NOT IN (${TERMINAL.map(() => '?').join(',')})
        AND (lastSyncAt IS NULL OR lastSyncAt < NOW() - INTERVAL ? MINUTE) ORDER BY lastSyncAt LIMIT 100`,
    [...TERMINAL, stale],
  );
  let synced = 0;
  for (const r of rows) {
    try {
      const d = await ghnCall('/v2/shipping-order/detail', {
        method: 'GET',
        params: { order_code: r.ghnOrderCode },
        referenceId: r.shipmentId,
        log: false,
      });
      if (d?.status) {
        await applyGhnStatus(r.shipmentId, d.status, ghnEventTime(d));
        synced++;
      }
    } catch (e) {
      console.error('[job:ghn-sync]', r.ghnOrderCode, e.message);
    }
  }
  return { synced };
}

export async function scanPacking(actor, orderId, isbns) {
  return withTx(async (conn) => {
    const [o] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [orderId], conn);
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    if (!['CONFIRMED', 'PACKING'].includes(o.orderStatus))
      throw conflict('Đơn hàng không ở trạng thái đóng gói', 'ORDER_NOT_PACKABLE', { orderStatus: o.orderStatus });
    const items = await query(
      'SELECT e.isbn, oi.quantity FROM OrderItem oi JOIN Edition e ON e.editionId = oi.editionId WHERE oi.orderId = ?',
      [orderId],
      conn,
    );
    const scanned = new Map();
    for (const i of isbns) scanned.set(i, (scanned.get(i) ?? 0) + 1);
    const lines = items.map((i) => ({ isbn: i.isbn, expected: i.quantity, scanned: scanned.get(i.isbn) ?? 0 }));
    const unexpected = [...scanned.keys()].filter((k) => !items.some((i) => i.isbn === k));
    const complete = !unexpected.length && lines.every((l) => l.scanned === l.expected);
    if (o.orderStatus === 'CONFIRMED' && lines.some((l) => l.scanned > 0)) {
      await query(`UPDATE Orders SET orderStatus = 'PACKING' WHERE orderId = ?`, [orderId], conn);
      await audit(conn, { actorId: actor.accountId, action: 'START_PACKING', entityType: 'ORDER', entityId: orderId });
      await notifyOrder(conn, o, 'PACKING');
    }
    return { complete, lines, unexpected };
  });
}

export async function confirmReturnedToWarehouse(actor, orderId) {
  return withTx(async (conn) => {
    const [o] = await query('SELECT * FROM Orders WHERE orderId = ? FOR UPDATE', [orderId], conn);
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    if (o.orderStatus !== 'RETURNED') throw conflict('Đơn hàng chưa hoàn về', 'ORDER_NOT_RETURNED', { orderStatus: o.orderStatus });
    const items = await query('SELECT editionId, quantity FROM OrderItem WHERE orderId = ? ORDER BY editionId', [orderId], conn);
    for (const it of items) {
      await query('UPDATE Inventory SET qtyPendingInspection = qtyPendingInspection + ? WHERE editionId = ?', [it.quantity, it.editionId], conn);
      const [{ qtyOnHand }] = await query('SELECT qtyOnHand FROM Inventory WHERE editionId = ?', [it.editionId], conn);
      await query(
        `INSERT INTO StockMovement (movementId, editionId, movementType, quantity, qtyAfter, referenceType, referenceId, reason, performedBy) VALUES (?,?, 'RETURN_TO_WAREHOUSE', ?,?, 'ORDER', ?, 'Hàng hoàn về, chờ kiểm', ?)`,
        [uuid(), it.editionId, it.quantity, qtyOnHand, orderId, actor?.staffId ?? null],
        conn,
      );
    }
    let refund = false;
    const txn = o.paymentStatus === 'PAID' ? await refundAmountForOrder(conn, orderId) : null;
    if (txn) {
      await createRefund(conn, { order: o, transactionId: txn.transactionId, source: 'RETURNED_TO_WAREHOUSE', amount: txn.amount });
      refund = true;
    }
    await query(
      `UPDATE Orders SET orderStatus='RETURNED_TO_WAREHOUSE', completedAt=NOW(), paymentStatus = ? WHERE orderId=?`,
      [refund ? 'REFUND_PENDING' : o.paymentStatus, orderId],
      conn,
    );
    await releaseDiscountCode(conn, orderId); // hàng đã về kho: trả lượt mã (đúng một lần nhờ discountReturnedAt)
    await notifyOrder(conn, o, 'RETURNED', { refund });
    await audit(conn, {
      actorId: actor?.accountId ?? null,
      action: 'RETURNED_TO_WAREHOUSE',
      entityType: 'ORDER',
      entityId: orderId,
      reason: actor ? null : 'Tự động sau thời hạn',
    });
    return { orderId, orderStatus: 'RETURNED_TO_WAREHOUSE', refundPending: refund };
  });
}

export async function autoReceiveReturned() {
  const days = await getInt('RETURNED_AUTO_RECEIVE_DAYS');
  const rows = await query(
    `SELECT o.orderId FROM Orders o JOIN Shipment s ON s.orderId = o.orderId AND s.direction = 'FORWARD'
      WHERE o.orderStatus = 'RETURNED' AND s.updatedAt < NOW() - INTERVAL ? DAY LIMIT 100`,
    [days],
  );
  for (const r of rows) await confirmReturnedToWarehouse(null, r.orderId).catch((e) => console.error('[job:auto-receive]', r.orderId, e.message));
  return { received: rows.length };
}
