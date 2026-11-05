import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  timezone: 'Z',
  decimalNumbers: true, // DECIMAL => number (tiền là số nguyên đồng)
  charset: 'utf8mb4',
});

// Mọi kết nối dùng UTC để NOW() khớp với Date của Node
pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));

/** Chạy truy vấn; truyền conn để chạy trong transaction. */
export async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

/** Transaction: hoặc commit toàn bộ hoặc rollback toàn bộ. Gặp deadlock (ER_LOCK_DEADLOCK) thì chạy lại tối đa 3 lần. */
export async function withTx(fn) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      if (err.errno !== 1213 || attempt >= 3) throw err;
    } finally {
      conn.release();
    }
  }
}
