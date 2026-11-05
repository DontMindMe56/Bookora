export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, code = 'BAD_REQUEST', d) => new AppError(400, code, m, d);
export const unauthorized = (m = 'Chưa đăng nhập', code = 'UNAUTHORIZED') => new AppError(401, code, m);
export const forbidden = (m = 'Bạn không có quyền thực hiện thao tác này', code = 'FORBIDDEN') => new AppError(403, code, m);
export const notFound = (m = 'Không tìm thấy', code = 'NOT_FOUND') => new AppError(404, code, m);
export const conflict = (m, code = 'CONFLICT', d) => new AppError(409, code, m, d);
export const unprocessable = (m, code = 'UNPROCESSABLE', d) => new AppError(422, code, m, d);
export const tooMany = (m, code = 'TOO_MANY_REQUESTS') => new AppError(429, code, m);
