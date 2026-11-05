import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { requireCustomer, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as svc from './discount.service.js';
import { limiter } from '../../middleware/rateLimit.js';
import { idParam } from '../../utils/schemas.js';

const codeParam = idParam('discountCodeId');
const dateTime = z
  .string()
  .datetime({ offset: true, message: 'Thời gian phải theo định dạng ISO 8601' })
  .transform((s) => new Date(s));
const money = z.number().int().positive().max(1_000_000_000);

const base = {
  code: z
    .string()
    .trim()
    .min(4, 'Mã tối thiểu 4 ký tự')
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/, 'Mã chỉ gồm chữ, số, gạch ngang và gạch dưới'),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.number().positive().max(1_000_000_000),
  minOrderValue: money.nullable().optional(),
  maxDiscount: money.nullable().optional(), // trần giảm (dùng cho PERCENT)
  totalUsageLimit: z.number().int().positive().max(10_000_000).nullable().optional(),
  perCustomerLimit: z.number().int().positive().max(1000).nullable().optional(),
  excludeOnSale: z.boolean(),
  startAt: dateTime,
  endAt: dateTime,
  categoryIds: z.array(z.string().uuid()).max(200).optional(), // bỏ trống = toàn bộ sách
};

function crossCheck(d, ctx) {
  if (d.type === 'PERCENT' && d.value !== undefined && d.value > 100)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Phần trăm giảm không vượt quá 100' });
  if (d.type === 'FIXED' && d.value !== undefined && !Number.isInteger(d.value))
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Số tiền giảm phải là số nguyên đồng' });
  if (d.startAt && d.endAt && d.startAt >= d.endAt) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
}

const createBody = z.object({ ...base, excludeOnSale: base.excludeOnSale.default(false) }).superRefine((d, ctx) => {
  crossCheck(d, ctx);
  if (d.endAt <= new Date()) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Thời gian kết thúc phải ở tương lai' });
});
// Mã (code) không đổi sau khi tạo
const { code: _code, ...patchable } = base;
const patchBody = z
  .object({ ...patchable, status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial()
  .superRefine((d, ctx) => {
    if (!Object.keys(d).length) ctx.addIssue({ code: 'custom', message: 'Không có thay đổi nào' });
    crossCheck(d, ctx);
  });
const listQuery = z.object({
  q: z.string().trim().max(50).optional(),
  phase: z.enum(['SCHEDULED', 'RUNNING', 'ENDED', 'PAUSED', 'USED_UP']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// Quản trị mã giảm giá: chỉ ADMIN (giả định)
export const discountAdminRouter = Router();
discountAdminRouter.use(requireRole('ADMIN'));
discountAdminRouter.get(
  '/',
  validate(listQuery, 'query'),
  json((req) => svc.listCodes(req.valid.query)),
);
discountAdminRouter.post(
  '/',
  validate(createBody),
  json((req) => svc.createCode(req.user, req.valid.body), 201),
);
discountAdminRouter.get(
  '/:discountCodeId',
  validate(codeParam, 'params'),
  json((req) => svc.getCode(req.valid.params.discountCodeId)),
);
discountAdminRouter.patch(
  '/:discountCodeId',
  validate(codeParam, 'params'),
  validate(patchBody),
  json((req) => svc.updateCode(req.user, req.valid.params.discountCodeId, req.valid.body)),
);
discountAdminRouter.delete(
  '/:discountCodeId',
  validate(codeParam, 'params'),
  json((req) => svc.removeCode(req.user, req.valid.params.discountCodeId)),
);

// Khách hàng: xem trước mức giảm theo giỏ hàng (giới hạn tần suất để chống dò mã)
const codeLimiter = limiter(config.codeRateLimit, 'Quá nhiều lần thử mã, vui lòng thử lại sau');
export const discountCustomerRouter = Router();
discountCustomerRouter.post(
  '/validate',
  codeLimiter,
  requireCustomer,
  validate(z.object({ code: z.string().trim().min(1).max(30) })),
  json((req) => svc.previewForCart(req.user.customerId, req.valid.body.code)),
);
