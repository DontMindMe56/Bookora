import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import * as svc from './payment.service.js';
import * as vnpay from './vnpay.service.js';

export const orderPaymentRouter = Router();
orderPaymentRouter.get(
  '/:orderId/payment',
  requireCustomer,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  json((req) => svc.paymentInfo(req.user.customerId, req.valid.params.orderId)),
);

orderPaymentRouter.post(
  '/:orderId/vnpay',
  requireCustomer,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  json((req) => vnpay.createVnpayPayment(req.user.customerId, req.valid.params.orderId, req.ip), 201),
);

export const vnpayWebhookRouter = Router();
vnpayWebhookRouter.get(
  '/vnpay/ipn',
  asyncHandler(async (req, res) => res.json(await vnpay.handleVnpayIpn(req.query))),
);
vnpayWebhookRouter.get(
  '/vnpay/return',
  json((req) => vnpay.vnpayReturn(req.query)),
);

export const sepayWebhookRouter = Router();
sepayWebhookRouter.post(
  '/sepay',
  asyncHandler(async (req, res) => {
    await svc.sepayWebhook(req);
    res.json({ success: true });
  }),
);
