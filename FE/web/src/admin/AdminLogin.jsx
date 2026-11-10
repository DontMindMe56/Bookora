import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';

export default function AdminLogin() {
  const [email, setEmail] = useState('admin@demo.vn');
  const [password, setPassword] = useState('Demo12345');
  const [err, setErr] = useState('');
  const setToken = useStore((s) => s.setToken);
  const nav = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    api('/api/auth/login', { method: 'POST', body: { email, password } }).then(
      (r) => {
        if (!['STAFF', 'ADMIN'].includes(r.role)) return setErr('Tài khoản này không có quyền quản trị');
        setToken(r.token, r.role);
        nav('/admin', { replace: true });
      },
      (x) => setErr(x.message),
    );
  };

  return (
    <form className="box" style={{ maxWidth: 380, margin: '60px auto' }} onSubmit={submit}>
      <h2>Đăng nhập quản trị</h2>
      {err && <div className="err">{err}</div>}
      <div className="f">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="f">
        <label>Mật khẩu</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn">Đăng nhập</button>
      <p className="mut">Demo: admin@demo.vn (ADMIN) hoặc kho@demo.vn (STAFF) / Demo12345</p>
    </form>
  );
}
