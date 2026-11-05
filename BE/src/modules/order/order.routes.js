import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import { badRequest } from '../../utils/errors.js';
import { buildQuote, PAYMENT_METHODS } from './quote.service.js';
import * as svc from './order.service.js';
import * as read from './order.query.js';
import { staffShipmentRouter } from '../shipment/shipment.routes.js';
import { page, phone, idParam } from '../../utils/schemas.js';

const ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RETURNED', 'RETURNED_TO_WAREHOUSE'];
const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'COD_COLLECTED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED'];
const SHIPPING_STATUSES = ['NOT_CREATED', 'WAITING_PICKUP', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETURNING', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED'];

const discountCode = z.string().trim().min(1).max(30);
const orderParam = idParam('orderId');
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._-]{8,64}$/;

const quoteBody = z.object({ addressId: z.string().uuid(), phone: phone.optional(), discountCode: discountCode.optional() });
const createBody = quoteBody.extend({
  paymentMethod: z.enum(PAYMENT_METHODS),
  expectedTotal: z.number().int().min(0), // tổng khách đã thấy ở bước báo giá
  note: z.string().trim().max(500).optional(),
});

// ---- Khách hàng: báo giá (POST /api/checkout/quote) ----
export const checkoutRouter = Router();
checkoutRouter.use(requireCustomer);
checkoutRouter.post(
  '/quote',
  validate(quoteBody),
  json((req) => buildQuote(req.user.customerId, req.valid.body)),
);

// ---- Khách hàng: đơn hàng (/api/orders) ----
export const orderRouter = Router();
orderRouter.use(requireCustomer);

/** Header `Idempotency-Key` (8–64 ký tự) bắt buộc: gửi lại cùng khóa trả về đúng đơn đã tạo (200), không tạo đơn thứ hai. */
orderRouter.post(
  '/',
  validate(createBody),
  asyncHandler(async (req, res) => {
    const key = req.get('idempotency-key');
    if (!key || !IDEMPOTENCY_KEY.test(key)) throw badRequest('Thiếu hoặc sai header Idempotency-Key (8–64 ký tự chữ, số, . _ -)', 'IDEMPOTENCY_KEY_REQUIRED');
    const { order, created } = await svc.createOrder(req.user.customerId, { ...req.valid.body, idempotencyKey: key });
    res.status(created ? 201 : 200).json({ ...order, replayed: !created });
  }),
);
orderRouter.get(
  '/',
  validate(z.object({ status: z.enum(ORDER_STATUSES).optional(), page }), 'query'),
  json((req) => read.listMyOrders(req.user.customerId, req.valid.query)),
);
orderRouter.get(
  '/:orderId',
  validate(orderParam, 'params'),
  json((req) => read.getOrder(req.valid.params.orderId, { customerId: req.user.customerId })),
);
orderRouter.post(
  '/:orderId/cancel',
  validate(orderParam, 'params'),
  validate(z.object({ reason: z.string().trim().min(1).max(255).optional() })),
  json((req) => svc.cancelOrder(req.valid.params.orderId, { customerId: req.user.customerId }, req.valid.body.reason)),
);

// ---- Nhân viên / quản trị viên (/api/staff/orders) ----
export const staffOrderRouter = Router();
staffOrderRouter.use(requireRole('STAFF', 'ADMIN'));
staffOrderRouter.get(
  '/',
  validate(
    z.object({
      q: z.string().trim().min(1).max(100).optional(),
      status: z.enum(ORDER_STATUSES).optional(),
      paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
      shippingStatus: z.enum(SHIPPING_STATUSES).optional(),
      page,
    }),
    'query',
  ),
  json((req) => read.searchOrders(req.valid.query)),
);
staffOrderRouter.get(
  '/:orderId',
  validate(orderParam, 'params'),
  json((req) => read.getOrder(req.valid.params.orderId, { staff: true })),
);
staffOrderRouter.get(
  '/:orderId/packing-slip',
  validate(orderParam, 'params'),
  json((req) => read.packingSlip(req.valid.params.orderId)),
);
staffOrderRouter.post(
  '/:orderId/cancel',
  validate(orderParam, 'params'),
  validate(z.object({ reason: z.string().trim().min(3).max(255) })),
  json((req) => svc.cancelOrder(req.valid.params.orderId, { accountId: req.user.accountId, staff: true }, req.valid.body.reason)),
);
staffOrderRouter.use(staffShipmentRouter);
