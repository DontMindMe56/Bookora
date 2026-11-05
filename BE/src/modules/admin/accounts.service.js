import bcrypt from 'bcryptjs';
import { query, withTx } from '../../db.js';
import { audit } from '../../services/audit.js';
import { enqueueEmail } from '../../services/mailer.js';
import { conflict, forbidden, notFound } from '../../utils/errors.js';
import { normalizeEmail, escapeLike, nameLike } from '../../utils/text.js';
import { randomToken, uuid } from '../../utils/security.js';
import { issueSetPasswordLink } from '../auth/auth.service.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 20;

async function assertNotLastAdmin(conn, accountId) {
  const admins = await query(`SELECT accountId FROM Account WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY accountId FOR UPDATE`, [], conn);
  if (!admins.some((a) => a.accountId !== accountId)) throw conflict('Không thể thực hiện với quản trị viên hoạt động cuối cùng', 'LAST_ADMIN');
}

const revokeSessions = (conn, accountId) => query('UPDATE UserSession SET revokedAt = NOW() WHERE accountId = ? AND revokedAt IS NULL', [accountId], conn);

export async function listCustomers({ q, status, page: p }) {
  const where = ['a.deletedAt IS NULL'],
    params = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    const n = nameLike(['c.fullName'], q);
    where.push(`(${n.sql} OR a.email LIKE ? OR c.phone LIKE ?)`);
    params.push(...n.params, like, like);
  }
  if (status) {
    where.push('a.status = ?');
    params.push(status);
  }
  const from = `FROM Customer c JOIN Account a ON a.accountId = c.accountId WHERE ${where.join(' AND ')}`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from}`, params);
  const rows = await query(
    `SELECT c.customerId, a.accountId, c.fullName, a.email, c.phone, a.status, a.lastLoginAt, c.riskFlag, c.createdAt,
            (SELECT COUNT(*) FROM Orders o WHERE o.customerId = c.customerId) AS orderCount
       ${from} ORDER BY c.createdAt DESC, c.customerId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(p, PAGE_SIZE)],
  );
  return paged(rows, total, p, PAGE_SIZE);
}

export async function getCustomer(customerId) {
  const [c] = await query(
    `SELECT c.customerId, a.accountId, c.fullName, a.email, c.phone, c.dateOfBirth, c.gender, c.accountBalance, c.riskFlag, a.status, a.lockReason, a.lastLoginAt, c.createdAt
       FROM Customer c JOIN Account a ON a.accountId = c.accountId WHERE c.customerId = ?`,
    [customerId],
  );
  if (!c) throw notFound('Không tìm thấy khách hàng');
  const addresses = await query('SELECT * FROM Address WHERE customerId = ? ORDER BY isDefault DESC, lastUsedAt DESC', [customerId]);
  const orders = await query(
    `SELECT orderId, orderCode, orderStatus, paymentStatus, shippingStatus, paymentMethod, totalAmount, createdAt FROM Orders WHERE customerId = ? ORDER BY createdAt DESC LIMIT 50`,
    [customerId],
  );
  return { ...c, addresses, orders };
}

export async function lockAccount(actor, accountId, reason) {
  if (actor.accountId === accountId) throw forbidden('Không thể tự khóa tài khoản của mình', 'CANNOT_LOCK_SELF');
  return withTx(async (conn) => {
    const [a] = await query('SELECT accountId, role, status, email FROM Account WHERE accountId = ? FOR UPDATE', [accountId], conn);
    if (!a) throw notFound('Không tìm thấy tài khoản');
    if (a.status === 'LOCKED') throw conflict('Tài khoản đã bị khóa', 'ALREADY_LOCKED');
    if (a.role === 'ADMIN') await assertNotLastAdmin(conn, accountId);
    await query(`UPDATE Account SET status = 'LOCKED', lockReason = ? WHERE accountId = ?`, [reason, accountId], conn);
    await revokeSessions(conn, accountId);
    await enqueueEmail(conn, {
      dedupeKey: `account-locked:${accountId}:${Date.now()}`,
      to: a.email,
      subject: 'Tài khoản của bạn đã bị khóa',
      body: `Tài khoản của bạn đã bị khóa. Lý do: ${reason}`,
    });
    await audit(conn, {
      actorId: actor.accountId,
      action: 'LOCK',
      entityType: 'ACCOUNT',
      entityId: accountId,
      oldValue: { status: a.status },
      newValue: { status: 'LOCKED' },
      reason,
    });
    return { accountId, status: 'LOCKED' };
  });
}

