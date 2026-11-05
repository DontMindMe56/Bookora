import { randomBytes } from 'node:crypto';
import { query } from '../../db.js';
import { normalizeIsbn } from '../../utils/text.js';
import { toCents } from './costing.js';

export const ymd = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');
/** Ngày theo giờ Việt Nam (UTC+7), dạng YYYYMMDD — dùng cho khóa chống gửi trùng theo ngày. */
export const ymdVN = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
export const newCode = (prefix) => `${prefix}${ymd()}-${randomBytes(2).toString('hex').toUpperCase()}`;

/**
 * Chuẩn hóa dòng hàng (theo editionId hoặc isbn). Không ném lỗi: trả { resolved, errors }
 * để dùng cho cả "xem trước" (báo lỗi từng dòng) lẫn tạo phiếu thật.
 * Chặn ấn bản "Ngừng kinh doanh" (vẫn cho điều chỉnh tồn kho ở chỗ khác) và dòng trùng.
 */
export async function resolveLines(conn, lines, { needCost = true, allowDiscontinued = false } = {}) {
  const ids = [...new Set(lines.map((l) => l.editionId).filter(Boolean))];
  const isbns = [...new Set(lines.filter((l) => !l.editionId && l.isbn).map((l) => normalizeIsbn(l.isbn)))];
  const found = [];
  if (ids.length)
    found.push(
      ...(await query(
        `SELECT e.editionId, e.isbn, e.businessStatus, w.title FROM Edition e JOIN Work w ON w.workId = e.workId WHERE e.editionId IN (?)`,
        [ids],
        conn,
      )),
    );
  if (isbns.length)
    found.push(
      ...(await query(
        `SELECT e.editionId, e.isbn, e.businessStatus, w.title FROM Edition e JOIN Work w ON w.workId = e.workId WHERE e.isbn IN (?)`,
        [isbns],
        conn,
      )),
    );
  const byId = new Map(found.map((e) => [e.editionId, e]));
  const byIsbn = new Map(found.map((e) => [e.isbn, e]));

  const resolved = [],
    errors = [],
    seen = new Set();
  lines.forEach((l, idx) => {
    const row = idx + 1;
    const ed = l.editionId ? byId.get(l.editionId) : byIsbn.get(normalizeIsbn(l.isbn || ''));
    if (!ed) return errors.push({ row, code: 'EDITION_NOT_FOUND', message: `Không tìm thấy ấn bản (${l.editionId || l.isbn})` });
    if (ed.businessStatus === 'DISCONTINUED' && !allowDiscontinued)
      return errors.push({ row, code: 'EDITION_DISCONTINUED', message: `"${ed.title}" đã ngừng kinh doanh, không thể chọn trong phiếu nhập mới` });
    if (seen.has(ed.editionId)) return errors.push({ row, code: 'DUPLICATE_LINE', message: `"${ed.title}" bị trùng trong phiếu` });
    if (needCost && !(l.unitCost >= 0)) return errors.push({ row, code: 'INVALID_COST', message: 'Giá nhập không hợp lệ' });
    seen.add(ed.editionId);
    resolved.push({
      editionId: ed.editionId,
      isbn: ed.isbn,
      title: ed.title,
      quantity: l.quantity,
      unitCost: needCost ? toCents(l.unitCost) / 100 : undefined,
    });
  });
  return { resolved, errors };
}
