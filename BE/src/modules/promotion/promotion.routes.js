import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as svc from './promotion.service.js';
import { idParam } from '../../utils/schemas.js';

const promotionParam = idParam('promotionId');
const dateTime = z
  .string()
  .datetime({ offset: true, message: 'Thời gian phải theo định dạng ISO 8601' })
  .transform((s) => new Date(s));

const base = {
  name: z.string().trim().min(1).max(150),
  scopeType: z.enum(['EDITION', 'CATEGORY', 'PUBLISHER', 'ISBN_LIST']),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.number().positive().max(1_000_000_000),
  startAt: dateTime,
  endAt: dateTime,
  // EDITION/CATEGORY/PUBLISHER: danh sách id; ISBN_LIST: danh sách ISBN-13 (chỉ số)
  targets: z.array(z.string().trim().min(1).max(36)).min(1, 'Chưa chọn đối tượng áp dụng').max(500),
  allowBelowCost: z.boolean(),
  belowCostReason: z.string().trim().min(1).max(255).nullable().optional(),
};

/** Kiểm tra phần phụ thuộc giữa các trường (dùng chung cho tạo mới và sửa từng phần). */
function crossCheck(d, ctx) {
  const type = d.discountType,
    value = d.discountValue;
  if (type === 'PERCENT' && value !== undefined && value >= 100) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Phần trăm giảm phải nhỏ hơn 100' });
  }
  if (type === 'FIXED' && value !== undefined && !Number.isInteger(value)) {
    ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Số tiền giảm phải là số nguyên đồng' });
  }
  if (d.startAt && d.endAt && d.startAt >= d.endAt) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
  if (d.scopeType === 'ISBN_LIST' && d.targets?.some((t) => !/^\d{13}$/.test(t))) {
    ctx.addIssue({ code: 'custom', path: ['targets'], message: 'ISBN phải gồm đúng 13 chữ số' });
  } else if (d.scopeType && d.scopeType !== 'ISBN_LIST' && d.targets?.some((t) => !z.string().uuid().safeParse(t).success)) {
    ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Mã đối tượng không hợp lệ' });
  }
  if (d.allowBelowCost === true && !d.belowCostReason) ctx.addIssue({ code: 'custom', path: ['belowCostReason'], message: 'Bán lỗ phải kèm lý do' });
}

const createBody = z.object({ ...base, allowBelowCost: base.allowBelowCost.default(false) }).superRefine((d, ctx) => {
  crossCheck(d, ctx);
  if (d.endAt <= new Date()) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Thời gian kết thúc phải ở tương lai' });
});

const patchBody = z
  .object({ ...base, status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial()
  .superRefine((d, ctx) => {
    if (!Object.keys(d).length) ctx.addIssue({ code: 'custom', message: 'Không có thay đổi nào' });
    crossCheck(d, ctx);
  });

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  phase: z.enum(['SCHEDULED', 'RUNNING', 'ENDED', 'PAUSED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// Quản lý khuyến mãi: chỉ quản trị viên (giả định; SRS chưa tách quyền với nhân viên)
export const promotionAdminRouter = Router();
promotionAdminRouter.use(requireRole('ADMIN'));
promotionAdminRouter.get(
  '/',
  validate(listQuery, 'query'),
  json((req) => svc.listPromotions(req.valid.query)),
);
promotionAdminRouter.post(
  '/',
  validate(createBody),
  json((req) => svc.createPromotion(req.user, req.valid.body), 201),
);
promotionAdminRouter.get(
  '/:promotionId',
  validate(promotionParam, 'params'),
  json((req) => svc.getPromotion(req.valid.params.promotionId)),
);
promotionAdminRouter.patch(
  '/:promotionId',
  validate(promotionParam, 'params'),
  validate(patchBody),
  json((req) => svc.updatePromotion(req.user, req.valid.params.promotionId, req.valid.body)),
);
promotionAdminRouter.delete(
  '/:promotionId',
  validate(promotionParam, 'params'),
  json((req) => svc.removePromotion(req.user, req.valid.params.promotionId)),
);
