import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import * as catalog from './catalog.service.js';
import { page, uuid, idParam, bookFormat } from '../../utils/schemas.js';

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: uuid.optional(),
  publisherId: uuid.optional(),
  format: bookFormat.optional(),
  minPrice: z.coerce.number().int().min(0, 'Khoảng giá không được âm').optional(),
  maxPrice: z.coerce.number().int().min(0, 'Khoảng giá không được âm').optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'bestseller']).optional(),
  page,
});

const editionBody = z
  .object({
    isbn: z.string().trim().min(10).max(20),
    workId: uuid.optional(),
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(20000).optional(),
    language: z.string().max(20).optional(),
    authors: z.array(z.string().trim().min(1).max(150)).default([]),
    categories: z.array(z.string().trim().min(1).max(100)).default([]),
    seriesId: uuid.optional(),
    volumeNo: z.number().int().min(1).optional(),
    publisher: z.string().trim().min(1).max(150),
    format: bookFormat,
    listPrice: z.number().int().positive(),
    salePrice: z.number().int().positive().nullable().optional(),
    pageCount: z.number().int().positive().optional(),
    weightGram: z.number().int().positive('Trọng lượng phải là số dương (cần để GHN tính phí)'),
    lengthMm: z.number().int().positive().optional(),
    widthMm: z.number().int().positive().optional(),
    heightMm: z.number().int().positive().optional(),
    coverImageUrl: z.string().url().max(500).optional(),
    publishedYear: z.number().int().min(1400).max(2100).optional(),
    businessStatus: z.enum(['ON_SALE', 'HIDDEN', 'DISCONTINUED']).default('ON_SALE'),
  })
  .refine((d) => d.workId || (d.title && d.authors.length), { message: 'Cần workId, hoặc title kèm ít nhất một tác giả để tạo tác phẩm mới' });

const editionPatch = z
  .object({
    listPrice: z.number().int().positive().optional(),
    salePrice: z.number().int().positive().nullable().optional(),
    businessStatus: z.enum(['ON_SALE', 'HIDDEN', 'DISCONTINUED']).optional(),
    reason: z.string().trim().min(3, 'Cần nhập lý do').max(255),
  })
  .refine((d) => d.listPrice !== undefined || d.salePrice !== undefined || d.businessStatus !== undefined, { message: 'Không có thay đổi nào' });

export const catalogRouter = Router();
catalogRouter.get(
  '/books',
  validate(searchQuery, 'query'),
  json((req) => catalog.searchBooks(req.valid.query)),
);
catalogRouter.get(
  '/books/:workId',
  validate(idParam('workId'), 'params'),
  json((req) => catalog.getWorkDetail(req.valid.params.workId)),
);
catalogRouter.get(
  '/categories',
  json(() => catalog.listCategories()),
);

export const adminCatalogRouter = Router();
adminCatalogRouter.use(requireRole('ADMIN')); // quản lý danh mục: chỉ quản trị viên
adminCatalogRouter.post(
  '/editions',
  validate(editionBody),
  json((req) => catalog.createEdition(req.user, req.valid.body), 201),
);
adminCatalogRouter.patch(
  '/editions/:editionId',
  validate(idParam('editionId'), 'params'),
  validate(editionPatch),
  asyncHandler(async (req, res) => {
    const { reason, ...patch } = req.valid.body;
    res.json(await catalog.updateEdition(req.user, req.valid.params.editionId, patch, reason));
  }),
);
