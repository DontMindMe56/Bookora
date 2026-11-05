import { ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { config } from '../config.js';

export const notFoundHandler = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Đường dẫn không tồn tại'));

export function errorHandler(err, req, res, _next) {
  let status = 500,
    code = 'INTERNAL_ERROR',
    message = 'Lỗi hệ thống, vui lòng thử lại sau',
    details;

  if (err instanceof AppError) ({ status, code, message, details } = err);
  else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Dữ liệu không hợp lệ';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'JSON không hợp lệ';
  } else if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Ảnh tối đa 2 MB' : 'Tải tệp lên không hợp lệ';
  } else if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    code = 'DUPLICATE';
    message = 'Dữ liệu đã tồn tại';
  } else if (err.errno === 3819) {
    status = 422;
    code = 'CONSTRAINT_VIOLATION';
    message = 'Dữ liệu vi phạm ràng buộc';
  }

  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}), ...(config.isProd || status < 500 ? {} : { debug: err.message }) } });
}
