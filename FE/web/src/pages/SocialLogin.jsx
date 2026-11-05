import { useEffect, useState } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { api } from '../api';

export default function SocialLogin({ onLogin, onError }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => void api('/api/auth/config').then(setCfg, () => setCfg({})), []);

  useEffect(() => {
    if (!cfg?.facebookAppId || window.FB) return;
    window.fbAsyncInit = () => window.FB.init({ appId: cfg.facebookAppId, cookie: false, xfbml: false, version: 'v21.0' });
    const s = Object.assign(document.createElement('script'), { src: 'https://connect.facebook.net/vi_VN/sdk.js', async: true });
    document.body.append(s);
  }, [cfg]);

  const send = (path, body) => api(path, { method: 'POST', body }).then((d) => onLogin(d.token), onError);

  const facebook = () =>
    window.FB
      ? window.FB.login((r) => (r.authResponse ? send('/api/auth/facebook', { accessToken: r.authResponse.accessToken }) : onError(new Error('Đã hủy đăng nhập Facebook'))), { scope: 'public_profile,email' })
      : onError(new Error('Chưa tải được Facebook SDK'));

  if (!cfg) return null;
  return (
    <div style={{ marginTop: 16, display: 'grid', gap: 10, justifyItems: 'center' }}>
      <span className="mut">hoặc</span>
      {cfg.googleClientId ? (
        <GoogleOAuthProvider clientId={cfg.googleClientId}>
          <GoogleLogin locale="vi" onSuccess={(c) => send('/api/auth/google', { idToken: c.credential })} onError={() => onError(new Error('Đăng nhập Google thất bại'))} />
        </GoogleOAuthProvider>
      ) : (
        <button type="button" className="ghost" disabled style={{ width: 240 }} title="Thiếu GOOGLE_CLIENT_ID trong BE/.env">Đăng nhập bằng Google</button>
      )}
      <button type="button" disabled={!cfg.facebookAppId} onClick={facebook} style={{ background: '#1877f2', width: 240 }} title={cfg.facebookAppId ? '' : 'Thiếu FACEBOOK_APP_ID trong BE/.env'}>
        Đăng nhập bằng Facebook
      </button>
      {(!cfg.googleClientId || !cfg.facebookAppId) && <span className="mut">Chưa cấu hình trong BE/.env: {[!cfg.googleClientId && 'GOOGLE_CLIENT_ID', !cfg.facebookAppId && 'FACEBOOK_APP_ID'].filter(Boolean).join(', ')}</span>}
    </div>
  );
}
