import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import * as svc from './shipment.service.js';
import { idParam } from '../../utils/schemas.js';

export const ghnWebhookRouter = Router();
ghnWebhookRouter.post(
  '/ghn',
  asyncHandler(async (req, res) => {
    await svc.handleGhnWebhook(req.query.token ?? req.get('x-webhook-token'), req.body);
    res.json({ success: true });
  }),
);

const orderParam = validate(idParam('orderId'), 'params');
export const staffShipmentRouter = Router();
staffShipmentRouter.use(requireRole('STAFF', 'ADMIN'));
staffShipmentRouter.post(
  '/:orderId/packing',
  orderParam,
  validate(z.object({ isbns: z.array(z.string().trim().min(10).max(20)).min(1).max(200) })),
  json((req) => svc.scanPacking(req.user, req.valid.params.orderId, req.valid.body.isbns)),
);
staffShipmentRouter.post(
  '/:orderId/shipment',
  orderParam,
  json((req) => svc.ensureShipment(req.valid.params.orderId)),
);
staffShipmentRouter.post(
  '/:orderId/returned-received',
  orderParam,
  json((req) => svc.confirmReturnedToWarehouse(req.user, req.valid.params.orderId)),
);
