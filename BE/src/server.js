import { createApp } from './app.js';
import { config } from './config.js';
import { pool, query } from './db.js';
import { startJobs } from './jobs/index.js';
import { ensureDefaultCover } from './modules/admin/book.service.js';
import { syncGhnCatalog } from './modules/geo/geo.service.js';

await ensureDefaultCover();
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`API chạy tại http://localhost:${config.port}`);
  const base = config.publicUrl || `http://localhost:${config.port}`;
  console.log(`\n  ${config.publicUrl ? 'Công khai' : 'Local'}: ${base}`);
  console.log(`    Demo nhân viên: ${base}/demo/staff.html`);
  console.log(`    Swagger       : ${base}/api/docs`);
  if (config.publicUrl) {
    console.log('\n  Dán vào cổng thanh toán:');
    console.log(`    VNPay IPN   : ${config.publicUrl}/api/webhooks/vnpay/ipn`);
    console.log(`    SePay hook  : ${config.publicUrl}/api/webhooks/sepay`);
    if (!config.vnpay.returnUrl.startsWith(config.publicUrl))
      console.warn(`  [cảnh báo] VNPAY_RETURN_URL (${config.vnpay.returnUrl}) khác PUBLIC_URL, chạy lại: node scripts/use-ngrok.js ${config.publicUrl}`);
  }
  console.log('');
});
const stopJobs = startJobs();

// Danh mục tỉnh/quận/phường lấy từ API GHN: tự đồng bộ lần đầu (chạy nền) khi DB chưa có và đã cấu hình GHN_TOKEN
if (config.ghn.token && !config.ghn.shopId) console.warn('[ghn] Có GHN_TOKEN nhưng thiếu GHN_SHOP_ID: báo giá, tạo/hủy vận đơn và các job GHN sẽ lỗi.');
if (config.ghn.token) {
  const [{ n }] = await query('SELECT COUNT(*) AS n FROM GhnProvince WHERE active');
  if (!n) {
    console.log('[geo] Danh mục GHN trống, đang tự đồng bộ từ GHN (chạy nền, vài phút)...');
    syncGhnCatalog(null).then(
      (r) => console.log('[geo] Đồng bộ danh mục GHN xong', r),
      (e) => console.error('[geo:sync] Lỗi, có thể gọi lại bằng POST /api/admin/geo/sync:', e.message),
    );
  }
} else {
  console.warn('[geo] Chưa có GHN_TOKEN: chưa lấy được danh mục tỉnh/quận/phường, chưa tạo được địa chỉ giao hàng.');
}

async function shutdown(signal) {
  console.log(`${signal}: đang tắt...`);
  stopJobs();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
