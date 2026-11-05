import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import { page, uuid, idParam, reason } from '../../utils/schemas.js';
import * as svc from './review.service.js';

const rating = z.number().int().min(1).max(5);
const comment = z
  .string()
  .trim()
  .max(1000)
  .transform((s) => s || null);
const reviewParam = validate(idParam('reviewId'), 'params');

export const bookReviewRouter = Router();
bookReviewRouter.get(
  '/:workId/reviews',
  validate(idParam('workId'), 'params'),
  validate(z.object({ rating: z.coerce.number().int().min(1).max(5).optional(), page }), 'query'),
  json((req) => svc.listWorkReviews(req.valid.params.workId, req.valid.query)),
);

export const reviewRouter = Router();
reviewRouter.use(requireCustomer);
reviewRouter.get(
  '/mine',
  json((req) => svc.listMine(req.user.customerId)),
);
reviewRouter.post(
  '/',
  validate(z.object({ editionId: uuid, rating, comment: comment.optional() })),
  json((req) => svc.createReview(req.user.customerId, req.valid.body), 201),
);
reviewRouter.patch(
  '/:reviewId',
  reviewParam,
  validate(
    z
      .object({ rating: rating.optional(), comment: comment.nullable().optional() })
      .refine((d) => Object.keys(d).length > 0, { message: 'Không có thay đổi nào' }),
  ),
  json((req) => svc.updateReview(req.user.customerId, req.valid.params.reviewId, req.valid.body)),
);
reviewRouter.delete(
  '/:reviewId',
  reviewParam,
  json((req) => svc.deleteReview(req.user.customerId, req.valid.params.reviewId)),
);
reviewRouter.post(
  '/:reviewId/report',
  reviewParam,
  validate(z.object({ reason: z.string().trim().min(1).max(255).optional() })),
  json((req) => svc.reportReview(req.user.customerId, req.valid.params.reviewId, req.valid.body.reason)),
);

export const reviewAdminRouter = Router();
reviewAdminRouter.use(requireRole('ADMIN'));
reviewAdminRouter.get(
  '/',
  validate(z.object({ status: z.enum(['VISIBLE', 'HIDDEN']).optional(), q: z.string().trim().min(1).max(100).optional(), page }), 'query'),
  json((req) => svc.listAllReviews(req.valid.query)),
);
reviewAdminRouter.post(
  '/:reviewId/hide',
  reviewParam,
  validate(z.object({ reason })),
  json((req) => svc.setVisibility(req.user, req.valid.params.reviewId, false, req.valid.body.reason)),
);
reviewAdminRouter.post(
  '/:reviewId/show',
  reviewParam,
  validate(z.object({ reason: reason.optional() })),
  json((req) => svc.setVisibility(req.user, req.valid.params.reviewId, true, req.valid.body.reason)),
);
