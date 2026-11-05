// Dùng: node scripts/use-ngrok.js https://xxxx.ngrok-free.app
// Cập nhật BE/.env (chạy lệnh trong thư mục BE) cho chạy sau ngrok rồi in ra các URL cần dán vào VNPay / SePay.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = process.argv[2];
let base;
try {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error('cần https');
  base = u.origin;
} catch {
  console.error('Cú pháp: node scripts/use-ngrok.js https://<tên-miền-ngrok>');
  process.exit(1);
}

const file = resolve(process.argv[3] || '.env');
const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
const updates = {
  PUBLIC_URL: base,
  APP_URL: base,
  CORS_ORIGIN: base,
  VNPAY_RETURN_URL: `${base}/payment/vnpay-return`,
  TRUST_PROXY: '1',
};

const removed = [];
for (const [key, value] of Object.entries(updates)) {
  // dotenv lấy dòng CUỐI khi khóa bị khai báo trùng => sửa dòng đầu tiên và xóa mọi dòng trùng phía sau
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const idx = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) {
    lines.push(`${key}=${value}`);
    continue;
  }
  lines[idx[0]] = `${key}=${value}`;
  for (const i of idx.slice(1).reverse()) {
    lines.splice(i, 1);
    removed.push(key);
  }
}
if (removed.length) console.warn(`[cảnh báo] Đã xóa dòng khai báo trùng: ${[...new Set(removed)].join(', ')}`);
writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));

console.log(`Đã cập nhật ${file}:`);
for (const [k, v] of Object.entries(updates)) console.log(`  ${k}=${v}`);
console.log('\nKhởi động lại server, rồi dán các URL sau:');
console.log(`  Cửa hàng        : ${base}/`);
console.log(`  VNPay IPN URL   : ${base}/api/webhooks/vnpay/ipn   (Merchant Admin → Terminal)`);
console.log(`  SePay webhook   : ${base}/api/webhooks/sepay`);
