import { query } from '../db.js';
import { getInt } from '../services/params.js';
import { processOutbox } from '../services/mailer.js';
import { config } from '../config.js';
import { syncGhnCatalog } from '../modules/geo/geo.service.js';
import { applyPromotions } from '../modules/promotion/promotion.service.js';
import { expireDiscountCodes } from '../modules/discount/discount.service.js';
import { expireUnpaidOrders } from '../modules/order/order.service.js';
import { retryPendingShipments, syncShipments, autoReceiveReturned } from '../modules/shipment/shipment.service.js';
import {
  recomputeStockLevels,
  createAutoPurchaseOrders,
  autoClosePurchaseOrders,
  cancelStaleVoucherDrafts,
  sendLowStockDigest,
} from '../modules/inventory/inventory.jobs.js';

/** Dọn dẹp định kỳ theo tham số: tài khoản chưa xác thực, giỏ hàng quá hạn, phiên hết hạn, token cũ. */
async function cleanup() {
  const unverifiedDays = await getInt('UNVERIFIED_ACCOUNT_TTL_DAYS');
  const guestDays = await getInt('GUEST_CART_TTL_DAYS');
  const memberDays = await getInt('MEMBER_CART_TTL_DAYS');

  const stale = `SELECT accountId FROM Account WHERE status='UNVERIFIED' AND role='CUSTOMER' AND createdAt < NOW() - INTERVAL ? DAY`;
  await query(`DELETE FROM AuthToken WHERE accountId IN (${stale})`, [unverifiedDays]);
  await query(`DELETE FROM UserSession WHERE accountId IN (${stale})`, [unverifiedDays]);
  await query(`DELETE FROM Customer WHERE accountId IN (${stale})`, [unverifiedDays]);
  await query(`DELETE FROM Account WHERE status='UNVERIFIED' AND role='CUSTOMER' AND createdAt < NOW() - INTERVAL ? DAY`, [unverifiedDays]);

  await query(`DELETE FROM CartItem WHERE customerId IS NULL AND updatedAt < NOW() - INTERVAL ? DAY`, [guestDays]);
  await query(
    `DELETE ci FROM CartItem ci
                 JOIN (SELECT customerId FROM CartItem WHERE customerId IS NOT NULL GROUP BY customerId
                       HAVING MAX(updatedAt) < NOW() - INTERVAL ? DAY) x ON x.customerId = ci.customerId`,
    [memberDays],
  );

  await query(`DELETE FROM UserSession WHERE expiresAt < NOW() - INTERVAL 7 DAY OR revokedAt < NOW() - INTERVAL 7 DAY`);
  await query(`DELETE FROM AuthToken WHERE expiresAt < NOW() - INTERVAL 7 DAY`);
  await query(`DELETE FROM LoginAttempt WHERE updatedAt < NOW() - INTERVAL 1 DAY`);
}

export function startJobs() {
  const safe = (name, fn) => () => fn().catch((e) => console.error(`[job:${name}]`, e.message));
  const timers = [
    setInterval(safe('outbox', processOutbox), 15_000),
    setInterval(safe('cleanup', cleanup), 60 * 60_000),
    // Danh mục địa giới GHN: mỗi 24 giờ (chỉ khi đã cấu hình token)
    ...(config.ghn.token
      ? [
          setInterval(
            safe('ghn-catalog', () => syncGhnCatalog()),
            24 * 60 * 60_000,
          ),
        ]
      : []),
    // Khuyến mãi: áp dụng khi đến giờ, gỡ khi hết hạn, mã giảm giá hết hạn (mỗi phút)
    setInterval(
      safe('promotions', async () => {
        await applyPromotions();
        await expireDiscountCodes();
      }),
      60_000,
    ),
    // Đơn thanh toán trực tuyến quá hạn: hủy + trả hàng giữ + trả lượt mã (mỗi phút)
    setInterval(safe('expire-orders', expireUnpaidOrders), 60_000),
    // GHN_AUTO_CREATE=0 => không tự tạo vận đơn (kể cả job thử lại); nhân viên vẫn tạo tay qua POST /api/staff/orders/:id/shipment
    ...(config.ghn.token && config.ghn.autoCreate ? [setInterval(safe('shipments-retry', retryPendingShipments), 60_000)] : []),
    ...(config.ghn.token ? [setInterval(safe('shipments-sync', syncShipments), 5 * 60_000)] : []),
    setInterval(safe('returned-auto', autoReceiveReturned), 60 * 60_000),
    // Kho: tính lại tồn tối thiểu -> tự tạo phiếu đặt hàng -> dọn phiếu quá hạn -> email tóm tắt (mỗi giờ; email chỉ gửi một lần/ngày nhờ dedupeKey)
    setInterval(
      safe('inventory', async () => {
        await recomputeStockLevels();
        await createAutoPurchaseOrders();
        await autoClosePurchaseOrders();
        await cancelStaleVoucherDrafts();
        await sendLowStockDigest();
      }),
      60 * 60_000,
    ),
  ];
  return () => timers.forEach(clearInterval);
}
