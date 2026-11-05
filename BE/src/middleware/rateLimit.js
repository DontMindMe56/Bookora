import rateLimit from 'express-rate-limit';

export const limiter = (limit, message = 'Quá nhiều yêu cầu, vui lòng thử lại sau') =>
  rateLimit({ windowMs: 60_000, limit, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'TOO_MANY_REQUESTS', message } } });
