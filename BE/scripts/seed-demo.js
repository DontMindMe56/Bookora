import 'dotenv/config';
import { pool, query } from '../src/db.js';
import { createEdition } from '../src/modules/catalog/catalog.service.js';
import { createStaffAccount, register } from '../src/modules/auth/auth.service.js';

const PASS = process.env.DEMO_PASSWORD || 'Demo12345';
const BOOKS = [
  ['Dế Mèn phiêu lưu ký', 'Tô Hoài', 'Thiếu nhi', 'NXB Kim Đồng', 68000, 0.2],
  ['Tôi thấy hoa vàng trên cỏ xanh', 'Nguyễn Nhật Ánh', 'Văn học', 'NXB Trẻ', 125000, 0],
  ['Mắt biếc', 'Nguyễn Nhật Ánh', 'Văn học', 'NXB Trẻ', 110000, 0.1],
  ['Nhà giả kim', 'Paulo Coelho', 'Văn học', 'NXB Nhã Nam', 79000, 0],
  ['Đắc nhân tâm', 'Dale Carnegie', 'Kỹ năng', 'NXB Tổng hợp', 86000, 0.15],
  ['Sapiens: Lược sử loài người', 'Yuval Noah Harari', 'Khoa học', 'NXB Tri thức', 229000, 0],
  ['Clean Code', 'Robert C. Martin', 'Công nghệ', 'NXB Prentice Hall', 450000, 0.1],
  ['Lược sử thời gian', 'Stephen Hawking', 'Khoa học', 'NXB Trẻ', 98000, 0],
  ['Cho tôi xin một vé đi tuổi thơ', 'Nguyễn Nhật Ánh', 'Văn học', 'NXB Trẻ', 82000, 0],
  ['Atomic Habits', 'James Clear', 'Kỹ năng', 'NXB Thế giới', 189000, 0.2],
  ['Truyện Kiều', 'Nguyễn Du', 'Văn học', 'NXB Văn học', 55000, 0],
  ['Doraemon tập 1', 'Fujiko F. Fujio', 'Thiếu nhi', 'NXB Kim Đồng', 22000, 0],
  ['Sách demo thanh toán', 'Bookora', 'Văn học', 'NXB Demo', 5000, 0],
];
const isbn = (n) => {
  const d = `978604${String(n).padStart(6, '0')}`;
  const s = [...d].reduce((a, c, i) => a + +c * (i % 2 ? 3 : 1), 0);
  return d + ((10 - (s % 10)) % 10);
};
const skip = (e) => {
  if (!['ER_DUP_ENTRY', 'DUPLICATE_ISBN'].includes(e.code) && e.status !== 409) throw e;
};

try {
  const admin = await createStaffAccount({ email: 'admin@demo.vn', password: PASS, fullName: 'Admin Demo' }).catch((e) => skip(e));
  await createStaffAccount({ email: 'kho@demo.vn', password: PASS, fullName: 'Nhân viên kho', role: 'STAFF', position: 'Nhân viên kho' }).catch(skip);
  for (const i of [1, 2, 3]) {
    const email = `khach${i}@demo.vn`;
    await register({ email, password: PASS, fullName: `Khách Demo ${i}` }).catch(skip);
    await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  }
  const actor = admin ?? { accountId: (await query(`SELECT accountId FROM Account WHERE email='admin@demo.vn'`))[0].accountId };
  for (const [i, [title, author, category, publisher, listPrice, sale]] of BOOKS.entries()) {
    const code = isbn(i + 1);
    const r = await createEdition(actor, {
      isbn: code,
      title,
      authors: [author],
      categories: [category],
      publisher,
      format: 'Bìa mềm',
      listPrice,
      weightGram: 300,
      businessStatus: 'ON_SALE',
      salePrice: sale ? Math.round((listPrice * (1 - sale)) / 1000) * 1000 : null,
    }).catch((e) => (skip(e), null));
    if (!r) continue;
    await query('UPDATE Inventory SET qtyOnHand = ? WHERE editionId = ?', [20 + ((i * 7) % 30), r.editionId]);
    await query('UPDATE Edition SET costPrice = ? WHERE editionId = ?', [Math.round(listPrice * 0.6), r.editionId]);
  }
  console.log(`Xong. Tài khoản (mật khẩu ${PASS}): admin@demo.vn, kho@demo.vn, khach1..3@demo.vn`);
} finally {
  await pool.end();
}
