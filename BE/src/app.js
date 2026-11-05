import express from 'express';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { limiter } from './middleware/rateLimit.js';
import { config } from './config.js';
import { pool } from './db.js';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApi } from './docs/openapi.js';
import { sanitize } from './middleware/sanitize.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter, adminCatalogRouter } from './modules/catalog/catalog.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { addressRouter } from './modules/address/address.routes.js';
import { wishlistRouter } from './modules/wishlist/wishlist.routes.js';
import { geoRouter, geoAdminRouter } from './modules/geo/geo.routes.js';
import { promotionAdminRouter } from './modules/promotion/promotion.routes.js';
import { discountAdminRouter, discountCustomerRouter } from './modules/discount/discount.routes.js';
import { supplierRouter } from './modules/supplier/supplier.routes.js';
import { checkoutRouter, orderRouter, staffOrderRouter } from './modules/order/order.routes.js';
import { importRouter, purchaseOrderRouter, inventoryRouter } from './modules/inventory/inventory.routes.js';
import { orderPaymentRouter, sepayWebhookRouter, vnpayWebhookRouter } from './modules/payment/payment.routes.js';
import { ghnWebhookRouter } from './modules/shipment/shipment.routes.js';
import { bookReviewRouter, reviewRouter, reviewAdminRouter } from './modules/review/review.routes.js';
import { refundAdminRouter } from './modules/refund/refund.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  if (!config.isProd || process.env.DOCS_ENABLED === '1') {
    let spec;
    const getSpec = () => (spec ??= buildOpenApi(app));
    app.get('/api/openapi.json', (_req, res) => res.json(getSpec()));
    app.use('/api/docs', swaggerUi.serve, (req, res, next) =>
      swaggerUi.setup(getSpec(), { swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' } })(req, res, next),
    );
  }
  // Trang test nhân viên/quản trị (cùng điều kiện bật với Swagger); đặt trước helmet để hiển thị được ảnh QR SePay
  if (!config.isProd || process.env.DOCS_ENABLED === '1') app.use('/demo', express.static(fileURLToPath(new URL('../../FE/demo', import.meta.url))));
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => (req.rawBody = buf) }));
  app.use(cookieParser());
  app.use('/api', sanitize);
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_down' });
    }
  });

  app.use('/api/auth', limiter(config.authRateLimit), authRouter);
  app.use('/api', catalogRouter);
  app.use('/api/books', bookReviewRouter);
  app.use('/api/reviews', reviewRouter);
  app.use('/api/cart', cartRouter);
  const checkoutLimiter = limiter(config.checkoutRateLimit);
  app.use('/api/checkout', checkoutLimiter, checkoutRouter);
  app.use('/api/orders', (req, res, next) => (req.method === 'GET' ? next() : checkoutLimiter(req, res, next)), orderRouter);
  app.use('/api/orders', orderPaymentRouter);
  app.use('/api/webhooks', sepayWebhookRouter, vnpayWebhookRouter, ghnWebhookRouter);
  app.use('/api/staff/orders', staffOrderRouter);
  app.use('/api/suppliers', supplierRouter);
  app.use('/api/import-vouchers', importRouter);
  app.use('/api/purchase-orders', purchaseOrderRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/addresses', addressRouter);
  app.use('/api/wishlist', wishlistRouter);
  app.use('/api/geo', geoRouter);
  app.use('/api/discount-codes', discountCustomerRouter);
  app.use('/api/admin/promotions', promotionAdminRouter);
  app.use('/api/admin/discount-codes', discountAdminRouter);
  app.use('/api/admin/refunds', refundAdminRouter);
  app.use('/api/admin/reviews', reviewAdminRouter);
  app.use('/api/admin/geo', geoAdminRouter); // phải đứng trước /api/admin (adminCatalogRouter chặn mọi đường dẫn không phải ADMIN)
  app.use('/api/admin', adminRouter);
  app.use('/api/admin', adminCatalogRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}