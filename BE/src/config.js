import 'dotenv/config';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET phải được đặt (>= 32 ký tự) ở production');
}

export const config = {
  nodeEnv: env.NODE_ENV || 'development',
  isProd,
  port: Number(env.PORT || 3000),
  appUrl: env.APP_URL || 'http://localhost:5173',
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''), // địa chỉ công khai (ngrok...) chỉ để in link lúc khởi động
  trustProxy: Number(env.TRUST_PROXY || 0),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  authRateLimit: env.NODE_ENV === 'test' ? 1000 : 30, // yêu cầu/phút/IP cho /api/auth
  codeRateLimit: env.NODE_ENV === 'test' ? 1000 : 20, // lần thử mã giảm giá/phút/IP
  checkoutRateLimit: env.NODE_ENV === 'test' ? 1000 : 30, // báo giá + đặt hàng/phút/IP (mỗi lần báo giá gọi GHN)
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME || 'bookstore',
    socketPath: env.DB_SOCKET || undefined,
    connectionLimit: Number(env.DB_POOL || 10),
  },
  ghn: {
    baseUrl: env.GHN_BASE_URL || 'https://online-gateway.ghn.vn/shiip/public-api',
    token: env.GHN_TOKEN || '',
    timeoutMs: Number(env.GHN_TIMEOUT_MS || 10_000),
    shopId: env.GHN_SHOP_ID || '', // header ShopId của API tính phí / tạo / hủy vận đơn
    fromDistrictId: env.GHN_FROM_DISTRICT_ID ? Number(env.GHN_FROM_DISTRICT_ID) : null, // tùy chọn: GHN mặc định lấy theo cửa hàng
    serviceTypeId: Number(env.GHN_SERVICE_TYPE_ID || 2), // 2 = giao hàng thương mại điện tử (tiêu chuẩn)
    webhookToken: env.GHN_WEBHOOK_TOKEN || '',
    autoCreate: env.GHN_AUTO_CREATE ? env.GHN_AUTO_CREATE !== '0' : env.NODE_ENV !== 'test',
    retryDelaysMs: env.NODE_ENV === 'test' ? [0, 0] : [1000, 5000],
    returnAddress: { name: env.SHOP_NAME || 'Nhà sách', phone: env.SHOP_PHONE || '' },
  },
  google: { clientId: env.GOOGLE_CLIENT_ID || '' },
  facebook: {
    appId: env.FACEBOOK_APP_ID || '',
    appSecret: env.FACEBOOK_APP_SECRET || '',
    graphUrl: env.FACEBOOK_GRAPH_URL || 'https://graph.facebook.com/v21.0',
  },
  vnpay: {
    tmnCode: env.VNPAY_TMN_CODE || '',
    secret: env.VNPAY_SECRET || '',
    host: env.VNPAY_HOST || 'https://sandbox.vnpayment.vn',
    returnUrl: env.VNPAY_RETURN_URL || `${env.APP_URL || 'http://localhost:5173'}/payment/vnpay-return`,
    maxAttempts: 5,
  },
  sepay: {
    apiKey: env.SEPAY_API_KEY || '',
    webhookSecret: env.SEPAY_WEBHOOK_SECRET || '',
    bank: env.SEPAY_BANK || '',
    accountNo: env.SEPAY_ACCOUNT_NO || '',
    accountName: env.SEPAY_ACCOUNT_NAME || '',
  },
  uploadDir: env.UPLOAD_DIR || 'uploads',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'no-reply@example.com',
  },
};
