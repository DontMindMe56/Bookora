import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { query } from '../db.js';
import { uuid } from '../utils/security.js';
import { getInt, getList } from './params.js';

const transporter =
  config.smtp.host && config.nodeEnv !== 'test'
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      })
    : null;

/**
 * Đưa email vào hàng đợi TRONG CÙNG transaction với dữ liệu nghiệp vụ
 * => email chỉ được gửi sau khi dữ liệu đã lưu; dedupeKey chống gửi trùng.
 */
export async function enqueueEmail(conn, { dedupeKey, to, subject, body }) {
  await query(`INSERT IGNORE INTO EmailOutbox (emailId, dedupeKey, toEmail, subject, body) VALUES (?,?,?,?,?)`, [uuid(), dedupeKey, to, subject, body], conn);
}

async function deliver(mail) {
  if (!transporter) {
    if (config.nodeEnv !== 'test') console.log(`[mail:dev] → ${mail.toEmail}\n${mail.subject}\n${mail.body}\n`);
    return;
  }
  await transporter.sendMail({ from: config.smtp.from, to: mail.toEmail, subject: mail.subject, text: mail.body });
}

/** Worker: gửi email đang chờ; lỗi thì thử lại sau 1, 5, 15 phút (tham số), hết lượt => FAILED. */
export async function processOutbox(limit = 20) {
  const maxRetries = await getInt('RETRY_MAX_ATTEMPTS');
  const backoff = (await getList('RETRY_BACKOFF_MINUTES')).map(Number);
  const due = await query(`SELECT * FROM EmailOutbox WHERE status='PENDING' AND nextAttemptAt <= NOW() ORDER BY createdAt LIMIT ?`, [limit]);
  for (const mail of due) {
    // "Giành" email bằng cách dời nextAttemptAt; chỉ 1 worker thắng
    const claim = await query(
      `UPDATE EmailOutbox SET nextAttemptAt = NOW() + INTERVAL 5 MINUTE
       WHERE emailId=? AND status='PENDING' AND nextAttemptAt <= NOW()`,
      [mail.emailId],
    );
    if (claim.affectedRows !== 1) continue;
    try {
      await deliver(mail);
      await query(`UPDATE EmailOutbox SET status='SENT', sentAt=NOW(), attempts=attempts+1 WHERE emailId=?`, [mail.emailId]);
    } catch (err) {
      const attempts = mail.attempts + 1;
      if (attempts > maxRetries) {
        await query(`UPDATE EmailOutbox SET status='FAILED', attempts=?, lastError=? WHERE emailId=?`, [
          attempts,
          String(err.message).slice(0, 500),
          mail.emailId,
        ]);
      } else {
        const wait = backoff[Math.min(attempts - 1, backoff.length - 1)] ?? 15;
        await query(`UPDATE EmailOutbox SET attempts=?, lastError=?, nextAttemptAt = NOW() + INTERVAL ? MINUTE WHERE emailId=?`, [
          attempts,
          String(err.message).slice(0, 500),
          wait,
          mail.emailId,
        ]);
      }
    }
  }
}
