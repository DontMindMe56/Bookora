import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import * as geo from './geo.service.js';

const id = (name) => z.object({ [name]: z.coerce.number().int().positive() });

export const geoRouter = Router(); // công khai: form địa chỉ cần chọn tỉnh/quận/phường trước khi đăng nhập
geoRouter.get(
  '/provinces',
  json(async () => ({ items: await geo.listProvinces() })),
);
geoRouter.get(
  '/provinces/:provinceId/districts',
  validate(id('provinceId'), 'params'),
  json(async (req) => ({ items: await geo.listDistricts(req.valid.params.provinceId) })),
);
geoRouter.get(
  '/districts/:districtId/wards',
  validate(id('districtId'), 'params'),
  json(async (req) => ({ items: await geo.listWards(req.valid.params.districtId) })),
);

export const geoAdminRouter = Router();
geoAdminRouter.use(requireRole('ADMIN'));
// Đồng bộ chạy nền (hàng trăm lời gọi GHN): trả 202 ngay, xem kết quả ở GET /status
geoAdminRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    if (!config.ghn.token) throw new AppError(503, 'GHN_NOT_CONFIGURED', 'Chưa cấu hình GHN (GHN_TOKEN)');
    if (geo.isSyncRunning()) return res.status(202).json({ started: false, running: true });
    geo.syncGhnCatalog(req.user).catch((e) => console.error('[geo:sync]', e.message));
    res.status(202).json({ started: true });
  }),
);
geoAdminRouter.get('/status', (_req, res) => res.json({ running: geo.isSyncRunning(), ...geo.syncState }));
