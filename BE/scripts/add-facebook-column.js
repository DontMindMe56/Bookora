// Thêm cột Account.facebookId (idempotent). Chạy: npm run migrate:facebook   (DB test: TEST_DB_NAME=... node scripts/add-facebook-column.js --test)
// Tương đương db/07_facebook_login.sql (thêm cột + nới ràng buộc ck_account_cred).
import mysql from 'mysql2/promise';

if (process.argv.includes('--test')) process.env.DB_NAME = process.env.TEST_DB_NAME || 'bookstore_test';
const { config } = await import('../src/config.js');

export async function ensureFacebookColumn(db, database) {
  let changed = false;
  const [[col]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Account' AND COLUMN_NAME = 'facebookId'`,
    [database],
  );
  if (!col.n) {
    await db.query('ALTER TABLE Account ADD COLUMN facebookId VARCHAR(64) NULL, ADD UNIQUE KEY uq_account_facebookId (facebookId)');
    changed = true;
  }
  // Schema gốc chỉ cho tài khoản có mật khẩu hoặc Google (ck_account_cred); thiếu bước này thì đăng ký bằng Facebook bị 422.
  const [[chk]] = await db.query(
    `SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_NAME = 'ck_account_cred' AND CHECK_CLAUSE LIKE '%facebookId%'`,
    [database],
  );
  if (!chk.n) {
    await db.query('ALTER TABLE Account DROP CHECK ck_account_cred');
    await db.query('ALTER TABLE Account ADD CONSTRAINT ck_account_cred CHECK (passwordHash IS NOT NULL OR googleId IS NOT NULL OR facebookId IS NOT NULL)');
    changed = true;
  }
  return changed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { database, ...conn } = config.db;
  const db = await mysql.createConnection({ ...conn, database, charset: 'utf8mb4' });
  console.log(
    (await ensureFacebookColumn(db, database))
      ? `Đã cập nhật Account (facebookId + ck_account_cred) trong ${database}`
      : `Account đã đủ cột/ràng buộc Facebook trong ${database}`,
  );
  await db.end();
}
