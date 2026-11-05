import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { pool, query, withTx } from '../../db.js';
import { badRequest, conflict, forbidden, notFound, tooMany, unauthorized } from '../../utils/errors.js';
import { normalizeEmail } from '../../utils/text.js';
import { randomToken, sha256, uuid } from '../../utils/security.js';
import { getInt } from '../../services/params.js';
import { enqueueEmail } from '../../services/mailer.js';
import { mergeGuestCart } from '../cart/cart.service.js';

const HOUR = 3600_000,
  MINUTE = 60_000;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10); // chống dò email qua thời gian phản hồi

// ---------- token dùng một lần ----------
async function createAuthToken(conn, accountId, type, ttlMs, { fresh = false } = {}) {
  // Yêu cầu link mới => link cũ mất hiệu lực. Chọn trước rồi thu hồi theo khóa chính (không khóa khoảng trống của index
  // => không deadlock khi nhiều yêu cầu song song); tài khoản vừa tạo (fresh) chưa có token nào nên bỏ qua.
  if (!fresh) {
    const old = await query(
      `SELECT tokenId FROM AuthToken WHERE accountId=? AND tokenType=? AND usedAt IS NULL AND revokedAt IS NULL`,
      [accountId, type],
      conn,
    );
    if (old.length) await query(`UPDATE AuthToken SET revokedAt=NOW() WHERE tokenId IN (?)`, [old.map((t) => t.tokenId)], conn);
  }
  const raw = randomToken();
  await query(
    `INSERT INTO AuthToken (tokenId, accountId, tokenType, tokenHash, expiresAt) VALUES (?,?,?,?,?)`,
    [uuid(), accountId, type, sha256(raw), new Date(Date.now() + ttlMs)],
    conn,
  );
  return raw;
}

async function consumeAuthToken(conn, raw, type) {
  const [t] = await query(`SELECT * FROM AuthToken WHERE tokenHash=? AND tokenType=? FOR UPDATE`, [sha256(raw), type], conn);
  if (!t || t.usedAt || t.revokedAt || t.expiresAt <= new Date()) throw badRequest('Liên kết không hợp lệ hoặc đã hết hạn', 'INVALID_TOKEN');
  await query(`UPDATE AuthToken SET usedAt=NOW() WHERE tokenId=?`, [t.tokenId], conn);
  return t;
}

const revokeAllSessions = (conn, accountId) => query(`UPDATE UserSession SET revokedAt=NOW() WHERE accountId=? AND revokedAt IS NULL`, [accountId], conn);

export async function sendVerifyEmail(conn, accountId, email, { fresh = false } = {}) {
  const raw = await createAuthToken(conn, accountId, 'VERIFY_EMAIL', (await getInt('VERIFY_LINK_HOURS')) * HOUR, { fresh });
  await enqueueEmail(conn, {
    dedupeKey: `VERIFY_EMAIL:${sha256(raw).slice(0, 16)}`,
    to: email,
    subject: 'Xác thực email tài khoản nhà sách',
    body: `Vui lòng mở liên kết sau để xác thực email (hiệu lực ${await getInt('VERIFY_LINK_HOURS')} giờ, dùng một lần):\n${config.appUrl}/verify-email?token=${raw}`,
  });
}

/** Gửi lại email xác thực (dùng cho đăng nhập mạng xã hội): gửi quá dày thì bỏ qua thay vì ném lỗi, để không dồn email / không thu hồi link cũ liên tục. Trả true nếu đã gửi. */
export async function sendVerifyEmailIfDue(conn, accountId, email) {
  const [last] = await query(
    `SELECT createdAt FROM AuthToken WHERE accountId=? AND tokenType='VERIFY_EMAIL' ORDER BY createdAt DESC LIMIT 1`,
    [accountId],
    conn,
  );
  if (last && Date.now() - last.createdAt.getTime() < MINUTE) return false;
  await sendVerifyEmail(conn, accountId, email);
  return true;
}

