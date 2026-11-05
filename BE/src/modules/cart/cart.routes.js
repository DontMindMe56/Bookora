import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import { uuid } from '../../utils/security.js';
import { config } from '../../config.js';
import * as cart from './cart.service.js';

export const CART_COOKIE = 'cart_sid';
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

/** Thành viên: giỏ theo customerId. Khách vãng lai: giỏ theo cookie phiên trình duyệt (giữ 30 ngày). */
const resolveOwner = (req, res, next) => {
  if (req.user?.customerId) {
    req.owner = { customerId: req.user.customerId };
    return next();
  }
  let sid = req.cookies?.[CART_COOKIE];
  if (!sid) {
    sid = uuid();
    res.cookie(CART_COOKIE, sid, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: THIRTY_DAYS });
  }
  req.owner = { sessionId: sid };
  next();
};

const editionParam = z.object({ editionId: z.string().uuid() });
const addBody = z.object({ editionId: z.string().uuid(), quantity: z.number().int().min(1).max(10).default(1) });
const qtyBody = z.object({ quantity: z.number().int().min(1).max(10) });

export const cartRouter = Router();
cartRouter.use(optionalAuth, resolveOwner);

cartRouter.get(
  '/',
  json((req) => cart.getCart(req.owner)),
);
cartRouter.post(
  '/items',
  validate(addBody),
  asyncHandler(async (req, res) => {
    const { editionId, quantity } = req.valid.body;
    res.status(201).json(await cart.addItem(req.owner, editionId, quantity));
  }),
);
cartRouter.patch(
  '/items/:editionId',
  validate(editionParam, 'params'),
  validate(qtyBody),
  json((req) => cart.updateItem(req.owner, req.valid.params.editionId, req.valid.body.quantity)),
);
cartRouter.delete(
  '/items/:editionId',
  validate(editionParam, 'params'),
  json((req) => cart.removeItem(req.owner, req.valid.params.editionId)),
);
