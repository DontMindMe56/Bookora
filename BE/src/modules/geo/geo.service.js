import { query, withTx } from '../../db.js';
import { ghnCall } from '../../services/ghn.js';
import { audit } from '../../services/audit.js';
import { conflict, unprocessable, AppError } from '../../utils/errors.js';

export const listProvinces = () => query('SELECT provinceId, name FROM GhnProvince WHERE active ORDER BY name');
export const listDistricts = (provinceId) =>
  query('SELECT districtId, provinceId, name FROM GhnDistrict WHERE provinceId = ? AND active ORDER BY name', [provinceId]);
export const listWards = (districtId) => query('SELECT wardCode, districtId, name FROM GhnWard WHERE districtId = ? AND active ORDER BY name', [districtId]);

/**
 * Kiểm tra bộ ba (tỉnh, quận, phường) nằm trong danh mục GHN đang hoạt động và khớp phân cấp.
 * Trả về tên chuẩn từ danh mục (không tin tên do client gửi).
 */
export async function resolveLocation(conn, { ghnProvinceId, ghnDistrictId, ghnWardCode }) {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM GhnProvince WHERE active', [], conn);
  if (!n) throw new AppError(503, 'GHN_CATALOG_EMPTY', 'Danh mục địa giới GHN chưa được đồng bộ');
  const [r] = await query(
    `SELECT p.name AS province, d.name AS district, w.name AS ward
       FROM GhnWard w JOIN GhnDistrict d ON d.districtId = w.districtId JOIN GhnProvince p ON p.provinceId = d.provinceId
      WHERE w.wardCode = ? AND w.districtId = ? AND d.provinceId = ? AND w.active AND d.active AND p.active`,
    [ghnWardCode, ghnDistrictId, ghnProvinceId],
    conn,
  );
  if (!r) throw unprocessable('Địa chỉ không nằm trong vùng GHN giao hàng', 'ADDRESS_NOT_IN_GHN');
  return r;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}
async function insertChunks(conn, sql, rows) {
  for (let i = 0; i < rows.length; i += 1000) await query(sql, [rows.slice(i, i + 1000)], conn);
}

let running = false;
export const syncState = { lastRunAt: null, lastResult: null, lastError: null };

/**
 * Đồng bộ danh mục từ GHN. Lấy đủ dữ liệu trước rồi mới ghi trong MỘT transaction:
 * lỗi giữa chừng không làm mất danh mục cũ; mục GHN không còn trả về chỉ bị đánh dấu inactive.
 * Địa chỉ khách có phường/quận bị đổi tên hoặc biến mất được gắn needsConfirm để khách xác nhận lại.
 */
export async function syncGhnCatalog(actor) {
  if (running) throw conflict('Đang đồng bộ danh mục GHN', 'SYNC_RUNNING');
  running = true;
  try {
    const provinces = (await ghnCall('/master-data/province', { method: 'GET', log: false })) || [];
    if (!provinces.length) throw new AppError(502, 'GHN_EMPTY_CATALOG', 'GHN trả về danh mục rỗng, giữ nguyên dữ liệu cũ');
    const districts = [],
      wards = [];
    await mapLimit(provinces, 5, async (p) => {
      for (const d of (await ghnCall('/master-data/district', { method: 'GET', params: { province_id: p.ProvinceID }, log: false })) || [])
        districts.push([d.DistrictID, p.ProvinceID, d.DistrictName]);
    });
    await mapLimit(districts, 5, async (d) => {
      for (const w of (await ghnCall('/master-data/ward', { method: 'GET', params: { district_id: d[0] }, log: false })) || [])
        wards.push([d[0], String(w.WardCode), w.WardName]);
    });

    const result = await withTx(async (conn) => {
      for (const t of ['GhnWard', 'GhnDistrict', 'GhnProvince']) await query(`UPDATE ${t} SET active = FALSE`, [], conn);
      await insertChunks(
        conn,
        'INSERT INTO GhnProvince (provinceId, name) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name), active = TRUE',
        provinces.map((p) => [p.ProvinceID, p.ProvinceName]),
      );
      await insertChunks(
        conn,
        'INSERT INTO GhnDistrict (districtId, provinceId, name) VALUES ? ON DUPLICATE KEY UPDATE provinceId = VALUES(provinceId), name = VALUES(name), active = TRUE',
        districts,
      );
      await insertChunks(conn, 'INSERT INTO GhnWard (districtId, wardCode, name) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name), active = TRUE', wards);
      const flagged = await query(
        `UPDATE Address a
           LEFT JOIN GhnWard w ON w.districtId = a.ghnDistrictId AND w.wardCode = a.ghnWardCode AND w.active
           LEFT JOIN GhnDistrict d ON d.districtId = a.ghnDistrictId AND d.active
            SET a.needsConfirm = TRUE
          WHERE a.ghnWardCode IS NOT NULL AND a.needsConfirm = FALSE
            AND (w.wardCode IS NULL OR d.districtId IS NULL OR NOT (w.name <=> a.ward) OR NOT (d.name <=> a.district))`,
        [],
        conn,
      );
      const summary = { provinces: provinces.length, districts: districts.length, wards: wards.length, addressesNeedConfirm: flagged.affectedRows };
      await audit(conn, { actorId: actor?.accountId ?? null, action: 'SYNC', entityType: 'GHN_CATALOG', newValue: summary });
      return summary;
    });
    Object.assign(syncState, { lastRunAt: new Date(), lastResult: result, lastError: null });
    return result;
  } catch (e) {
    Object.assign(syncState, { lastRunAt: new Date(), lastError: e.message });
    throw e;
  } finally {
    running = false;
  }
}
export const isSyncRunning = () => running;
