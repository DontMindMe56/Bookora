export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const json = (fn, status = 200) => asyncHandler(async (req, res) => res.status(status).json(await fn(req)));
