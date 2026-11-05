import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { escapeLike, nameLike } from '../../utils/text.js';
import { audit } from '../../services/audit.js';
import { notFound, conflict } from '../../utils/errors.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 20;

export async function listSuppliers({ q, status, page }) {
  const where = [],
    params = [];
  if (q) {
    const n = nameLike(['name'], q);
    where.push(`(${n.sql} OR phone LIKE ? OR email LIKE ?)`);
    const like = `%${escapeLike(q)}%`;
    params.push(...n.params, like, like);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM Supplier ${w}`, params);
  const items = await query(`SELECT * FROM Supplier ${w} ORDER BY name LIMIT ? OFFSET ?`, [...params, ...limitOffset(page, PAGE_SIZE)]);
  return paged(items, total, page, PAGE_SIZE);
}

export async function getSupplier(supplierId) {
  const [supplier] = await query('SELECT * FROM Supplier WHERE supplierId = ?', [supplierId]);
  if (!supplier) throw notFound('Không tìm thấy nhà cung cấp');
  // Danh sách đầu sách đã nhập từ nhà cung cấp này: suy ra từ các phiếu nhập đã xác nhận
  const editions = await query(
    `SELECT e.editionId, e.isbn, w.title, COUNT(DISTINCT v.voucherId) AS voucherCount,
            SUM(d.quantity) AS totalQuantity, MAX(v.importDate) AS lastImportDate
       FROM ImportVoucher v
       JOIN ImportVoucherDetail d ON d.voucherId = v.voucherId
       JOIN Edition e ON e.editionId = d.editionId
       JOIN Work w ON w.workId = e.workId
      WHERE v.supplierId = ? AND v.status = 'CONFIRMED'
      GROUP BY e.editionId, e.isbn, w.title
      ORDER BY lastImportDate DESC`,
    [supplierId],
  );
  return { ...supplier, editions };
}

export async function createSupplier(actor, d) {
  return withTx(async (conn) => {
    const [dup] = await query('SELECT supplierId FROM Supplier WHERE name = ? AND phone = ? LIMIT 1', [d.name, d.phone], conn);
    if (dup) throw conflict('Nhà cung cấp này đã tồn tại (trùng tên và số điện thoại)', 'SUPPLIER_EXISTS');
    const supplierId = uuid();
    await query(
      `INSERT INTO Supplier (supplierId, name, phone, email, address, leadTimeDays) VALUES (?,?,?,?,?,?)`,
      [supplierId, d.name, d.phone, d.email ?? null, d.address, d.leadTimeDays],
      conn,
    );
    await audit(conn, { actorId: actor.accountId, action: 'CREATE', entityType: 'SUPPLIER', entityId: supplierId, newValue: d });
    return { supplierId };
  });
}

export async function updateSupplier(actor, supplierId, patch) {
  return withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM Supplier WHERE supplierId = ? FOR UPDATE', [supplierId], conn);
    if (!cur) throw notFound('Không tìm thấy nhà cung cấp');
    const sets = [],
      params = [],
      oldValue = {},
      newValue = {};
    for (const k of ['name', 'phone', 'email', 'address', 'leadTimeDays', 'status']) {
      if (patch[k] === undefined || patch[k] === cur[k]) continue;
      sets.push(`${k} = ?`);
      params.push(patch[k]);
      oldValue[k] = cur[k];
      newValue[k] = patch[k];
    }
    if (!sets.length) return { supplierId, changed: false };
    await query(`UPDATE Supplier SET ${sets.join(', ')} WHERE supplierId = ?`, [...params, supplierId], conn);
    await audit(conn, { actorId: actor.accountId, action: 'UPDATE', entityType: 'SUPPLIER', entityId: supplierId, oldValue, newValue });
    return { supplierId, changed: true };
  });
}

/** Xóa nhà cung cấp: đã có phiếu nhập/phiếu đặt/được đặt làm mặc định => chỉ chuyển "Ngừng hợp tác". */
export async function removeSupplier(actor, supplierId) {
  return withTx(async (conn) => {
    const [cur] = await query('SELECT * FROM Supplier WHERE supplierId = ? FOR UPDATE', [supplierId], conn);
    if (!cur) throw notFound('Không tìm thấy nhà cung cấp');
    const [{ used }] = await query(
      `SELECT (SELECT COUNT(*) FROM ImportVoucher WHERE supplierId = ?)
            + (SELECT COUNT(*) FROM PurchaseOrder WHERE supplierId = ?)
            + (SELECT COUNT(*) FROM Inventory WHERE defaultSupplierId = ?) AS used`,
      [supplierId, supplierId, supplierId],
      conn,
    );
    if (used > 0) {
      await query(`UPDATE Supplier SET status = 'INACTIVE' WHERE supplierId = ?`, [supplierId], conn);
      await audit(conn, {
        actorId: actor.accountId,
        action: 'DEACTIVATE',
        entityType: 'SUPPLIER',
        entityId: supplierId,
        oldValue: { status: cur.status },
        newValue: { status: 'INACTIVE' },
      });
      return { deleted: false, status: 'INACTIVE' };
    }
    await query('DELETE FROM Supplier WHERE supplierId = ?', [supplierId], conn);
    await audit(conn, { actorId: actor.accountId, action: 'DELETE', entityType: 'SUPPLIER', entityId: supplierId, oldValue: cur });
    return { deleted: true };
  });
}
