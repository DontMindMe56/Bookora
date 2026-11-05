import crypto from 'node:crypto';

export const uuid = () => crypto.randomUUID();
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Mã đơn dạng DH + 8 ký tự ngẫu nhiên (không tuần tự). */
export function randomOrderCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return 'DH' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
