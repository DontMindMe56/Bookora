/** Bỏ dấu tiếng Việt (kể cả đ/Đ). */
export const removeAccents = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

export const normalizeEmail = (e = '') => e.trim().toLowerCase();

/** Bỏ dấu gạch ngang/khoảng trắng của ISBN. */
export const normalizeIsbn = (s = '') => s.replace(/[-\s]/g, '');

export function isValidIsbn13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

export const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);

/**
 * Tìm theo tên không phụ thuộc collation: utf8mb4_0900_ai_ci bỏ qua hoa/thường và dấu nhưng có thể coi đ/Đ là chữ riêng (không khớp d),
 * nên cột được đổi đ/Đ -> d/D bằng SQL và từ khóa được bỏ dấu (kể cả đ) bằng removeAccents; phần còn lại do collation ai_ci lo.
 * Dùng cho cột TÊN (tên sách, người, nhà xuất bản...), không cần cho email / SĐT / ISBN / mã.
 */
export const foldD = (col) => `REPLACE(REPLACE(${col}, 'đ', 'd'), 'Đ', 'D')`;
export const accentPattern = (q) => `%${escapeLike(removeAccents(String(q).trim()))}%`;
/** => { sql: "(<col1 gấp đ> LIKE ? OR <col2 ...> LIKE ?)", params: [...] } (đã bọc ngoặc, ghép được bằng AND / OR). */
export function nameLike(columns, q) {
  const pattern = accentPattern(q);
  return { sql: `(${columns.map((c) => `${foldD(c)} LIKE ?`).join(' OR ')})`, params: columns.map(() => pattern) };
}