export async function unlockAccount(actor, accountId, reason) {
  return withTx(async (conn) => {
    const [a] = await query('SELECT accountId, status, emailVerifiedAt FROM Account WHERE accountId = ? FOR UPDATE', [accountId], conn);
    if (!a) throw notFound('Không tìm thấy tài khoản');
    if (a.status !== 'LOCKED') throw conflict('Tài khoản không bị khóa', 'NOT_LOCKED');
    const status = a.emailVerifiedAt ? 'ACTIVE' : 'UNVERIFIED';
    await query('UPDATE Account SET status = ?, lockReason = NULL WHERE accountId = ?', [status, accountId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UNLOCK',
      entityType: 'ACCOUNT',
      entityId: accountId,
      oldValue: { status: 'LOCKED' },
      newValue: { status },
      reason,
    });
    return { accountId, status };
  });
}

export async function listStaff({ q, page: p }) {
  const n = q ? nameLike(['s.fullName'], q) : null;
  const where = q ? `WHERE ${n.sql} OR a.email LIKE ?` : '',
    params = q ? [...n.params, `%${escapeLike(q)}%`] : [];
  const from = `FROM Staff s JOIN Account a ON a.accountId = s.accountId ${where}`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${from}`, params);
  const rows = await query(
    `SELECT s.staffId, a.accountId, s.fullName, a.email, s.phone, s.position, a.role, a.status, a.lastLoginAt, s.createdAt ${from} ORDER BY s.createdAt DESC, s.staffId LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(p, PAGE_SIZE)],
  );
  return paged(rows, total, p, PAGE_SIZE);
}

export async function createStaff(actor, d) {
  const email = normalizeEmail(d.email);
  const hash = await bcrypt.hash(randomToken(), 10);
  return withTx(async (conn) => {
    const accountId = uuid(),
      staffId = uuid();
    try {
      await query(
        `INSERT INTO Account (accountId, email, passwordHash, role, status, emailVerifiedAt) VALUES (?,?,?,?, 'ACTIVE', NOW())`,
        [accountId, email, hash, d.role],
        conn,
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw conflict('Email đã được sử dụng', 'EMAIL_TAKEN');
      throw e;
    }
    await query(
      'INSERT INTO Staff (staffId, accountId, fullName, phone, position) VALUES (?,?,?,?,?)',
      [staffId, accountId, d.fullName, d.phone ?? null, d.position],
      conn,
    );
    await issueSetPasswordLink(conn, accountId, email, d.fullName);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CREATE',
      entityType: 'STAFF',
      entityId: staffId,
      newValue: { email, role: d.role, position: d.position },
    });
    return { staffId, accountId, email, role: d.role };
  });
}

export async function updateStaff(actor, staffId, d) {
  return withTx(async (conn) => {
    const [s] = await query(
      `SELECT s.*, a.role, a.email FROM Staff s JOIN Account a ON a.accountId = s.accountId WHERE s.staffId = ? FOR UPDATE`,
      [staffId],
      conn,
    );
    if (!s) throw notFound('Không tìm thấy nhân viên');
    const roleChanged = d.role && d.role !== s.role;
    if (roleChanged && s.role === 'ADMIN') await assertNotLastAdmin(conn, s.accountId);
    await query(
      'UPDATE Staff SET fullName = ?, phone = ?, position = ? WHERE staffId = ?',
      [d.fullName ?? s.fullName, d.phone === undefined ? s.phone : d.phone, d.position ?? s.position, staffId],
      conn,
    );
    if (roleChanged) {
      await query('UPDATE Account SET role = ? WHERE accountId = ?', [d.role, s.accountId], conn);
      await revokeSessions(conn, s.accountId);
    }
    await audit(conn, {
      actorId: actor.accountId,
      action: roleChanged ? 'CHANGE_ROLE' : 'UPDATE',
      entityType: 'STAFF',
      entityId: staffId,
      oldValue: { fullName: s.fullName, phone: s.phone, position: s.position, role: s.role },
      newValue: d,
    });
    return { staffId, role: d.role ?? s.role };
  });
}

export async function resendStaffLink(actor, staffId) {
  return withTx(async (conn) => {
    const [s] = await query(
      `SELECT s.fullName, a.accountId, a.email FROM Staff s JOIN Account a ON a.accountId = s.accountId WHERE s.staffId = ?`,
      [staffId],
      conn,
    );
    if (!s) throw notFound('Không tìm thấy nhân viên');
    await query(
      `UPDATE AuthToken SET revokedAt = NOW() WHERE accountId = ? AND tokenType = 'SET_PASSWORD' AND usedAt IS NULL AND revokedAt IS NULL`,
      [s.accountId],
      conn,
    );
    await issueSetPasswordLink(conn, s.accountId, s.email, s.fullName);
    return { sent: true };
  });
}
