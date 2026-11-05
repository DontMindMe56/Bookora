import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, placeOrder, mkEdition, newCustomer, api, ctx, query } from './helpers.js';
import { checkReviewText, maskName } from '../src/modules/review/review.filter.js';

before(setup);
after(teardown);

const workOf = async (editionId) => (await query('SELECT workId FROM Edition WHERE editionId = ?', [editionId]))[0].workId;
const deliver = (orderId, daysAgo = 1) =>
  query(`UPDATE Orders SET orderStatus='COMPLETED', shippingStatus='DELIVERED', deliveredAt = NOW() - INTERVAL ? DAY, completedAt = NOW() WHERE orderId = ?`, [
    daysAgo,
    orderId,
  ]);
const buyer = async (editionId, daysAgo) => {
  const { c, order } = await placeOrder('COD', { editionId });
  await deliver(order.orderId, daysAgo);
  return c;
};
const post = (c, editionId, body = {}) => api('POST', '/api/reviews', { token: c.token, body: { editionId, rating: 5, ...body } });
const list = async (editionId, qs = '') => (await api('GET', `/api/books/${await workOf(editionId)}/reviews${qs}`)).data;

test('bộ lọc: chặn liên kết, từ cấm; cho phép câu bình thường; rút gọn tên', () => {
  assert.ok(checkReviewText('xem tại www.spam.vn nhé'));
  assert.ok(checkReviewText('mua ở http://x.co'));
  assert.ok(checkReviewText('shop abc.com giá rẻ'));
  assert.ok(checkReviewText('sách này vcl thật'));
  assert.equal(checkReviewText('Sách hay, giao nhanh. Giá 99.000đ, tập 1.5 rất đáng đọc'), null);
  assert.equal(checkReviewText('Địa điểm cốt truyện đẹp'), null);
  assert.equal(checkReviewText(null), null);
  assert.equal(maskName('Nguyễn Văn An'), 'Nguyễn A.');
  assert.equal(maskName('An'), 'An');
});

test('chỉ đánh giá được sách đã nhận; mỗi ấn bản một lần; kiểm tra dữ liệu và nội dung', async () => {
  const ed = await mkEdition('Sách đánh giá', 80000, 50);
  const { c, order } = await placeOrder('COD', { editionId: ed });
  assert.equal((await post(c, ed)).status, 403, 'đơn chưa giao');
  await deliver(order.orderId);
  assert.equal((await post(c, ed, { rating: 6 })).status, 400);
  assert.equal((await post(c, ed, { comment: 'xem www.spam.vn' })).data.error.code, 'REVIEW_REJECTED');
  const ok = await post(c, ed, { rating: 4, comment: '<b>Hay</b><script>alert(1)</script> lắm' });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.ok(!/[<>]/.test(ok.data.comment));
  assert.equal((await post(c, ed)).data.error.code, 'REVIEW_EXISTS');
  const other = await newCustomer('x');
  assert.equal((await post(other, ed)).status, 403, 'khách chưa mua');
  assert.equal((await api('POST', '/api/reviews', { body: { editionId: ed, rating: 5 } })).status, 401);
});

test('quá hạn đánh giá (REVIEW_WINDOW_DAYS) bị từ chối', async () => {
  const ed = await mkEdition('Sách quá hạn đánh giá', 80000, 50);
  const c = await buyer(ed, 91);
  const r = await post(c, ed);
  assert.equal(r.status, 422);
  assert.equal(r.data.error.code, 'REVIEW_WINDOW_EXPIRED');
});

