import { query, withTx } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { getInt } from '../../services/params.js';
import { conflict, notFound } from '../../utils/errors.js';
import { resolveLocation } from '../geo/geo.service.js';

const FIELDS = `addressId, receiverName, phone, province, district, ward, ghnProvinceId, ghnDistrictId, ghnWardCode, detail, isDefault, needsConfirm, lastUsedAt`;
const present = (r) => ({ ...r, isDefault: !!r.isDefault, needsConfirm: !!r.needsConfirm });

/** Khóa dòng khách hàng để các thao tác sổ địa chỉ của cùng một khách chạy lần lượt (đếm giới hạn, đổi mặc định). */
const lockCustomer = (conn, customerId) => query('SELECT customerId FROM Customer WHERE customerId = ? FOR UPDATE', [customerId], conn);

export async function listAddresses(customerId) {
  const rows = await query(`SELECT ${FIELDS} FROM Address WHERE customerId = ? ORDER BY isDefault DESC, lastUsedAt DESC, addressId`, [customerId]);
  return { items: rows.map(present) };
}

export async function getAddress(customerId, addressId, conn) {
  const [r] = await query(`SELECT ${FIELDS} FROM Address WHERE addressId = ? AND customerId = ?`, [addressId, customerId], conn);
  if (!r) throw notFound('Không tìm thấy địa chỉ');
  return present(r);
}

async function setDefault(conn, customerId, addressId) {
  await query('UPDATE Address SET isDefault = (addressId = ?) WHERE customerId = ?', [addressId, customerId], conn);
}

export async function createAddress(customerId, d) {
  return withTx(async (conn) => {
    await lockCustomer(conn, customerId);
    const max = await getInt('MAX_ADDRESSES');
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM Address WHERE customerId = ?', [customerId], conn);
    if (n >= max) throw conflict(`Chỉ lưu tối đa ${max} địa chỉ`, 'ADDRESS_LIMIT');
    const loc = await resolveLocation(conn, d);
    const addressId = uuid();
    await query(
      `INSERT INTO Address (addressId, customerId, receiverName, phone, province, district, ward, ghnProvinceId, ghnDistrictId, ghnWardCode, detail, isDefault)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,FALSE)`,
      [addressId, customerId, d.receiverName, d.phone, loc.province, loc.district, loc.ward, d.ghnProvinceId, d.ghnDistrictId, d.ghnWardCode, d.detail],
      conn,
    );
    if (n === 0 || d.isDefault) await setDefault(conn, customerId, addressId); // địa chỉ đầu tiên tự là mặc định
    return getAddress(customerId, addressId, conn);
  });
}

/** Sửa địa chỉ. Khách đã chọn lại khu vực thì cờ needsConfirm được gỡ. isDefault chỉ có thể đặt true (đổi mặc định bằng cách chọn địa chỉ khác). */
export async function updateAddress(customerId, addressId, d) {
  return withTx(async (conn) => {
    await lockCustomer(conn, customerId);
    await getAddress(customerId, addressId, conn);
    const sets = [],
      params = [];
    for (const k of ['receiverName', 'phone', 'detail'])
      if (d[k] !== undefined) {
        sets.push(`${k} = ?`);
        params.push(d[k]);
      }
    if (d.ghnWardCode !== undefined) {
      const loc = await resolveLocation(conn, d);
      sets.push('province = ?', 'district = ?', 'ward = ?', 'ghnProvinceId = ?', 'ghnDistrictId = ?', 'ghnWardCode = ?', 'needsConfirm = FALSE');
      params.push(loc.province, loc.district, loc.ward, d.ghnProvinceId, d.ghnDistrictId, d.ghnWardCode);
    }
    if (sets.length) await query(`UPDATE Address SET ${sets.join(', ')} WHERE addressId = ?`, [...params, addressId], conn);
    if (d.isDefault) await setDefault(conn, customerId, addressId);
    return getAddress(customerId, addressId, conn);
  });
}

/** Giữ nguyên khu vực cũ nhưng xác nhận lại (sau khi GHN đổi địa giới): chỉ thành công nếu bộ mã còn hợp lệ, tên được cập nhật theo danh mục. */
export async function confirmAddress(customerId, addressId) {
  return withTx(async (conn) => {
    await lockCustomer(conn, customerId);
    const a = await getAddress(customerId, addressId, conn);
    const loc = await resolveLocation(conn, { ghnProvinceId: a.ghnProvinceId, ghnDistrictId: a.ghnDistrictId, ghnWardCode: a.ghnWardCode });
    await query(
      'UPDATE Address SET province = ?, district = ?, ward = ?, needsConfirm = FALSE WHERE addressId = ?',
      [loc.province, loc.district, loc.ward, addressId],
      conn,
    );
    return getAddress(customerId, addressId, conn);
  });
}

export async function makeDefault(customerId, addressId) {
  return withTx(async (conn) => {
    await lockCustomer(conn, customerId);
    await getAddress(customerId, addressId, conn);
    await setDefault(conn, customerId, addressId);
    return getAddress(customerId, addressId, conn);
  });
}

/** Xóa địa chỉ; nếu xóa địa chỉ mặc định thì chọn địa chỉ dùng gần nhất làm mặc định mới. */
export async function deleteAddress(customerId, addressId) {
  return withTx(async (conn) => {
    await lockCustomer(conn, customerId);
    const a = await getAddress(customerId, addressId, conn);
    await query('DELETE FROM Address WHERE addressId = ?', [addressId], conn);
    let newDefaultId = null;
    if (a.isDefault) {
      const [next] = await query('SELECT addressId FROM Address WHERE customerId = ? ORDER BY lastUsedAt DESC, addressId LIMIT 1', [customerId], conn);
      if (next) {
        newDefaultId = next.addressId;
        await setDefault(conn, customerId, newDefaultId);
      }
    }
    return { deleted: true, newDefaultId };
  });
}

/** Dùng khi đặt hàng: ghi nhận thời điểm dùng địa chỉ (phục vụ chọn mặc định mới). */
export const touchAddress = (conn, addressId) => query('UPDATE Address SET lastUsedAt = NOW() WHERE addressId = ?', [addressId], conn);
