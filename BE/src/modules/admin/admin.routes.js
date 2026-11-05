import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import { unprocessable } from '../../utils/errors.js';
import * as acc from './accounts.service.js';
import * as tax from './taxonomy.service.js';
import * as books from './book.service.js';
import * as sys from './system.service.js';
import * as rep from './report.service.js';
import { page, uuid, idParam, search as q, reason, accountPhone as phone } from '../../utils/schemas.js';

const uuidParam = (name) => validate(idParam(name), 'params');
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD')
  .optional();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

export const adminRouter = Router();
adminRouter.use(requireRole('ADMIN'));

adminRouter.get(
  '/customers',
  validate(z.object({ q, status: z.enum(['ACTIVE', 'UNVERIFIED', 'LOCKED']).optional(), page }), 'query'),
  json((req) => acc.listCustomers(req.valid.query)),
);
adminRouter.get(
  '/customers/:customerId',
  uuidParam('customerId'),
  json((req) => acc.getCustomer(req.valid.params.customerId)),
);
adminRouter.post(
  '/accounts/:accountId/lock',
  uuidParam('accountId'),
  validate(z.object({ reason })),
  json((req) => acc.lockAccount(req.user, req.valid.params.accountId, req.valid.body.reason)),
);
adminRouter.post(
  '/accounts/:accountId/unlock',
  uuidParam('accountId'),
  validate(z.object({ reason: reason.optional() })),
  json((req) => acc.unlockAccount(req.user, req.valid.params.accountId, req.valid.body.reason)),
);

const staffBody = z.object({
  fullName: z.string().trim().min(1).max(100),
  phone: phone.nullable().optional(),
  position: z.string().trim().min(1).max(50),
  role: z.enum(['STAFF', 'ADMIN']),
});
adminRouter.get(
  '/staff',
  validate(z.object({ q, page }), 'query'),
  json((req) => acc.listStaff(req.valid.query)),
);
adminRouter.post(
  '/staff',
  validate(staffBody.extend({ email: z.string().trim().email().max(100) })),
  json((req) => acc.createStaff(req.user, req.valid.body), 201),
);
adminRouter.patch(
  '/staff/:staffId',
  uuidParam('staffId'),
  validate(staffBody.partial()),
  json((req) => acc.updateStaff(req.user, req.valid.params.staffId, req.valid.body)),
);
adminRouter.post(
  '/staff/:staffId/resend-password-link',
  uuidParam('staffId'),
  json((req) => acc.resendStaffLink(req.user, req.valid.params.staffId)),
);

const name = z.string().trim().min(1).max(150);
const bodies = {
  categories: z.object({ name: name.max(100), parentId: uuid.nullable().optional(), description: z.string().trim().max(255).nullable().optional() }),
  authors: z.object({ name, biography: z.string().trim().max(10_000).nullable().optional() }),
  publishers: z.object({ name, address: z.string().trim().max(255).nullable().optional(), phone: z.string().trim().max(15).nullable().optional() }),
  series: z.object({ name: name.max(255) }),
};
for (const [path, def] of Object.entries(tax.TAXONOMY)) {
  adminRouter.get(
    `/${path}`,
    validate(z.object({ q, page }), 'query'),
    json((req) => tax.listItems(def, req.valid.query)),
  );
  adminRouter.post(
    `/${path}`,
    validate(bodies[path]),
    json((req) => tax.createItem(req.user, def, req.valid.body), 201),
  );
  adminRouter.patch(
    `/${path}/:id`,
    uuidParam('id'),
    validate(bodies[path].partial()),
    json((req) => tax.updateItem(req.user, def, req.valid.params.id, req.valid.body)),
  );
  adminRouter.delete(
    `/${path}/:id`,
    uuidParam('id'),
    json((req) => tax.deleteItem(req.user, def, req.valid.params.id)),
  );
}

const pos = z.number().int().positive();
const detailsBody = z
  .object({
    isbn: z.string().trim().min(10).max(20),
    title: z.string().trim().min(1).max(255),
    description: z.string().max(20_000).nullable(),
    language: z.string().max(20).nullable(),
    authors: z.array(name).min(1),
    categories: z.array(name.max(100)),
    seriesId: uuid.nullable(),
    volumeNo: pos.nullable(),
    publisher: name,
    format: z.enum(['Bìa mềm', 'Bìa cứng']),
    pageCount: pos.nullable(),
    weightGram: pos,
    lengthMm: pos.nullable(),
    widthMm: pos.nullable(),
    heightMm: pos.nullable(),
    publishedYear: z.number().int().min(1400).max(2100).nullable(),
    reason: reason.optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Không có thay đổi nào' });
adminRouter.patch(
  '/editions/:editionId/details',
  uuidParam('editionId'),
  validate(detailsBody),
  json((req) => books.updateBookDetails(req.user, req.valid.params.editionId, req.valid.body)),
);
adminRouter.post(
  '/editions/:editionId/cover',
  uuidParam('editionId'),
  upload.single('cover'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw unprocessable('Thiếu tệp ảnh (trường "cover")', 'INVALID_IMAGE');
    res.json(await books.saveCover(req.user, req.valid.params.editionId, req.file.buffer));
  }),
);

adminRouter.get(
  '/parameters',
  json(() => sys.listParams()),
);
adminRouter.patch(
  '/parameters/:key',
  validate(z.object({ key: z.string().regex(/^[A-Z0-9_]{2,50}$/) }), 'params'),
  validate(z.object({ value: z.union([z.string(), z.number()]), reason })),
  json((req) => sys.updateParam(req.user, req.valid.params.key, req.valid.body.value, req.valid.body.reason)),
);
adminRouter.get(
  '/audit-logs',
  validate(
    z.object({
      actorId: uuid.optional(),
      entityType: z.string().max(50).optional(),
      entityId: uuid.optional(),
      action: z.string().max(50).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      page,
    }),
    'query',
  ),
  json((req) => sys.listAuditLogs(req.valid.query)),
);

const rangeQuery = z.object({ from: day, to: day });
adminRouter.get(
  '/reports/revenue',
  validate(rangeQuery.extend({ groupBy: z.enum(['day', 'month', 'category']).default('day') }), 'query'),
  json((req) => rep.revenueReport(req.valid.query)),
);
adminRouter.get(
  '/reports/best-sellers',
  validate(rangeQuery.extend({ limit: z.coerce.number().int().min(1).max(100).default(10) }), 'query'),
  json((req) => rep.bestSellers(req.valid.query)),
);
adminRouter.get(
  '/reports/overview',
  validate(rangeQuery, 'query'),
  json((req) => rep.overview(req.valid.query)),
);