// ---------- đăng ký / xác thực ----------
export async function register({ email, password, fullName, phone }) {
  email = normalizeEmail(email);
  const hash = await bcrypt.hash(password, 10);
  await withTx(async (conn) => {
    const accountId = uuid();
    try {
      await query(
        `INSERT INTO Account (accountId, email, passwordHash, role, status, termsAcceptedAt) VALUES (?,?,?,'CUSTOMER','UNVERIFIED',NOW())`,
        [accountId, email, hash],
        conn,
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw conflict('Email đã được sử dụng', 'EMAIL_TAKEN');
      throw e;
    }
    await query(`INSERT INTO Customer (customerId, accountId, fullName, phone) VALUES (?,?,?,?)`, [uuid(), accountId, fullName.trim(), phone ?? null], conn);
    await sendVerifyEmail(conn, accountId, email, { fresh: true });
  });
}

export async function verifyEmail(token) {
  await withTx(async (conn) => {
    const t = await consumeAuthToken(conn, token, 'VERIFY_EMAIL');
    await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE accountId=? AND status='UNVERIFIED'`, [t.accountId], conn);
  });
}

export async function resendVerification(email) {
  email = normalizeEmail(email);
  await withTx(async (conn) => {
    const [acc] = await query(`SELECT accountId, status FROM Account WHERE email=? FOR UPDATE`, [email], conn);
    if (!acc || acc.status !== 'UNVERIFIED') return; // không lộ email có tồn tại hay không
    const [last] = await query(
      `SELECT createdAt FROM AuthToken WHERE accountId=? AND tokenType='VERIFY_EMAIL' ORDER BY createdAt DESC LIMIT 1`,
      [acc.accountId],
      conn,
    );
    if (last && Date.now() - last.createdAt.getTime() < MINUTE) throw tooMany('Vui lòng đợi 1 phút trước khi yêu cầu gửi lại', 'RESEND_TOO_SOON');
    await sendVerifyEmail(conn, acc.accountId, email);
  });
}

// ---------- đăng nhập ----------
async function recordFailure(email, ip) {
  const [maxFails, lockMin] = [await getInt('MAX_LOGIN_FAILS'), await getInt('LOGIN_LOCK_MINUTES')];
  // lockedUntil được tính trước khi failedCount đổi (MySQL gán theo thứ tự trái → phải)
  await query(
    `INSERT INTO LoginAttempt (email, ipAddress, failedCount) VALUES (?,?,1)
     ON DUPLICATE KEY UPDATE
       lockedUntil = IF(failedCount + 1 >= ?, NOW() + INTERVAL ? MINUTE, lockedUntil),
       failedCount = IF(failedCount + 1 >= ?, 0, failedCount + 1)`,
    [email, ip, maxFails, lockMin, maxFails],
  );
}

export async function createSession(conn, account, { ip, userAgent }) {
  const sessionId = uuid();
  const ttlMs = account.role === 'CUSTOMER' ? (await getInt('CUSTOMER_SESSION_DAYS')) * 24 * HOUR : (await getInt('STAFF_SESSION_IDLE_MINUTES')) * MINUTE;
  await query(
    `INSERT INTO UserSession (sessionId, accountId, ipAddress, userAgent, expiresAt) VALUES (?,?,?,?,?)`,
    [sessionId, account.accountId, ip?.slice(0, 45) ?? null, userAgent?.slice(0, 255) ?? null, new Date(Date.now() + ttlMs)],
    conn,
  );
  const token = jwt.sign({ sid: sessionId, sub: account.accountId }, config.jwtSecret, { expiresIn: '31d' });
  return { token, expiresAt: new Date(Date.now() + ttlMs) };
}

export async function login({ email, password, ip, userAgent, cartSessionId }) {
  email = normalizeEmail(email);
  const [att] = await query(`SELECT lockedUntil FROM LoginAttempt WHERE email=? AND ipAddress=?`, [email, ip]);
  if (att?.lockedUntil && att.lockedUntil > new Date()) throw tooMany('Đăng nhập sai quá nhiều lần, vui lòng thử lại sau', 'LOGIN_LOCKED');

  const [acc] = await query(`SELECT * FROM Account WHERE email=? AND deletedAt IS NULL`, [email]);
  const ok = await bcrypt.compare(password, acc?.passwordHash || DUMMY_HASH);
  if (!acc || !acc.passwordHash || !ok) {
    await recordFailure(email, ip);
    throw unauthorized('Email hoặc mật khẩu không đúng', 'INVALID_CREDENTIALS');
  }
  if (acc.status === 'UNVERIFIED') throw forbidden('Vui lòng xác thực email trước khi đăng nhập', 'EMAIL_NOT_VERIFIED');
  if (acc.status === 'LOCKED') throw forbidden('Tài khoản đã bị khóa', 'ACCOUNT_LOCKED');

  return withTx(async (conn) => {
    await query(`DELETE FROM LoginAttempt WHERE email=? AND ipAddress=?`, [email, ip], conn); // đăng nhập đúng => reset
    await query(`UPDATE Account SET lastLoginAt=NOW() WHERE accountId=?`, [acc.accountId], conn);
    const session = await createSession(conn, acc, { ip, userAgent });
    if (acc.role === 'CUSTOMER') {
      const [c] = await query(`SELECT customerId FROM Customer WHERE accountId=?`, [acc.accountId], conn);
      await mergeGuestCart(conn, cartSessionId, c?.customerId);
    }
    return { ...session, role: acc.role };
  });
}

export const logout = (sessionId) => query(`UPDATE UserSession SET revokedAt=NOW() WHERE sessionId=? AND revokedAt IS NULL`, [sessionId]);

// ---------- quên / đặt lại mật khẩu ----------
export async function forgotPassword(email) {
  email = normalizeEmail(email);
  await withTx(async (conn) => {
    const [acc] = await query(`SELECT accountId, status FROM Account WHERE email=? AND deletedAt IS NULL FOR UPDATE`, [email], conn);
    if (!acc || acc.status !== 'ACTIVE') return; // luôn trả 200 để không lộ email tồn tại
    const mins = await getInt('RESET_LINK_MINUTES');
    const raw = await createAuthToken(conn, acc.accountId, 'RESET_PASSWORD', mins * MINUTE);
    await enqueueEmail(conn, {
      dedupeKey: `RESET_PASSWORD:${sha256(raw).slice(0, 16)}`,
      to: email,
      subject: 'Đặt lại mật khẩu',
      body: `Mở liên kết để đặt lại mật khẩu (hiệu lực ${mins} phút, dùng một lần):\n${config.appUrl}/reset-password?token=${raw}`,
    });
  });
}

export async function resetPassword(token, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  await withTx(async (conn) => {
    const t = await consumeAuthToken(conn, token, 'RESET_PASSWORD');
    await query(`UPDATE Account SET passwordHash=? WHERE accountId=?`, [hash, t.accountId], conn);
    await revokeAllSessions(conn, t.accountId); // mọi phiên đang có mất hiệu lực
  });
}

export async function changePassword(user, { currentPassword, newPassword }) {
  const [acc] = await query('SELECT passwordHash FROM Account WHERE accountId=?', [user.accountId]);
  if (!acc?.passwordHash || !(await bcrypt.compare(currentPassword, acc.passwordHash))) throw badRequest('Mật khẩu hiện tại không đúng', 'WRONG_PASSWORD');
  if (currentPassword === newPassword) throw badRequest('Mật khẩu mới phải khác mật khẩu hiện tại', 'SAME_PASSWORD');
  const hash = await bcrypt.hash(newPassword, 10);
  await withTx(async (conn) => {
    await query('UPDATE Account SET passwordHash=? WHERE accountId=?', [hash, user.accountId], conn);
    await revokeAllSessions(conn, user.accountId);
  });
}

export async function setPassword(token, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  await withTx(async (conn) => {
    const t = await consumeAuthToken(conn, token, 'SET_PASSWORD');
    await query(`UPDATE Account SET passwordHash=? WHERE accountId=?`, [hash, t.accountId], conn);
  });
}

export const issueSetPasswordLink = async (conn, accountId, email, fullName) => {
  const hours = await getInt('SET_PASSWORD_LINK_HOURS');
  const raw = await createAuthToken(conn, accountId, 'SET_PASSWORD', hours * HOUR, { fresh: true });
  await enqueueEmail(conn, {
    dedupeKey: `SET_PASSWORD:${sha256(raw).slice(0, 16)}`,
    to: email,
    subject: 'Đặt mật khẩu tài khoản nhân viên',
    body: `Xin chào ${fullName},\n\nMở liên kết để đặt mật khẩu (hiệu lực ${hours} giờ, dùng một lần):\n${config.appUrl}/set-password?token=${raw}`,
  });
};

// ---------- hồ sơ ----------
export async function getMe(user) {
  const [acc] = await query(`SELECT accountId, email, role, status, emailVerifiedAt, createdAt FROM Account WHERE accountId=?`, [user.accountId]);
  if (!acc) throw notFound();
  const [profile] = user.customerId
    ? await query(`SELECT customerId, fullName, phone, dateOfBirth, gender, accountBalance FROM Customer WHERE customerId=?`, [user.customerId])
    : await query(`SELECT staffId, fullName, phone, position FROM Staff WHERE staffId=?`, [user.staffId]);
  return { ...acc, profile };
}

export async function updateProfile(user, { fullName, phone, dateOfBirth, gender }) {
  if (!user.customerId) throw forbidden();
  await query(
    `UPDATE Customer SET fullName=COALESCE(?,fullName), phone=COALESCE(?,phone), dateOfBirth=COALESCE(?,dateOfBirth), gender=COALESCE(?,gender) WHERE customerId=?`,
    [fullName ?? null, phone ?? null, dateOfBirth ?? null, gender ?? null, user.customerId],
  );
  return getMe(user);
}

/** Dùng cho script khởi tạo: tạo quản trị viên đầu tiên (đã xác thực sẵn). */
export async function createStaffAccount({ email, password, fullName, role = 'ADMIN', position = 'Quản trị viên' }) {
  const hash = await bcrypt.hash(password, 10);
  return withTx(async (conn) => {
    const accountId = uuid();
    await query(
      `INSERT INTO Account (accountId, email, passwordHash, role, status, emailVerifiedAt) VALUES (?,?,?,?, 'ACTIVE', NOW())`,
      [accountId, normalizeEmail(email), hash, role],
      conn,
    );
    const staffId = uuid();
    await query(`INSERT INTO Staff (staffId, accountId, fullName, position) VALUES (?,?,?,?)`, [staffId, accountId, fullName, position], conn);
    return { accountId, staffId };
  });
}
export { pool };
