import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as voucher from './voucher.service.js';
import * as po from './purchaseOrder.service.js';
import * as inv from './inventory.service.js';
import { page, uuid, reason } from '../../utils/schemas.js';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD')
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, 'Ngày không tồn tại');
const notFuture = (d) => d <= new Date().toISOString().slice(0, 10);
const byEditionOrIsbn = (d) => !!(d.editionId || d.isbn);
const lineRef = { editionId: uuid.optional(), isbn: z.string().trim().min(10).max(20).optional() };
const refMsg = { message: 'Cần editionId hoặc isbn' };

// ---------- Phiếu nhập kho ----------
const importLine = z
  .object({
    ...lineRef,
    quantity: z.number().int().min(1).max(100_000),
    unitCost: z.number().min(0).max(1_000_000_000),
  })
  .refine(byEditionOrIsbn, refMsg);
const linesField = z.array(importLine).min(1, 'Phiếu nhập cần ít nhất một dòng hàng').max(500);

const createVoucherBody = z.object({
  supplierId: uuid,
  voucherCode: z.string().trim().min(1).max(30).optional(),
  importDate: date.refine(notFuture, 'Ngày nhập không được ở tương lai'),
  purchaseOrderId: uuid.optional(),
  lines: linesField,
});
const updateVoucherBody = z
  .object({
    importDate: date.refine(notFuture, 'Ngày nhập không được ở tương lai').optional(),
    purchaseOrderId: uuid.nullable().optional(),
    lines: linesField.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Không có thay đổi nào' });
const previewBody = z.object({
  supplierId: uuid,
  lines: z
    .array(
      z.object({ ...lineRef, quantity: z.number().int().min(1).max(100_000), unitCost: z.number().min(0).max(1_000_000_000) }).refine(byEditionOrIsbn, refMsg),
    )
    .min(1)
    .max(2000),
});
const confirmBody = z
  .object({
    lines: z
      .array(z.object({ detailId: uuid, receivedQty: z.number().int().min(0).max(100_000), isbn: z.string().trim().max(20).optional() }))
      .min(1)
      .optional(),
  })
  .default({});
const listVoucherQuery = z.object({
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']).optional(),
  supplierId: uuid.optional(),
  from: date.optional(),
  to: date.optional(),
  page,
});
const costAdjustBody = z.object({
  detailId: uuid,
  newUnitCost: z.number().min(0).max(1_000_000_000),
  reason,
  attachmentUrl: z.string().url().max(500).optional(),
});
const voucherParam = z.object({ voucherId: uuid });

export const importRouter = Router();
importRouter.use(requireRole('STAFF', 'ADMIN'));
importRouter.get(
  '/',
  validate(listVoucherQuery, 'query'),
  json((req) => voucher.listVouchers(req.valid.query)),
);
importRouter.post(
  '/preview',
  validate(previewBody),
  json((req) => voucher.previewLines(req.valid.body.supplierId, req.valid.body.lines)),
);
importRouter.post(
  '/',
  validate(createVoucherBody),
  json((req) => voucher.createDraft(req.user, req.valid.body), 201),
);
importRouter.get(
  '/:voucherId',
  validate(voucherParam, 'params'),
  json((req) => voucher.getVoucher(req.valid.params.voucherId)),
);
importRouter.patch(
  '/:voucherId',
  validate(voucherParam, 'params'),
  validate(updateVoucherBody),
  json((req) => voucher.updateDraft(req.user, req.valid.params.voucherId, req.valid.body)),
);
importRouter.post(
  '/:voucherId/confirm',
  validate(voucherParam, 'params'),
  validate(confirmBody),
  json((req) => voucher.confirmVoucher(req.user, req.valid.params.voucherId, req.valid.body.lines)),
);
importRouter.post(
  '/:voucherId/cancel',
  validate(voucherParam, 'params'),
  validate(z.object({ reason: reason.optional() }).default({})),
  json((req) => voucher.cancelDraft(req.user, req.valid.params.voucherId, req.valid.body.reason)),
);
// Điều chỉnh giá nhập: chỉ quản trị viên
importRouter.post(
  '/:voucherId/cost-adjustments',
  requireRole('ADMIN'),
  validate(voucherParam, 'params'),
  validate(costAdjustBody),
  json((req) => voucher.adjustCost(req.user, req.valid.params.voucherId, req.valid.body), 201),
);

// ---------- Phiếu đặt hàng nhà cung cấp ----------
const poListQuery = z.object({
  status: z.enum(['OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'AUTO_CLOSED', 'CANCELLED']).optional(),
  supplierId: uuid.optional(),
  page,
});
const poCreateBody = z.object({
  supplierId: uuid,
  lines: z
    .array(z.object({ ...lineRef, quantity: z.number().int().min(1).max(100_000) }).refine(byEditionOrIsbn, refMsg))
    .min(1)
    .max(500),
});
const poParam = z.object({ purchaseOrderId: uuid });

export const purchaseOrderRouter = Router();
purchaseOrderRouter.use(requireRole('STAFF', 'ADMIN'));
purchaseOrderRouter.get(
  '/',
  validate(poListQuery, 'query'),
  json((req) => po.listPurchaseOrders(req.valid.query)),
);
purchaseOrderRouter.get(
  '/lookup',
  validate(z.object({ isbn: z.string().trim().min(10).max(20) }), 'query'),
  json(async (req) => ({ items: await po.findOpenPurchaseOrdersByIsbn(req.valid.query.isbn) })),
);
purchaseOrderRouter.post(
  '/',
  validate(poCreateBody),
  json((req) => po.createPurchaseOrder(req.user, req.valid.body), 201),
);
purchaseOrderRouter.get(
  '/:purchaseOrderId',
  validate(poParam, 'params'),
  json((req) => po.getPurchaseOrder(req.valid.params.purchaseOrderId)),
);
purchaseOrderRouter.post(
  '/:purchaseOrderId/cancel',
  validate(poParam, 'params'),
  validate(z.object({ reason: reason.optional() }).default({})),
  json((req) => po.cancelPurchaseOrder(req.user, req.valid.params.purchaseOrderId, req.valid.body.reason)),
);

// ---------- Tồn kho ----------
const invListQuery = z.object({ q: z.string().trim().max(100).optional(), filter: z.enum(['below_min', 'out_of_stock']).optional(), page });
const editionParam = z.object({ editionId: uuid });
const settingsBody = z
  .object({
    minStockLevel: z.number().int().min(0).max(1_000_000).optional(),
    reorderQty: z.number().int().min(1).max(1_000_000).optional(),
    defaultSupplierId: uuid.nullable().optional(),
    resetToAuto: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Không có thay đổi nào' });
const adjustBody = z.object({
  reason,
  lines: z
    .array(
      z
        .object({ ...lineRef, actualQty: z.number().int().min(0).max(1_000_000), type: z.enum(['ADJUST', 'DAMAGE']).default('ADJUST') })
        .refine(byEditionOrIsbn, refMsg),
    )
    .min(1)
    .max(2000),
});
const inspectBody = z
  .object({
    goodQty: z.number().int().min(0).max(100_000),
    damagedQty: z.number().int().min(0).max(100_000),
    reason: reason.optional(),
  })
  .refine((d) => d.goodQty + d.damagedQty > 0, { message: 'Cần nhập số lượng cần kiểm' });

export const inventoryRouter = Router();
inventoryRouter.use(requireRole('STAFF', 'ADMIN'));
inventoryRouter.get(
  '/',
  validate(invListQuery, 'query'),
  json((req) => inv.listInventory(req.valid.query)),
);
inventoryRouter.post(
  '/adjustments',
  validate(adjustBody),
  json((req) => inv.adjustStock(req.user, req.valid.body), 201),
);
inventoryRouter.get(
  '/:editionId',
  validate(editionParam, 'params'),
  json((req) => inv.getInventory(req.valid.params.editionId)),
);
inventoryRouter.get(
  '/:editionId/movements',
  validate(editionParam, 'params'),
  validate(z.object({ page }), 'query'),
  json((req) => inv.listMovements(req.valid.params.editionId, req.valid.query.page)),
);
inventoryRouter.patch(
  '/:editionId/settings',
  validate(editionParam, 'params'),
  validate(settingsBody),
  json((req) => inv.updateSettings(req.user, req.valid.params.editionId, req.valid.body)),
);
inventoryRouter.post(
  '/:editionId/inspections',
  validate(editionParam, 'params'),
  validate(inspectBody),
  json((req) => inv.inspectPending(req.user, req.valid.params.editionId, req.valid.body), 201),
);
