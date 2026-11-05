import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, json } from '../../utils/http.js';
import { CART_COOKIE } from '../cart/cart.routes.js';
import * as auth from './auth.service.js';
import { googleLogin } from './auth.google.js';
import { facebookLogin, linkFacebook } from './auth.facebook.js';
import { email, accountPhone } from '../../utils/schemas.js';
import { config } from '../../config.js';

const password = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .max(72)
  .regex(/[A-Za-z]/, 'Mật khẩu cần có chữ cái')
  .regex(/\d/, 'Mật khẩu cần có chữ số');

const registerBody = z.object({
  email,
  password,
  fullName: z.string().trim().min(1).max(100),
  phone: accountPhone.optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Bạn cần đồng ý điều khoản và chính sách dữ liệu cá nhân' }) }),
});
const tokenBody = z.object({ token: z.string().length(64) });

export const authRouter = Router();

authRouter.post(
  '/register',
  validate(registerBody),
  asyncHandler(async (req, res) => {
    const { acceptTerms, ...data } = req.valid.body;
    await auth.register(data);
    res.status(201).json({ message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản.' });
  }),
);

authRouter.post(
  '/verify-email',
  validate(tokenBody),
  asyncHandler(async (req, res) => {
    await auth.verifyEmail(req.valid.body.token);
    res.json({ message: 'Xác thực email thành công' });
  }),
);

authRouter.post(
  '/resend-verification',
  validate(z.object({ email })),
  asyncHandler(async (req, res) => {
    await auth.resendVerification(req.valid.body.email);
    res.json({ message: 'Nếu email hợp lệ, liên kết xác thực mới đã được gửi.' });
  }),
);

authRouter.post(
  '/set-password',
  validate(z.object({ token: z.string().length(64), password })),
  asyncHandler(async (req, res) => {
    await auth.setPassword(req.valid.body.token, req.valid.body.password);
    res.json({ message: 'Đặt mật khẩu thành công' });
  }),
);

authRouter.post(
  '/login',
  validate(z.object({ email, password: z.string().min(1).max(72) })),
  asyncHandler(async (req, res) => {
    const result = await auth.login({
      ...req.valid.body,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      cartSessionId: req.cookies?.[CART_COOKIE],
    });
    res.clearCookie(CART_COOKIE); // giỏ khách đã gộp vào tài khoản
    res.json(result);
  }),
);

// Client ID / App ID là giá trị công khai (không phải secret); frontend/trang demo dùng để dựng nút đăng nhập Google, Facebook
authRouter.get(
  '/config',
  json(() => ({ googleClientId: config.google.clientId || null, facebookAppId: config.facebook.appId || null })),
);

authRouter.post(
  '/google',
  validate(z.object({ idToken: z.string().min(20).max(4096) })),
  asyncHandler(async (req, res) => {
    const result = await googleLogin({ ...req.valid.body, ip: req.ip, userAgent: req.get('user-agent'), cartSessionId: req.cookies?.[CART_COOKIE] });
    res.clearCookie(CART_COOKIE);
    res.json(result);
  }),
);

authRouter.post(
  '/facebook',
  validate(z.object({ accessToken: z.string().min(20).max(4096) })),
  asyncHandler(async (req, res) => {
    const result = await facebookLogin({ ...req.valid.body, ip: req.ip, userAgent: req.get('user-agent'), cartSessionId: req.cookies?.[CART_COOKIE] });
    res.clearCookie(CART_COOKIE);
    res.json(result);
  }),
);

authRouter.post(
  '/facebook/link',
  requireAuth,
  validate(z.object({ accessToken: z.string().min(20).max(4096) })),
  asyncHandler(async (req, res) => {
    res.json(await linkFacebook(req.user, req.valid.body.accessToken));
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await auth.logout(req.user.sessionId); // chỉ hủy phiên hiện tại
    res.json({ message: 'Đã đăng xuất' });
  }),
);

authRouter.post(
  '/forgot-password',
  validate(z.object({ email })),
  asyncHandler(async (req, res) => {
    await auth.forgotPassword(req.valid.body.email);
    res.json({ message: 'Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi.' });
  }),
);

authRouter.post(
  '/reset-password',
  validate(tokenBody.extend({ password })),
  asyncHandler(async (req, res) => {
    await auth.resetPassword(req.valid.body.token, req.valid.body.password);
    res.json({ message: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập lại.' });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  validate(z.object({ currentPassword: z.string().min(1).max(72), newPassword: password })),
  asyncHandler(async (req, res) => {
    await auth.changePassword(req.user, req.valid.body);
    res.json({ message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  json((req) => auth.getMe(req.user)),
);

authRouter.patch(
  '/me',
  requireAuth,
  validate(
    z
      .object({
        fullName: z.string().trim().min(1).max(100).optional(),
        phone: accountPhone.optional(),
        dateOfBirth: z.string().date().optional(),
        gender: z.enum(['Nam', 'Nữ', 'Khác']).optional(),
      })
      .refine((o) => Object.keys(o).length > 0, { message: 'Không có dữ liệu để cập nhật' }),
  ),
  asyncHandler(async (req, res) => {
    res.json(await auth.updateProfile(req.user, req.valid.body));
  }),
);
