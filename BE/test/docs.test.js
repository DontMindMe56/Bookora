import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, placeOrder, api, ctx, newCustomer } from './helpers.js';
import { RESPONSES } from '../src/docs/responses.js';

before(setup);
after(teardown);

const check = (key, res) => {
  const [status, schema] = RESPONSES[key];
  assert.equal(res.status, status, `${key}: ${JSON.stringify(res.data)}`);
  const r = schema.safeParse(res.data);
  assert.ok(r.success, `${key}: ${JSON.stringify(r.error?.issues)}`);
};

test('schema response khớp dữ liệu thật: sách', async () => {
  const list = await api('GET', '/api/books?q=Sách');
  check('get /api/books', list);
  check('get /api/books', await api('GET', '/api/books?q=khong-co-sach-nao-ten-nay-xyz'));
  check('get /api/books/{workId}', await api('GET', `/api/books/${list.data.items[0].workId}`));
});

test('schema response khớp dữ liệu thật: giỏ hàng, báo giá, đơn hàng', async () => {
  const c = await newCustomer('docs');
  check('get /api/cart', await api('GET', '/api/cart', { token: c.token }));
  check('post /api/cart/items', await api('POST', '/api/cart/items', { token: c.token, body: { editionId: ctx.edition, quantity: 2 } }));
  check('patch /api/cart/items/{editionId}', await api('PATCH', `/api/cart/items/${ctx.edition}`, { token: c.token, body: { quantity: 1 } }));
  const q = await api('POST', '/api/checkout/quote', { token: c.token, body: { addressId: c.addressId } });
  check('post /api/checkout/quote', q);
  const created = await api('POST', '/api/orders', {
    token: c.token,
    headers: { 'idempotency-key': `docs-${Date.now()}` },
    body: { addressId: c.addressId, paymentMethod: 'COD', expectedTotal: q.data.total },
  });
  check('post /api/orders', created);
  const id = created.data.orderId;
  check('get /api/orders', await api('GET', '/api/orders', { token: c.token }));
  check('get /api/orders/{orderId}', await api('GET', `/api/orders/${id}`, { token: c.token }));
  check('get /api/staff/orders/{orderId}', await api('GET', `/api/staff/orders/${id}`, { token: ctx.staffToken }));
  const { order } = await placeOrder('SEPAY');
  assert.ok(
    RESPONSES['get /api/orders/{orderId}'][1].safeParse((await api('GET', `/api/staff/orders/${order.orderId}`, { token: ctx.staffToken })).data).success,
  );
  check('delete /api/cart/items/{editionId}', await api('DELETE', `/api/cart/items/${ctx.edition}`, { token: (await newCustomer('docs2')).token }));
});
