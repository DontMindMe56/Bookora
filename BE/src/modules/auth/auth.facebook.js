import { config } from '../../config.js';
import { query, withTx } from '../../db.js';
import { AppError, conflict, forbidden, unauthorized } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/text.js';
import { uuid } from '../../utils/security.js';
import { mergeGuestCart } from '../cart/cart.service.js';
import { createSession, sendVerifyEmail, sendVerifyEmailIfDue } from './auth.service.js';

const TIMEOUT_MS = 8000;

async function graph(path, params) {
  let res;
  try {
    res = await fetch(`${config.facebook.graphUrl}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError(502, 'FACEBOOK_UNAVAILABLE', 'Không kết nối được Facebook, vui lòng thử lại');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) throw unauthorized('Facebook access token không hợp lệ', 'INVALID_FACEBOOK_TOKEN');
  return body;
}

/**
 * Token phải do CHÍNH app này cấp (debug_token kiểm app_id) — nếu không, token Facebook của app khác
 * có thể dùng để đăng nhập vào đây. Sau đó lấy id/tên/email từ /me và đối chiếu id với user_id của token.
 */
async function verifyFacebookToken(accessToken) {
  const { appId, appSecret } = config.facebook;
  if (!appId || !appSecret) throw new AppError(503, 'FACEBOOK_NOT_CONFIGURED', 'Chưa cấu hình FACEBOOK_APP_ID / FACEBOOK_APP_SECRET');
  const { data } = await graph('/debug_token', { input_token: accessToken, access_token: `${appId}|${appSecret}` });
  if (!data?.is_valid || String(data.app_id) !== String(appId)) throw unauthorized('Facebook access token không hợp lệ', 'INVALID_FACEBOOK_TOKEN');
  const me = await graph('/me', { fields: 'id,name,email', access_token: accessToken });
  if (!me.id || String(me.id) !== String(data.user_id)) throw unauthorized('Facebook access token không hợp lệ', 'INVALID_FACEBOOK_TOKEN');
  return me;
}

/**
 * Đăng nhập / đăng ký bằng Facebook (frontend lấy access token qua Facebook JS SDK, scope public_profile,email).
 * Facebook KHÔNG bảo đảm email đã xác minh (khác Google) nên email từ Facebook không được tin:
 * - Đã liên kết facebookId + tài khoản ACTIVE => đăng nhập.
 * - Email chưa có tài khoản => tạo tài khoản UNVERIFIED (gắn facebookId) và gửi email xác thực; chỉ sau khi chủ email mở liên kết mới đăng nhập được
 *   => kẻ dựng tài khoản Facebook mang email của người khác không vào được.
 * - Email trùng tài khoản ĐANG HOẠT ĐỘNG chưa liên kết Facebook => không tự liên kết: 409 FACEBOOK_LINK_REQUIRED; chủ tài khoản đăng nhập
 *   bằng mật khẩu/Google rồi liên kết qua POST /api/auth/facebook/link (linkFacebook).
 * - Email trùng tài khoản mật khẩu CHƯA xác thực => 403 EMAIL_NOT_VERIFIED, không gắn facebookId, không đổi mật khẩu.
 * Facebook không phải lúc nào cũng trả email (đăng ký bằng số điện thoại, hoặc từ chối quyền email) => từ chối, vì Account.email là bắt buộc.
 */
export async function facebookLogin({ accessToken, ip, userAgent, cartSessionId }) {
  const f = await verifyFacebookToken(accessToken);
  if (!f.email) throw forbidden('Tài khoản Facebook không cung cấp email. Hãy cấp quyền email hoặc dùng cách đăng nhập khác.', 'FACEBOOK_EMAIL_MISSING');
  const email = normalizeEmail(f.email);

  const out = await withTx(async (conn) => {
    let [acc] = await query('SELECT * FROM Account WHERE facebookId = ? AND deletedAt IS NULL FOR UPDATE', [f.id], conn);
    const byFacebook = !!acc;
    if (!acc) [acc] = await query('SELECT * FROM Account WHERE email = ? AND deletedAt IS NULL FOR UPDATE', [email], conn);
    if (acc && acc.role !== 'CUSTOMER') throw forbidden('Tài khoản nhân viên không đăng nhập bằng Facebook', 'FACEBOOK_NOT_ALLOWED');
    if (acc?.status === 'LOCKED') throw forbidden('Tài khoản đã bị khóa', 'ACCOUNT_LOCKED');
    if (acc?.facebookId && acc.facebookId !== f.id) throw forbidden('Email này đã liên kết với tài khoản Facebook khác', 'FACEBOOK_ACCOUNT_MISMATCH');
    if (acc && !byFacebook) {
      if (acc.status === 'UNVERIFIED')
        throw forbidden(
          'Email này đã được đăng ký nhưng chưa xác thực. Hãy xác thực email trước, rồi liên kết Facebook sau khi đăng nhập.',
          'EMAIL_NOT_VERIFIED',
        );
      throw conflict(
        'Email này đã có tài khoản. Hãy đăng nhập bằng mật khẩu (hoặc Google) rồi liên kết Facebook trong phần tài khoản.',
        'FACEBOOK_LINK_REQUIRED',
      );
    }

    if (!acc) {
      const accountId = uuid();
      await query(
        `INSERT INTO Account (accountId, email, passwordHash, role, status, emailVerifiedAt, facebookId, termsAcceptedAt) VALUES (?,?,NULL,'CUSTOMER','UNVERIFIED',NULL,?,NOW())`,
        [accountId, email, f.id],
        conn,
      );
      await query(
        'INSERT INTO Customer (customerId, accountId, fullName) VALUES (?,?,?)',
        [uuid(), accountId, (f.name || email.split('@')[0]).slice(0, 100)],
        conn,
      );
      await sendVerifyEmail(conn, accountId, email, { fresh: true });
      return { pending: true };
    }
    if (acc.status === 'UNVERIFIED') {
      await sendVerifyEmailIfDue(conn, acc.accountId, email);
      return { pending: true };
    }

    await query('UPDATE Account SET lastLoginAt = NOW() WHERE accountId = ?', [acc.accountId], conn);
    const session = await createSession(conn, acc, { ip, userAgent });
    const [c] = await query('SELECT customerId FROM Customer WHERE accountId = ?', [acc.accountId], conn);
    await mergeGuestCart(conn, cartSessionId, c?.customerId);
    return { ...session, role: acc.role };
  });
  // Ném SAU khi transaction đã commit để tài khoản UNVERIFIED và email xác thực được lưu
  if (out.pending)
    throw forbidden(
      'Chúng tôi đã gửi email xác thực tới địa chỉ email Facebook của bạn. Hãy mở liên kết rồi đăng nhập lại bằng Facebook.',
      'EMAIL_NOT_VERIFIED',
    );
  return out;
}

/**
 * Liên kết Facebook vào tài khoản đang đăng nhập (đã chứng minh quyền sở hữu bằng mật khẩu/Google). Không cần trùng email.
 * Một Facebook chỉ gắn với một tài khoản; tài khoản đã gắn Facebook khác thì không ghi đè.
 */
export async function linkFacebook(user, accessToken) {
  const f = await verifyFacebookToken(accessToken);
  return withTx(async (conn) => {
    const [acc] = await query('SELECT accountId, role, facebookId FROM Account WHERE accountId = ? AND deletedAt IS NULL FOR UPDATE', [user.accountId], conn);
    if (!acc) throw unauthorized();
    if (acc.role !== 'CUSTOMER') throw forbidden('Tài khoản nhân viên không liên kết Facebook', 'FACEBOOK_NOT_ALLOWED');
    if (acc.facebookId === f.id) return { linked: true };
    if (acc.facebookId) throw conflict('Tài khoản đã liên kết với một tài khoản Facebook khác', 'FACEBOOK_ALREADY_LINKED');
    const [taken] = await query('SELECT accountId FROM Account WHERE facebookId = ? AND deletedAt IS NULL', [f.id], conn);
    if (taken) throw conflict('Tài khoản Facebook này đã liên kết với tài khoản khác', 'FACEBOOK_ACCOUNT_TAKEN');
    await query('UPDATE Account SET facebookId = ? WHERE accountId = ?', [f.id, acc.accountId], conn);
    return { linked: true };
  });
}
