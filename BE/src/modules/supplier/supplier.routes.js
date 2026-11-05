import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as svc from './supplier.service.js';
import { page, idParam } from '../../utils/schemas.js';

const supplierParam = idParam('supplierId');
const phone = z
  .string()
  .trim()
  .regex(/^\+?\d{8,14}$/, 'Số điện thoại không hợp lệ');
const base = {
  name: z.string().trim().min(1).max(150),
  phone,
  email: z.string().trim().email().max(100).nullable().optional(),
  address: z.string().trim().min(1).max(255),
  leadTimeDays: z.number().int().min(1).max(365),
};
const createBody = z.object({ ...base, leadTimeDays: base.leadTimeDays.default(7) });
const patchBody = z
  .object({ ...base, status: z.enum(['ACTIVE', 'INACTIVE']) })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Không có thay đổi nào' });
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page,
});

// Nhân viên kho và quản trị viên đều quản lý nhà cung cấp (giả định, SRS chưa tách quyền)
export const supplierRouter = Router();
supplierRouter.use(requireRole('STAFF', 'ADMIN'));
supplierRouter.get(
  '/',
  validate(listQuery, 'query'),
  json((req) => svc.listSuppliers(req.valid.query)),
);
supplierRouter.post(
  '/',
  validate(createBody),
  json((req) => svc.createSupplier(req.user, req.valid.body), 201),
);
supplierRouter.get(
  '/:supplierId',
  validate(supplierParam, 'params'),
  json((req) => svc.getSupplier(req.valid.params.supplierId)),
);
supplierRouter.patch(
  '/:supplierId',
  validate(supplierParam, 'params'),
  validate(patchBody),
  json((req) => svc.updateSupplier(req.user, req.valid.params.supplierId, req.valid.body)),
);
supplierRouter.delete(
  '/:supplierId',
  validate(supplierParam, 'params'),
  json((req) => svc.removeSupplier(req.user, req.valid.params.supplierId)),
);
