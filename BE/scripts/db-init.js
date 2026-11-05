import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

// `--test` => khởi tạo DB riêng cho test (mặc định bookstore_test), không đụng DB đang dùng thật
if (process.argv.includes('--test')) process.env.DB_NAME = process.env.TEST_DB_NAME || 'bookstore_test';
const { config } = await import('../src/config.js');

const dir = fileURLToPath(new URL('../../db/', import.meta.url));
const { database, ...conn } = config.db;
const NAME_RE = /^(DROP DATABASE IF EXISTS|CREATE DATABASE|USE)\s+bookstore\b/gim; // schema ghi cứng tên DB: thay bằng DB_NAME
console.log('Khởi tạo DB:', database);
const db = await mysql.createConnection({ ...conn, charset: 'utf8mb4', multipleStatements: true });

for (const file of readdirSync(dir)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()) {
  let delim = ';',
    buf = '';
  for (const line of readFileSync(dir + file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^DELIMITER\s+(\S+)/i);
    if (m) {
      delim = m[1];
      continue;
    }
    buf += line + '\n';
    if (line.trimEnd().endsWith(delim)) {
      const sql = buf
        .trim()
        .slice(0, -delim.length)
        .replace(NAME_RE, (_m, kw) => `${kw} \`${database}\``);
      buf = '';
      if (sql.replace(/--.*$/gm, '').trim()) await db.query(sql);
    }
  }
  console.log('OK', file);
}
await db.end();

// Dựng DB để dùng/demo: tự nạp sách + tài khoản demo cho tiện. Không nạp khi chạy test (--test) hoặc production
// (tài khoản demo có mật khẩu ai cũng đoán được); thêm --no-demo để bỏ qua.
const isTest = process.argv.includes('--test');
if (isTest || process.argv.includes('--no-demo')) process.exit(0);
if (config.isProd) {
  console.log('Production: không nạp dữ liệu demo. Tạo quản trị viên bằng: npm run create-admin');
} else {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./seed-demo.js', import.meta.url))], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
