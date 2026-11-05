import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, api, config, query, rnd } from './helpers.js';
import mysql from 'mysql2/promise';
import { ensureFacebookColumn } from '../scripts/add-facebook-column.js';

// Giả lập Graph API: access token là JSON {id, name, email, app_id?, valid?}; token bắt đầu bằng "bad" => lỗi.
let realFetch;
before(async () => {
  await setup(); // setup() thay globalThis.fetch bằng bản giả GHN: phải gọi trước, rồi mới bọc thêm bản giả Facebook
  realFetch = globalThis.fetch;
  config.facebook.appId = 'test-app';
  config.facebook.appSecret = 'test-secret';
  const db = await mysql.createConnection({ ...config.db, charset: 'utf8mb4' });
  await ensureFacebookColumn(db, config.db.database);
  await db.end();
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.origin !== new URL(config.facebook.graphUrl).origin) return realFetch(url, init);
    const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const token = u.searchParams.get('input_token') ?? u.searchParams.get('access_token');
    if (token.startsWith('bad')) return respond(400, { error: { message: 'bad' } });
    const t = JSON.parse(u.searchParams.get('input_token') ?? token);
    if (u.pathname.endsWith('/debug_token')) return respond(200, { data: { is_valid: t.valid !== false, app_id: t.app_id ?? 'test-app', user_id: t.id } });
    return respond(200, { id: t.meId ?? t.id, name: t.name, ...(t.email ? { email: t.email } : {}) });
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  await teardown();
});

let n = 0;
const tok = (o) => JSON.stringify({ id: `f${rnd}${++n}`, email: `f${n}_${rnd}@example.com`, name: 'Người Facebook', ...o }).padEnd(40, ' ');
const facebook = (accessToken) => api('POST', '/api/auth/facebook', { body: { accessToken } });

test('token sai / thuộc app khác / không hợp lệ => 401', async () => {
  assert.equal((await facebook('bad'.padEnd(30, 'x'))).status, 401);
  assert.equal((await facebook(tok({ app_id: 'other-app' }))).status, 401);
  assert.equal((await facebook(tok({ valid: false }))).status, 401);
  assert.equal((await facebook(tok({ meId: 'someone-else' }))).status, 401);
});

test('Facebook không trả email => 403 FACEBOOK_EMAIL_MISSING', async () => {
  const r = await facebook(tok({ email: undefined }));
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'FACEBOOK_EMAIL_MISSING');
});

const verifyToken = async (email) => {
  const [m] = await query(`SELECT body FROM EmailOutbox WHERE toEmail = ? AND body LIKE '%verify-email%' ORDER BY createdAt DESC LIMIT 1`, [email]);
  return /token=([a-f0-9]{64})/.exec(m.body)[1];
};

test('đăng ký mới bằng Facebook: email chưa được tin => UNVERIFIED + email xác thực; chỉ vào được sau khi xác thực', async () => {
  const t = JSON.parse(tok());
  const again = () => facebook(JSON.stringify(t).padEnd(40, ' '));
  const r = await again();
  assert.equal(r.status, 403, JSON.stringify(r.data));
  assert.equal(r.data.error.code, 'EMAIL_NOT_VERIFIED');
  const [a] = await query('SELECT status, passwordHash, facebookId, emailVerifiedAt FROM Account WHERE email = ?', [t.email]);
  assert.deepEqual({ ...a }, { status: 'UNVERIFIED', passwordHash: null, facebookId: t.id, emailVerifiedAt: null });

  assert.equal((await again()).status, 403); // thử lại ngay: vẫn chưa vào được, không gửi dồn email
  const [{ n }] = await query(`SELECT COUNT(*) AS n FROM EmailOutbox WHERE toEmail = ? AND body LIKE '%verify-email%'`, [t.email]);
  assert.equal(n, 1);

  assert.equal((await api('POST', '/api/auth/verify-email', { body: { token: await verifyToken(t.email) } })).status, 200);
  const ok = await again();
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await api('GET', '/api/auth/me', { token: ok.data.token })).status, 200);
});

test('email trùng tài khoản đang hoạt động: KHÔNG tự liên kết (409), phải đăng nhập mật khẩu rồi liên kết', async () => {
  const email = `fblink_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: 'A', acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  const t = JSON.parse(tok({ email }));
  const again = () => facebook(JSON.stringify(t).padEnd(40, ' '));

  const r = await again();
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'FACEBOOK_LINK_REQUIRED');
  assert.equal((await query('SELECT facebookId FROM Account WHERE email = ?', [email]))[0].facebookId, null);

  const login = await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } });
  assert.equal(login.status, 200); // mật khẩu vẫn giữ nguyên
  const link = await api('POST', '/api/auth/facebook/link', { token: login.data.token, body: { accessToken: JSON.stringify(t).padEnd(40, ' ') } });
  assert.equal(link.status, 200, JSON.stringify(link.data));
  assert.equal((await again()).status, 200); // sau khi liên kết thì đăng nhập Facebook được
});

test('liên kết Facebook: cần đăng nhập; một Facebook không gắn vào hai tài khoản', async () => {
  const t = JSON.stringify(JSON.parse(tok())).padEnd(40, ' ');
  assert.equal((await api('POST', '/api/auth/facebook/link', { body: { accessToken: t } })).status, 401);
  const loginOf = async (tag) => {
    const email = `fb${tag}_${rnd}@example.com`;
    await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: tag, acceptTerms: true } });
    await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
    return (await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).data.token;
  };
  const [first, second] = [await loginOf('one'), await loginOf('two')];
  assert.equal((await api('POST', '/api/auth/facebook/link', { token: first, body: { accessToken: t } })).status, 200);
  const r = await api('POST', '/api/auth/facebook/link', { token: second, body: { accessToken: t } });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'FACEBOOK_ACCOUNT_TAKEN');
});

test('tài khoản mật khẩu chưa xác thực: Facebook không kích hoạt, không gắn facebookId, không xóa mật khẩu', async () => {
  const email = `fbunv_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: 'A', acceptTerms: true } });
  const r = await facebook(tok({ email }));
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'EMAIL_NOT_VERIFIED');
  const [a] = await query('SELECT status, facebookId, passwordHash IS NOT NULL AS hasPassword FROM Account WHERE email = ?', [email]);
  assert.deepEqual({ ...a }, { status: 'UNVERIFIED', facebookId: null, hasPassword: 1 });
});

test('tài khoản nhân viên không đăng nhập bằng Facebook', async () => {
  assert.equal((await facebook(tok({ email: `ad_${rnd}@example.com` }))).status, 403);
});
