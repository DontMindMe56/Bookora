import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { json } from '../../utils/http.js';
import * as svc from './address.service.js';
import { phone, idParam } from '../../utils/schemas.js';

const text = (max) => z.string().trim().min(1).max(max);
const loc = {
  ghnProvinceId: z.number().int().positive(),
  ghnDistrictId: z.number().int().positive(),
  ghnWardCode: z.string().trim().min(1).max(20),
};
const createBody = z.object({ receiverName: text(100), phone, detail: text(255), ...loc, isDefault: z.boolean().optional() });
const patchBody = z
  .object({
    receiverName: text(100),
    phone,
    detail: text(255),
    ghnProvinceId: loc.ghnProvinceId,
    ghnDistrictId: loc.ghnDistrictId,
    ghnWardCode: loc.ghnWardCode,
    isDefault: z.literal(true),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Không có thay đổi nào' })
  .refine(
    (d) =>
      [d.ghnProvinceId, d.ghnDistrictId, d.ghnWardCode].every((v) => v === undefined) ||
      [d.ghnProvinceId, d.ghnDistrictId, d.ghnWardCode].every((v) => v !== undefined),
    { message: 'Đổi khu vực cần gửi đủ tỉnh, quận và phường' },
  );
const addressParam = idParam('addressId');

export const addressRouter = Router();
addressRouter.use(requireCustomer);
addressRouter.get(
  '/',
  json((req) => svc.listAddresses(req.user.customerId)),
);
addressRouter.post(
  '/',
  validate(createBody),
  json((req) => svc.createAddress(req.user.customerId, req.valid.body), 201),
);
addressRouter.patch(
  '/:addressId',
  validate(addressParam, 'params'),
  validate(patchBody),
  json((req) => svc.updateAddress(req.user.customerId, req.valid.params.addressId, req.valid.body)),
);
addressRouter.post(
  '/:addressId/default',
  validate(addressParam, 'params'),
  json((req) => svc.makeDefault(req.user.customerId, req.valid.params.addressId)),
);
addressRouter.post(
  '/:addressId/confirm',
  validate(addressParam, 'params'),
  json((req) => svc.confirmAddress(req.user.customerId, req.valid.params.addressId)),
);
addressRouter.delete(
  '/:addressId',
  validate(addressParam, 'params'),
  json((req) => svc.deleteAddress(req.user.customerId, req.valid.params.addressId)),
);
