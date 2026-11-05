import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as svc from './wishlist.service.js';

const editionId = z.string().uuid();
export const wishlistRouter = Router();
wishlistRouter.use(requireCustomer); // yêu cầu đăng nhập (khách vãng lai nhận 401)
wishlistRouter.get(
  '/',
  json((req) => svc.getWishlist(req.user.customerId)),
);
wishlistRouter.post(
  '/',
  validate(z.object({ editionId })),
  json((req) => svc.addToWishlist(req.user.customerId, req.valid.body.editionId), 201),
);
wishlistRouter.delete(
  '/:editionId',
  validate(z.object({ editionId }), 'params'),
  json((req) => svc.removeFromWishlist(req.user.customerId, req.valid.params.editionId)),
);
