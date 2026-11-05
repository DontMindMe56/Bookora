import 'dotenv/config';
import { createStaffAccount } from '../src/modules/auth/auth.service.js';
import { pool } from '../src/db.js';

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Quản trị viên' } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Cần đặt ADMIN_EMAIL và ADMIN_PASSWORD trong .env');
  process.exit(1);
}
try {
  await createStaffAccount({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, fullName: ADMIN_NAME });
  console.log(`Đã tạo quản trị viên: ${ADMIN_EMAIL}`);
} catch (e) {
  console.error(e.code === 'ER_DUP_ENTRY' ? 'Email này đã tồn tại' : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
