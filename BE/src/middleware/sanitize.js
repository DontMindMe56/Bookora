import xss from 'xss';

const OPTS = { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] };
const SKIP = /password|token/i;

const clean = (v, key) => {
  if (typeof v === 'string') return SKIP.test(key ?? '') ? v : xss(v, OPTS);
  if (Array.isArray(v)) return v.map((x) => clean(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)]));
  return v;
};

export const sanitize = (req, _res, next) => {
  if (req.path.startsWith('/webhooks/')) return next();
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  next();
};
