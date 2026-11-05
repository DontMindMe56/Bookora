import { zodToJsonSchema } from 'zod-to-json-schema';
import { RESPONSES } from './responses.js';

const decodeMount = (layer) => (layer.regexp.fast_slash ? '' : layer.regexp.source.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/'));
const toOpenApiPath = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/(.)\/$/, '$1') || '/';
const schemaOf = (zod) => {
  const { $schema, ...s } = zodToJsonSchema(zod, { target: 'openApi3', $refStrategy: 'none' });
  return s;
};

const header = (name, description) => ({ name, in: 'header', required: true, description, schema: { type: 'string' } });
const EXTRA = {
  'post /api/orders': { parameters: [header('Idempotency-Key', 'Bắt buộc, 8–64 ký tự [A-Za-z0-9._-]; gửi lại cùng khóa trả đúng đơn cũ (200)')] },
  'post /api/webhooks/ghn': { parameters: [header('x-webhook-token', 'Token webhook GHN (hoặc query ?token=)')] },
  'post /api/webhooks/sepay': { parameters: [header('Authorization', 'Apikey <SEPAY_API_KEY>')] },
  'post /api/admin/editions/{editionId}/cover': {
    requestBody: {
      required: true,
      content: { 'multipart/form-data': { schema: { type: 'object', required: ['cover'], properties: { cover: { type: 'string', format: 'binary' } } } } },
    },
  },
};

function collect(stack, prefix, roles, out) {
  let current = roles;
  for (const layer of stack) {
    if (layer.route) {
      const handlers = layer.route.stack.map((l) => l.handle);
      let local = current;
      const schemas = [];
      for (const h of handlers) {
        if (h.docRoles) local = h.docRoles;
        if (h.docSchema) schemas.push(h);
      }
      for (const method of Object.keys(layer.route.methods)) out.push({ method, path: prefix + layer.route.path, roles: local, schemas });
    } else if (layer.name === 'router' && layer.handle.stack) {
      collect(layer.handle.stack, prefix + decodeMount(layer), current, out);
    } else if (layer.handle?.docRoles) current = layer.handle.docRoles;
  }
}

export function buildOpenApi(app) {
  const ops = [];
  collect(app._router.stack, '', null, ops);
  const paths = {};
  for (const op of ops.filter((o) => o.path.startsWith('/api'))) {
    const key = toOpenApiPath(op.path);
    const parameters = [],
      pathNames = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    let requestBody;
    for (const h of op.schemas) {
      const js = schemaOf(h.docSchema);
      if (h.docSource === 'body') requestBody = { required: true, content: { 'application/json': { schema: js } } };
      else
        for (const [name, schema] of Object.entries(js.properties ?? {})) {
          parameters.push({
            name,
            in: h.docSource === 'query' ? 'query' : 'path',
            required: h.docSource === 'path' || (js.required ?? []).includes(name),
            schema,
          });
        }
    }
    for (const n of pathNames)
      if (!parameters.some((p) => p.name === n && p.in === 'path')) parameters.push({ name: n, in: 'path', required: true, schema: { type: 'string' } });
    const seg = key.split('/').filter(Boolean).slice(1);
    const tag = seg[0] === 'admin' || seg[0] === 'staff' ? seg.slice(0, 2).join('/') : (seg[0] ?? 'root');
    const ok = RESPONSES[`${op.method} ${key}`];
    const extra = EXTRA[`${op.method} ${key}`] ?? {};
    parameters.push(...(extra.parameters ?? []));
    if (extra.requestBody) requestBody = extra.requestBody;
    (paths[key] ??= {})[op.method] = {
      tags: [tag],
      summary: `${op.method.toUpperCase()} ${key}`,
      ...(op.roles ? { security: [{ bearerAuth: [] }], description: `Vai trò: ${op.roles.join(', ')}` } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        ...(ok
          ? { [ok[0]]: { description: 'Thành công', content: { 'application/json': { schema: schemaOf(ok[1]) } } } }
          : { 200: { description: 'Thành công' } }),
        ...(op.roles ? { 401: { description: 'Chưa đăng nhập hoặc phiên hết hạn' }, 403: { description: 'Không đủ quyền' } } : {}),
        default: {
          description: 'Lỗi: { error: { code, message, details? } }',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Bookstore API',
      version: '0.1.0',
      description: 'Sinh tự động từ route Express và schema zod. Bấm Authorize, dán JWT từ POST /api/auth/login (không cần chữ Bearer).',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
        },
      },
    },
    paths,
  };
}
