import { OAuth2Client } from 'google-auth-library';
import { config } from '../../config.js';
import { query, withTx } from '../../db.js';
import { AppError, forbidden, unauthorized } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/text.js';
import { uuid } from '../../utils/security.js';
import { mergeGuestCart } from '../cart/cart.service.js';
import { createSession } from './auth.service.js';

let client;

async function verifyGoogleToken(idToken) {
  if (!config.google.clientId) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Chưa cấu hình GOOGLE_CLIENT_ID');
  client ??= new OAuth2Client(config.google.clientId);
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: config.google.clientId });
    return ticket.getPayload();
  } catch {
    throw unauthorized('Google ID token không hợp lệ', 'INVALID_GOOGLE_TOKEN');
  }
}

/**
 * Đăng nhập / đăng ký bằng Google (frontend lấy ID token qua Google Identity Services).
 * Email đã có: liên kết googleId; nếu tài khoản email chưa xác thực thì xóa mật khẩu cũ (người đăng ký trước không được giữ quyền vào).
 */
export async function googleLogin({ idToken, ip, userAgent, cartSessionId }) {
  const g = await verifyGoogleToken(idToken);
  if (!g.email || !g.email_verified) throw forbidden('Email Google chưa được xác thực', 'GOOGLE_EMAIL_NOT_VERIFIED');
  const email = normalizeEmail(g.email);

  return withTx(async (conn) => {
    let [acc] = await query('SELECT * FROM Account WHERE (googleId = ? OR email = ?) AND deletedAt IS NULL FOR UPDATE', [g.sub, email], conn);
    if (acc && acc.role !== 'CUSTOMER') throw forbidden('Tài khoản nhân viên không đăng nhập bằng Google', 'GOOGLE_NOT_ALLOWED');
    if (acc?.status === 'LOCKED') throw forbidden('Tài khoản đã bị khóa', 'ACCOUNT_LOCKED');
    if (acc?.googleId && acc.googleId !== g.sub) throw forbidden('Email này đã liên kết với tài khoản Google khác', 'GOOGLE_ACCOUNT_MISMATCH');

    if (!acc) {
      const accountId = uuid();
      await query(
        `INSERT INTO Account (accountId, email, passwordHash, role, status, emailVerifiedAt, googleId, termsAcceptedAt) VALUES (?,?,NULL,'CUSTOMER','ACTIVE',NOW(),?,NOW())`,
        [accountId, email, g.sub],
        conn,
      );
      await query(
        'INSERT INTO Customer (customerId, accountId, fullName) VALUES (?,?,?)',
        [uuid(), accountId, (g.name || email.split('@')[0]).slice(0, 100)],
        conn,
      );
      [acc] = await query('SELECT * FROM Account WHERE accountId = ?', [accountId], conn);
    } else if (!acc.googleId || acc.status === 'UNVERIFIED') {
      await query(
        `UPDATE Account SET passwordHash = IF(status = 'UNVERIFIED', NULL, passwordHash), googleId = ?, status = 'ACTIVE', emailVerifiedAt = COALESCE(emailVerifiedAt, NOW()) WHERE accountId = ?`,
        [g.sub, acc.accountId],
        conn,
      );
      if (acc.status === 'UNVERIFIED')
        await query(`UPDATE AuthToken SET revokedAt = NOW() WHERE accountId = ? AND usedAt IS NULL AND revokedAt IS NULL`, [acc.accountId], conn);
    }

    await query('UPDATE Account SET lastLoginAt = NOW() WHERE accountId = ?', [acc.accountId], conn);
    const session = await createSession(conn, acc, { ip, userAgent });
    const [c] = await query('SELECT customerId FROM Customer WHERE accountId = ?', [acc.accountId], conn);
    await mergeGuestCart(conn, cartSessionId, c?.customerId);
    return { ...session, role: acc.role };
  });
}
