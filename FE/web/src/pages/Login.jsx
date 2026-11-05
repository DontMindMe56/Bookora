import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import SocialLogin from './SocialLogin';

export default function Login() {
  const [email, setEmail] = useState('khach1@demo.vn');
  const [password, setPassword] = useState('Demo12345');
  const [err, setErr] = useState('');
  const setToken = useStore((s) => s.setToken);
  const nav = useNavigate();
  const from = useLocation().state?.from || '/';

  const done = (token) => (setToken(token), nav(from, { replace: true }));
  const fail = (x) => setErr(x.message);

  const submit = (e) => {
    e.preventDefault();
    api('/api/auth/login', { method: 'POST', body: { email, password } }).then((r) => done(r.token), fail);
  };

  return (
    <div className="box" style={{ maxWidth: 380, margin: 'auto' }}>
      <form onSubmit={submit}>
        <h2>Đăng nhập</h2>
        {err && <div className="err">{err}</div>}
        <div className="f"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="f"><label>Mật khẩu</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button>Đăng nhập</button>
        <p className="mut">Demo: khach1@demo.vn / Demo12345</p>
      </form>
      <SocialLogin onLogin={done} onError={fail} />
    </div>
  );
}