test('sửa/xóa đánh giá của mình; điểm trung bình tính lại; không đụng đánh giá người khác', async () => {
  const ed = await mkEdition('Sách sửa đánh giá', 80000, 50);
  const a = await buyer(ed, 1),
    b = await buyer(ed, 1);
  const ra = (await post(a, ed, { rating: 5, comment: 'Rất tốt' })).data;
  await post(b, ed, { rating: 3 });
  let pub = await list(ed);
  assert.deepEqual([pub.count, pub.average, pub.counts[5], pub.counts[3]], [2, 4, 1, 1]);
  assert.ok(pub.items.every((i) => !('fullName' in i) && i.reviewer));

  assert.equal((await api('PATCH', `/api/reviews/${ra.reviewId}`, { token: a.token, body: { rating: 1, comment: null } })).status, 200);
  assert.equal((await api('PATCH', `/api/reviews/${ra.reviewId}`, { token: b.token, body: { rating: 5 } })).status, 404);
  assert.equal((await api('PATCH', `/api/reviews/${ra.reviewId}`, { token: a.token, body: {} })).status, 400);
  assert.equal((await list(ed)).average, 2);
  assert.equal((await list(ed, '?rating=1')).total, 1);

  assert.equal((await api('DELETE', `/api/reviews/${ra.reviewId}`, { token: b.token })).status, 404);
  assert.equal((await api('DELETE', `/api/reviews/${ra.reviewId}`, { token: a.token })).status, 200);
  pub = await list(ed);
  assert.deepEqual([pub.count, pub.average], [1, 3]);
  assert.equal((await api('GET', '/api/reviews/mine', { token: a.token })).data.total, 0);
  assert.equal((await api('GET', `/api/books/${await workOf(ed)}`)).data.rating.average, 3);
});

test('báo cáo: không tự báo cáo, không báo cáo hai lần, đủ 3 tài khoản thì tự ẩn; admin hiện/ẩn có lịch sử', async () => {
  const ed = await mkEdition('Sách báo cáo đánh giá', 80000, 50);
  const author = await buyer(ed, 1);
  const rv = (await post(author, ed, { rating: 2, comment: 'Không hay' })).data;
  const report = (c) => api('POST', `/api/reviews/${rv.reviewId}/report`, { token: c.token, body: { reason: 'spam' } });

  assert.equal((await report(author)).data.error.code, 'REVIEW_SELF_REPORT');
  const [r1, r2, r3] = [await newCustomer('r'), await newCustomer('r'), await newCustomer('r')];
  assert.equal((await report(r1)).data.autoHidden, false);
  assert.equal((await report(r1)).data.error.code, 'REVIEW_ALREADY_REPORTED');
  assert.equal((await report(r2)).data.autoHidden, false);
  assert.equal((await list(ed)).count, 1);
  assert.equal((await report(r3)).data.autoHidden, true);
  assert.equal((await list(ed)).count, 0);
  const row = (await query('SELECT status, hiddenBy FROM Review WHERE reviewId = ?', [rv.reviewId]))[0];
  assert.deepEqual([row.status, row.hiddenBy], ['HIDDEN', 'AUTO']);

  assert.equal((await api('GET', '/api/admin/reviews', { token: ctx.staffToken })).status, 403);
  const hidden = await api('GET', '/api/admin/reviews?status=HIDDEN&q=Không hay', { token: ctx.adminToken });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.items.find((i) => i.reviewId === rv.reviewId).reportCount, 3);

  const show = await api('POST', `/api/admin/reviews/${rv.reviewId}/show`, { token: ctx.adminToken, body: {} });
  assert.equal(show.data.status, 'VISIBLE');
  assert.equal((await query('SELECT COUNT(*) AS n FROM ReviewReport WHERE reviewId = ?', [rv.reviewId]))[0].n, 0);
  assert.equal((await api('POST', `/api/admin/reviews/${rv.reviewId}/show`, { token: ctx.adminToken, body: {} })).status, 409);
  assert.equal((await api('POST', `/api/admin/reviews/${rv.reviewId}/hide`, { token: ctx.adminToken, body: {} })).status, 400);
  assert.equal((await api('POST', `/api/admin/reviews/${rv.reviewId}/hide`, { token: ctx.adminToken, body: { reason: 'Vi phạm' } })).data.status, 'HIDDEN');
  const logs = await query(`SELECT action FROM AuditLog WHERE entityType = 'REVIEW' AND entityId = ? ORDER BY createdAt`, [rv.reviewId]);
  assert.ok(logs.map((l) => l.action).includes('HIDE') && logs.map((l) => l.action).includes('SHOW'));
});
