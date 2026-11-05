import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { unauthorized, forbidden } from '../utils/errors.js';
import { getInt } from '../services/params.js';
import { asyncHandler } from '../utils/http.js';

/**
 * Xác thực: JWT chỉ mang sessionId; hiệu lực thật nằm ở bảng UserSession
 * => khóa tài khoản / đổi mật khẩu / thu hồi phiên có hiệu lực NGAY.
 */
async function resolveUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  let payload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret);
  } catch {
    throw unauthorized('Phiên đăng nhập không hợp lệ', 'INVALID_TOKEN');
  }

  const [row] = await query(
    `SELECT s.sessionId, s.expiresAt, s.revokedAt, a.accountId, a.role, a.status, c.customerId, st.staffId
       FROM UserSession s
       JOIN Account a ON a.accountId = s.accountId
       LEFT JOIN Customer c ON c.accountId = a.accountId
       LEFT JOIN Staff st ON st.accountId = a.accountId
      WHERE s.sessionId = ?`,
    [payload.sid],
  );

  if (!row || row.revokedAt || row.expiresAt <= new Date()) throw unauthorized('Phiên đăng nhập đã hết hạn', 'SESSION_EXPIRED');
  if (row.status !== 'ACTIVE') throw unauthorized('Tài khoản không còn hoạt động', 'ACCOUNT_INACTIVE');

  // Nhân viên/admin: hết hiệu lực sau N phút không thao tác (trượt)
  if (row.role !== 'CUSTOMER') {
    const idle = await getInt('STAFF_SESSION_IDLE_MINUTES');
    await query(`UPDATE UserSession SET lastActiveAt=NOW(), expiresAt = NOW() + INTERVAL ? MINUTE WHERE sessionId=?`, [idle, row.sessionId]);
  }
  return { accountId: row.accountId, role: row.role, sessionId: row.sessionId, customerId: row.customerId, staffId: row.staffId };
}

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = await resolveUser(req);
  next();
});

export const requireAuth = asyncHandler(async (req, _res, next) => {
  req.user = await resolveUser(req);
  if (!req.user) throw unauthorized();
  next();
});

/** Kiểm tra vai trò ở từng thao tác (ADMIN có toàn bộ quyền của STAFF). */
export const requireRole = (...roles) => {
  const check = (req, _res, next) => (roles.includes(req.user.role) ? next() : next(forbidden()));
  check.docRoles = roles;
  return [requireAuth, check];
};

const customerOnly = (req, _res, next) => (req.user.customerId ? next() : next(forbidden('Chỉ khách hàng mới dùng được chức năng này')));
customerOnly.docRoles = ['CUSTOMER'];
export const requireCustomer = [requireAuth, customerOnly];
requireAuth.docRoles = ['ANY'];
