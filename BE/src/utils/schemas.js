import { z } from 'zod';

export const page = z.coerce.number().int().min(1).max(10_000).default(1);
export const uuid = z.string().uuid();
export const idParam = (name) => z.object({ [name]: uuid });
export const search = z.string().trim().min(1).max(100).optional();
export const reason = z.string().trim().min(3, 'Cần nhập lý do').max(255);
export const phone = z
  .string()
  .trim()
  .regex(/^(\+84|0)\d{9,10}$/, 'Số điện thoại không hợp lệ');
export const accountPhone = z
  .string()
  .trim()
  .regex(/^(\+?84|0)\d{9}$/, 'Số điện thoại không hợp lệ');
export const email = z.string().trim().email().max(100);
export const bookFormat = z.enum(['Bìa mềm', 'Bìa cứng']);
