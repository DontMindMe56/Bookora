export const validate = (schema, source = 'body') => {
  const mw = (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return next(parsed.error);
    req.valid = { ...(req.valid || {}), [source]: parsed.data };
    next();
  };
  mw.docSchema = schema;
  mw.docSource = source;
  return mw;
};
