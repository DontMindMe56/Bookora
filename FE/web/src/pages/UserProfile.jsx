import React, { useState, useEffect } from 'react';
import { User, Key, Save, RefreshCw, CheckCircle2, Wallet } from 'lucide-react';
import { api, vnd } from '../api';
import toast from 'react-hot-toast';

export default function UserProfile() {
  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Form state cho thông tin cá nhân (map đúng với cấu trúc nested profile)
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
  });

  // Tải thông tin tài khoản hiện tại từ API
  const fetchProfile = async () => {
    setLoading(true);
    try {
      const data = await api('/api/auth/me');
      setProfileData(data);
      setFormData({
        fullName: data.profile?.fullName || '',
        phone: data.profile?.phone || '',
        dateOfBirth: data.profile?.dateOfBirth ? data.profile.dateOfBirth.split('T')[0] : '',
        gender: data.profile?.gender || '',
      });
    } catch (err) {
      toast.error(err.message || 'Không thể tải thông tin tài khoản');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  // Xử lý cập nhật thông tin chung (Khớp với PATCH /api/auth/me)
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/auth/me', {
        method: 'PATCH',
        body: {
          fullName: formData.fullName,
          phone: formData.phone || undefined,
          dateOfBirth: formData.dateOfBirth || undefined,
          gender: formData.gender || undefined,
        },
      });
      toast.success('Cập nhật thông tin thành công!');
      fetchProfile();
    } catch (err) {
      toast.error(err.message || 'Cập nhật thất bại');
    } finally {
      setSaving(false);
    }
  };

  // Xử lý đổi mật khẩu
  const handleChangePassword = async (e) => {
    e.preventDefault();

    const userEmail = profileData?.email;
    if (!userEmail) {
      toast.error('Không tìm thấy thông tin email của tài khoản.');
      return;
    }

    setChangingPassword(true);
    try {
      // Gọi đúng route POST /api/auth/forgot-password từ router backend
      await api('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: userEmail },
      });
      toast.success('Đã gửi liên kết đặt lại mật khẩu tới email của bạn. Vui lòng kiểm tra hộp thư!');
    } catch (err) {
      toast.error(err.message || 'Không thể gửi yêu cầu đặt lại mật khẩu');
    } finally {
      setChangingPassword(false);
    }
  };

  // Hàm xử lý Xóa dữ liệu / Xóa tài khoản vĩnh viễn (Dành riêng cho Customer)
  // Chưa hoàn thành
  const handleDeleteAccount = async () => {
    const password = window.prompt(
      'HÀNH ĐỘNG NGUY HIỂM: Thao tác này sẽ xóa vĩnh viễn toàn bộ dữ liệu và lịch sử của bạn. Nhập mật khẩu tài khoản để xác nhận:',
    );
    if (password === null) return;
    if (!password.trim()) {
      toast.error('Vui lòng nhập mật khẩu để xác nhận.');
      return;
    }

    setActionLoading(true);
    try {
      // Gửi mật khẩu lên backend để xác thực quyền chủ sở hữu trước khi xóa
      await api('/api/auth/account', {
        method: 'DELETE',
        body: { password },
      });
      toast.success('Đã xóa tài khoản thành công.');
      nav('/');
    } catch (err) {
      toast.error(err.message || 'Mật khẩu không chính xác hoặc không thể xóa tài khoản');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !profileData) {
    return (
      <div className="flex justify-center items-center py-24 text-gray-500 text-sm gap-2">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-600" /> Đang tải thông tin tài khoản…
      </div>
    );
  }

  const isStaffOrAdmin = profileData.role && profileData.role !== 'CUSTOMER';
  const isCustomer = profileData.role === 'CUSTOMER';
  const userProfile = profileData.profile || {};

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">Quản lý thông tin tài khoản</h1>
        </div>
        <span
          className={`text-xs font-semibold px-3 py-1 rounded-full border uppercase ${
            isStaffOrAdmin ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}
        >
          {isStaffOrAdmin ? `Nhân sự: ${profileData.role}` : 'Khách hàng (Customer)'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Cột trái: Thẻ tóm tắt thông tin nhanh */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm text-center space-y-4 md:col-span-1 h-fit">
          <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mx-auto border-2 border-blue-200">
            {userProfile.fullName ? userProfile.fullName.charAt(0).toUpperCase() : <User className="w-10 h-10" />}
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-gray-900 text-lg">{userProfile.fullName || 'Người dùng'}</h3>
            <p className="text-xs text-gray-500 truncate">{profileData.email}</p>
          </div>

          {/* Số dư tài khoản (nếu có) */}
          {isCustomer && (
            <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-center space-y-0.5">
              <span className="text-xs text-blue-600 font-medium flex items-center justify-center gap-1">
                <Wallet className="w-4 h-4" /> Số dư ví
              </span>
              <p className="text-base font-bold text-blue-700">{vnd(userProfile.accountBalance || 0)}</p>
            </div>
          )}

          <div className="pt-3 border-t border-gray-100 text-left space-y-2 text-xs text-gray-600">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Trạng thái:</span>
              <span className="font-medium text-green-600 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> {profileData.status}
              </span>
            </div>
          </div>

          {isCustomer && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 shadow-sm space-y-3">
              <p className="text-xs text-red-600 leading-relaxed">Thao tác dưới đây làm mất dữ liệu tài khoản của bạn.</p>

              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={actionLoading}
                className="w-full px-3 py-2 bg-primary text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                Xóa tài khoản
              </button>
            </div>
          )}
        </div>

        {/* Cột phải: Form cập nhật thông tin và đổi mật khẩu */}
        <div className="md:col-span-2 space-y-6">
          {/* Form 1: Thông tin cá nhân */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-gray-800 flex items-center gap-2 border-b pb-3">
              <User className="w-5 h-5 text-blue-600" />
              <span>Thông tin chi tiết hồ sơ</span>
            </h3>

            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Họ và tên</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                    required
                    className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Nhập họ và tên..."
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Email đăng nhập (Không thể thay đổi)</label>
                <div className="relative">
                  <input
                    type="email"
                    value={profileData.email}
                    disabled
                    className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Số điện thoại</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                      placeholder="Nhập số điện thoại..."
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Ngày sinh</label>
                  <div className="relative">
                    <input
                      type="date"
                      value={formData.dateOfBirth}
                      onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                      className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Giới tính</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-4 py-2.5 border rounded-lg text-sm bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="">-- Chọn giới tính --</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-primary disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  <div className="flex items-center gap-1">
                    <Save className="w-5 h-5" />
                    <span>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</span>
                  </div>
                </button>
              </div>
            </form>
          </div>

          {/* Form 2: Đổi mật khẩu */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-gray-800 flex items-center gap-2 border-b pb-3">
              <Key className="w-5 h-5 text-blue-600" />
              <span>Đổi mật khẩu</span>
            </h3>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="px-5 py-2.5 bg-primary disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  <div className="flex items-center gap-1">
                    <Key className="w-5 h-5" />
                    <span>{changingPassword ? 'Đang xử lý...' : 'Cập nhật mật khẩu'}</span>
                  </div>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
