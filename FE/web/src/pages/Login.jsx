import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useStore } from '../store';
import SocialLogin from './SocialLogin';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('khach1@demo.vn');
  const [password, setPassword] = useState('Demo12345');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [errCode, setErrCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const setToken = useStore((s) => s.setToken);
  const nav = useNavigate();
  const from = useLocation().state?.from || '/';

  const done = (token) => {
    setToken(token);
    nav(from, { replace: true });
  };

  const fail = (x) => {
    setErr(x.message || 'Đăng nhập thất bại');
    setErrCode(x.code || '');
    setSubmitting(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setErrCode('');
    setSubmitting(true);
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      done(r.token);
    } catch (error) {
      fail(error);
    }
  };

  // Hàm xử lý gọi API gửi lại liên kết xác thực email
  const handleResendVerification = async () => {
    if (!email) {
      toast.error('Vui lòng nhập email của bạn');
      return;
    }
    setResending(true);
    try {
      const res = await api('/api/auth/resend-verification', {
        method: 'POST',
        body: { email: email.trim() },
      });
      toast.success(res.message || 'Liên kết xác thực mới đã được gửi vào email của bạn!');
    } catch (error) {
      toast.error(error.message || 'Không thể gửi lại email xác thực.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 bg-white border border-gray-200 rounded-2xl p-8 shadow-sm space-y-6">
      {/* Tiêu đề */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Đăng nhập</h1>
      </div>

      {/* Thông báo lỗi & Nút Gửi lại xác thực nếu chưa verify */}
      {err && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-3">
          <p className="text-xs font-medium text-red-600 text-center leading-relaxed">{err}</p>

          {/* Nếu lỗi là chưa xác thực email, hiển thị thêm nút bấm gửi lại */}
          {errCode === 'EMAIL_NOT_VERIFIED' && (
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                disabled={resending}
                onClick={handleResendVerification}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold hover:cursor-pointer disabled:bg-gray-300 rounded-lg shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 ${resending ? 'animate-spin' : ''}`} />
                <span>{resending ? 'Đang gửi...' : 'Gửi lại liên kết xác thực'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Form đăng nhập */}
      <form onSubmit={submit} className="space-y-4">
        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Địa chỉ Email</label>
          <div className="relative">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium bg-white"
            />
          </div>
        </div>

        {/* Mật khẩu */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mật khẩu</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu..."
              className="w-full pl-10 pr-12 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium bg-white"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Gợi ý tài khoản Demo */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 font-medium">Tài khoản Demo:</p>
          <p className="text-xs font-mono text-gray-700 mt-0.5">khach1@demo.vn / Demo12345</p>
        </div>

        {/* Nút thao tác */}
        <div className="space-y-2.5 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-primary text-white text-sm font-semibold hover:cursor-pointer rounded-xl shadow-sm"
          >
            <span>{submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}</span>
          </button>

          <button
            type="button"
            onClick={() => nav('/register')}
            className="w-full py-2.5 bg-primary text-white text-sm font-semibold hover:cursor-pointer rounded-xl"
          >
            Đăng ký
          </button>
        </div>
      </form>

      {/* Đăng nhập mạng xã hội (Google / Facebook) */}
      <div className="pt-2 border-t border-gray-100">
        <SocialLogin onLogin={done} onError={fail} />
      </div>
    </div>
  );
}
