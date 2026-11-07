import React, { useState, useEffect } from 'react';
import { Users, Search, Plus, RefreshCw, Shield, Mail, Phone, Edit, KeyRound, ShieldAlert, X, Check, ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';
import { api } from '../api';
import toast from 'react-hot-toast';

export default function AdminStaff() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState(''); // State lọc theo role (ADMIN / STAFF)
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // States quản lý Modal Thêm mới / Chỉnh sửa nhân viên
  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    position: '',
    role: 'STAFF',
  });
  const [submitting, setSubmitting] = useState(false);

  // 1. Tải danh sách nhân viên (kết hợp lọc role nếu API hỗ trợ, hoặc lọc trực tiếp trên mảng)
  const fetchStaff = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        ...(searchTerm ? { q: searchTerm } : {}),
        ...(roleFilter ? { role: roleFilter } : {}),
      });
      const data = await api(`/api/admin/staff?${queryParams.toString()}`);

      let items = data.items || data.data || (Array.isArray(data) ? data : []);

      // Dự phòng trường hợp Backend chưa lọc trực tiếp qua query, ta lọc ở frontend
      if (roleFilter) {
        items = items.filter((s) => s.role === roleFilter);
      }

      setStaffList(items);
      if (data.pages) {
        setTotalPages(data.pages);
      } else if (data.total) {
        setTotalPages(Math.ceil(data.total / 20) || 1);
      }
    } catch (err) {
      toast.error(err.message || 'Không thể tải danh sách nhân viên');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, [page, roleFilter]); // Tự động load lại khi thay đổi bộ lọc role hoặc chuyển trang

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchStaff();
  };

  // 2. Mở modal Thêm / Sửa
  const handleOpenModal = (staff = null) => {
    if (staff) {
      setEditingStaff(staff);
      setFormData({
        fullName: staff.fullName || '',
        email: staff.email || '',
        phone: staff.phone || '',
        position: staff.position || '',
        role: staff.role || 'STAFF',
      });
    } else {
      setEditingStaff(null);
      setFormData({
        fullName: '',
        email: '',
        phone: '',
        position: '',
        role: 'STAFF',
      });
    }
    setShowModal(true);
  };

  // 3. Xử lý submit form (Tạo mới hoặc Cập nhật)
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingStaff) {
        await api(`/api/admin/staff/${editingStaff.staffId}`, {
          method: 'PUT',
          body: {
            fullName: formData.fullName,
            phone: formData.phone,
            position: formData.position,
            role: formData.role,
          },
        });
        toast.success('Đã cập nhật thông tin nhân viên thành công');
      } else {
        await api('/api/admin/staff', {
          method: 'POST',
          body: formData,
        });
        toast.success('Đã thêm nhân viên mới và gửi link thiết lập mật khẩu');
      }
      setShowModal(false);
      fetchStaff();
    } catch (err) {
      toast.error(err.message || 'Thực hiện thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  // 4. Gửi lại link đặt mật khẩu
  const handleResendLink = async (staffId) => {
    if (!confirm('Bạn có muốn gửi lại đường dẫn thiết lập mật khẩu cho nhân viên này?')) return;
    try {
      await api(`/api/admin/staff/${staffId}/resend-link`, { method: 'POST' });
      toast.success('Đã gửi lại đường dẫn thiết lập mật khẩu qua email');
    } catch (err) {
      toast.error(err.message || 'Không thể gửi lại đường dẫn');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-600" /> Quản Lý Nhân Sự
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStaff}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border flex items-center gap-2 text-sm"
            title="Tải lại"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => handleOpenModal(null)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2"
          >
            <div className="flex items-center gap-1">
              <Plus className="w-4 h-4" />
              <span>Thêm nhân viên</span>
            </div>
          </button>
        </div>
      </div>

      {/* Thanh tìm kiếm & Lọc vai trò (Role Select) */}
      <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Tìm theo tên nhân viên hoặc email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm border-gray-300"
          />
        </div>

        {/* Cụm Select Option lọc vai trò */}
        <select
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
        >
          <option value="">Tất cả vai trò</option>
          <option value="ADMIN">Quản trị viên (ADMIN)</option>
          <option value="STAFF">Nhân viên (STAFF)</option>
        </select>

        <button type="submit" className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors text-sm font-medium">
          Tìm kiếm
        </button>
      </form>

      {/* Bảng danh sách nhân viên */}
      <div className="overflow-x-auto border rounded-lg mb-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
              <th className="p-3">Nhân sự</th>
              <th className="p-3">Liên hệ</th>
              <th className="p-3">Chức vụ / Vị trí</th>
              <th className="p-3">Vai trò (Role)</th>
              <th className="p-3">Trạng thái</th>
              <th className="p-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-500">
                  Đang tải danh sách nhân viên...
                </td>
              </tr>
            ) : staffList.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-gray-500">
                  Không tìm thấy nhân viên nào phù hợp.
                </td>
              </tr>
            ) : (
              staffList.map((s) => (
                <tr key={s.staffId} className="hover:bg-gray-50 transition-colors">
                  <td className="p-3">
                    <div className="font-medium text-gray-900">{s.fullName || 'Chưa cập nhật'}</div>
                    <div className="text-xs text-gray-400 font-mono">ID: {s.staffId.substring(0, 8)}...</div>
                  </td>
                  <td className="p-3">
                    <div className="text-gray-800 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-gray-400" /> {s.email}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                      <Phone className="w-3.5 h-3.5 text-gray-400" /> {s.phone || '—'}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-gray-700 bg-gray-100 px-2 py-1 rounded text-xs font-medium">
                      <Briefcase className="w-3 h-3 text-gray-500" /> {s.position || '—'}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        s.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {s.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        s.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={() => handleOpenModal(s)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex items-center gap-1 text-xs font-medium border border-blue-200 transition-colors"
                      title="Chỉnh sửa thông tin"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleResendLink(s.staffId)}
                      className="p-1.5 text-orange-600 hover:bg-orange-50 rounded-lg inline-flex items-center gap-1 text-xs font-medium border border-orange-200 transition-colors"
                      title="Gửi lại link đặt mật khẩu"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-gray-500">
            Trang <span className="font-medium">{page}</span> / <span className="font-medium">{totalPages}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page === totalPages}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MODAL THÊM / SỬA NHÂN VIÊN */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-gray-800">{editingStaff ? 'Chỉnh Sửa Thông Tin Nhân Viên' : 'Thêm Nhân Viên Mới'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Họ và tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Nguyễn Văn A"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                />
              </div>

              {!editingStaff && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Email đăng nhập <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="staff@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Số điện thoại</label>
                  <input
                    type="text"
                    placeholder="0912345678"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Chức vụ / Vị trí</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Thủ kho, CSKH..."
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    className="w-full p-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Vai trò hệ thống (Role)</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full p-2.5 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                >
                  <option value="STAFF">Nhân viên (STAFF)</option>
                  <option value="ADMIN">Quản trị viên (ADMIN)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Đang xử lý...' : editingStaff ? 'Cập nhật' : 'Tạo nhân viên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
