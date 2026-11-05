import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { setup, teardown, api, config, query, rnd } from './helpers.js';

const realVerify = OAuth2Client.prototype.verifyIdToken;
before(async () => {
  config.google.clientId = 'test-client';
  OAuth2Client.prototype.verifyIdToken = async ({ idToken }) => {
    if (idToken.startsWith('bad')) throw new Error('bad');
    return { getPayload: () => JSON.parse(idToken) };
  };
  await setup();
});
after(async () => {
  OAuth2Client.prototype.verifyIdToken = realVerify;
  await teardown();
});

let n = 0;
const tok = (o) => JSON.stringify({ sub: `g${rnd}${++n}`, email: `g${n}_${rnd}@example.com`, email_verified: true, name: 'Người Google', ...o });
const google = (idToken) => api('POST', '/api/auth/google', { body: { idToken } });

test('token sai => 401; email Google chưa xác thực => 403', async () => {
  assert.equal((await google('bad'.padEnd(30, 'x'))).status, 401);
  assert.equal((await google(tok({ email_verified: false }))).status, 403);
});

test('đăng ký mới bằng Google: tài khoản ACTIVE, không mật khẩu, dùng được token', async () => {
  const t = JSON.parse(tok());
  const r = await google(JSON.stringify(t));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await api('GET', '/api/auth/me', { token: r.data.token })).status, 200);
  const [a] = await query('SELECT status, passwordHash, googleId FROM Account WHERE email = ?', [t.email]);
  assert.deepEqual({ ...a }, { status: 'ACTIVE', passwordHash: null, googleId: t.sub });
  assert.equal((await api('POST', '/api/auth/login', { body: { email: t.email, password: 'Matkhau123' } })).status, 401);
  assert.equal((await google(JSON.stringify(t))).status, 200);
});

test('liên kết vào tài khoản email đang hoạt động, giữ mật khẩu', async () => {
  const email = `link_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: 'A', acceptTerms: true } });
  await query(`UPDATE Account SET status='ACTIVE', emailVerifiedAt=NOW() WHERE email=?`, [email]);
  assert.equal((await google(tok({ email }))).status, 200);
  assert.equal((await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).status, 200);
});

test('tài khoản email chưa xác thực: Google kích hoạt và xóa mật khẩu cũ', async () => {
  const email = `unv_${rnd}@example.com`;
  await api('POST', '/api/auth/register', { body: { email, password: 'Matkhau123', fullName: 'A', acceptTerms: true } });
  assert.equal((await google(tok({ email }))).status, 200);
  const [a] = await query('SELECT status, passwordHash FROM Account WHERE email = ?', [email]);
  assert.deepEqual({ ...a }, { status: 'ACTIVE', passwordHash: null });
  assert.equal((await api('POST', '/api/auth/login', { body: { email, password: 'Matkhau123' } })).status, 401);
});

test('tài khoản nhân viên không đăng nhập bằng Google', async () => {
  assert.equal((await google(tok({ email: `ad_${rnd}@example.com` }))).status, 403);
});
