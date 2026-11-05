import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as svc from './refund.service.js';
import { refundViaVnpay } from '../payment/vnpay.service.js';

export const refundAdminRouter = Router();
refundAdminRouter.use(requireRole('ADMIN'));
refundAdminRouter.get(
  '/',
  validate(
    z.object({
      status: z.enum(['AWAITING_ACCOUNT', 'AWAITING_APPROVAL', 'PROCESSING_BANK', 'PAYOUT_CREATED', 'TRANSFERRED', 'FAILED', 'REFUNDED']).optional(),
      page: z.coerce.number().int().min(1).default(1),
    }),
    'query',
  ),
  json((req) => svc.listRefunds(req.valid.query)),
);
refundAdminRouter.post(
  '/:refundId/complete',
  validate(z.object({ refundId: z.string().uuid() }), 'params'),
  validate(z.object({ bankTxnRef: z.string().trim().min(1).max(100), note: z.string().trim().max(255).optional() })),
  json((req) => svc.completeRefund(req.user, req.valid.params.refundId, req.valid.body)),
);
refundAdminRouter.post(
  '/:refundId/vnpay',
  validate(z.object({ refundId: z.string().uuid() }), 'params'),
  json((req) => refundViaVnpay(req.user, req.valid.params.refundId, req.ip)),
);
