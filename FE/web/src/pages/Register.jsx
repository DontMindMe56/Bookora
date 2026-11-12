import { useState } from 'react';
import { User, Mail, Lock, Phone, ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api } from '../api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export default function Register() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    acceptTerms: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const nav = useNavigate();
  const handleGoToLogin = () => {
    nav('/login');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Mật khẩu xác nhận không khớp!');
      return;
    }

    if (!formData.acceptTerms) {
      toast.error('Bạn cần đồng ý với điều khoản và chính sách dữ liệu cá nhân');
      return;
    }

    setSubmitting(true);
    try {
      // Gọi API đăng ký khách hàng (/api/auth/register)
      const res = await api('/api/auth/register', {
        method: 'POST',
        body: {
          fullName: formData.fullName.trim(),
          email: formData.email.trim(),
          password: formData.password,
          phone: formData.phone.trim() || undefined,
          acceptTerms: formData.acceptTerms,
        },
      });

      toast.success(res.message || 'Đăng ký thành công!');
      setIsSuccess(true);
    } catch (err) {
      toast.error(err.message || 'Đăng ký thất bại. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-2xl p-8 shadow-sm text-center space-y-4 my-12">
        <div className="w-12 h-12 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto border border-green-200">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">Đăng ký tài khoản thành công!</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Chúng tôi đã gửi một liên kết xác thực đến email <strong className="text-gray-900">{formData.email}</strong>. Vui lòng kiểm tra hộp thư để kích hoạt
          tài khoản của bạn.
        </p>
        <button onClick={handleGoToLogin} className="w-full py-2.5 bg-primary text-white text-sm font-semibold rounded-xl shadow-sm transition-colors mt-2">
          Đăng nhập ngay
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-2xl p-8 shadow-sm my-12 space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Đăng ký tài khoản</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Họ và tên */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Họ và tên</label>
          <div className="relative">
            <input
              type="text"
              required
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="Ví dụ: Nguyễn Văn A"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Địa chỉ Email</label>
          <div className="relative">
            <input
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="name@example.com"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>
        </div>

        {/* Số điện thoại (Tùy chọn) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Số điện thoại (Tùy chọn)</label>
          <div className="relative">
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="0912345678"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
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
              minLength={8}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Tối thiểu 8 ký tự, có chữ và số"
              className="w-full pl-10 pr-12 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Mật khẩu yêu cầu tối thiểu 8 ký tự, bao gồm cả chữ cái và chữ số.</p>
        </div>

        {/* Xác nhận mật khẩu */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Xác nhận mật khẩu</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              required
              minLength={8}
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              placeholder="Nhập lại mật khẩu..."
              className="w-full pl-10 pr-12 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
            >
              {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Điều khoản */}
        <div className="flex items-start gap-2.5 pt-1">
          <input
            type="checkbox"
            id="acceptTerms"
            checked={formData.acceptTerms}
            onChange={(e) => setFormData({ ...formData, acceptTerms: e.target.checked })}
            className="w-4 h-4 mt-0.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label htmlFor="acceptTerms" className="text-xs text-gray-600 leading-normal select-none">
            Tôi đồng ý với các{' '}
            <a href="/terms-and-privacy" className="text-blue-600 hover:underline font-medium">
              điều khoản dịch vụ
            </a>{' '}
            và{' '}
            <a href="/terms-and-privacy" className="text-blue-600 hover:underline font-medium">
              chính sách dữ liệu cá nhân
            </a>
            .
          </label>
        </div>

        {/* Nút Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-primary hover:cursor-pointer disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-sm mt-2"
        >
          <span>{submitting ? 'Đang xử lý...' : 'Đăng ký tài khoản'}</span>
        </button>
      </form>

      {/* Chuyển sang đăng nhập */}
      <div className="text-center pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Đã có tài khoản?{' '}
          <button onClick={handleGoToLogin} className="bg-primary text-white font-semibold p-1 rounded-md cursor-pointer">
            Đăng nhập ngay
          </button>
        </p>
      </div>
    </div>
  );
}
