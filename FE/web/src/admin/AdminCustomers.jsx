import React, { useState, useEffect } from 'react';
import { Eye, RefreshCw, AlertCircle, X, User, MapPin, ShoppingBag, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, vnd } from '../api';

export const AdminCustomers = () => {
  // States cho danh sách khách hàng
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Bộ lọc & Phân trang
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // State xem chi tiết khách hàng
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // State quản lý Modal Khóa/Mở khóa
  const [targetAccount, setTargetAccount] = useState(null);
  const [actionType, setActionType] = useState(null); // 'LOCK' hoặc 'UNLOCK'
  const [reasonInput, setReasonInput] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);

  // Tải danh sách khách hàng
  const fetchCustomers = async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        ...(searchTerm ? { q: searchTerm } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });

      const data = await api(`/api/admin/customers?${queryParams.toString()}`);

      // Tùy theo cấu trúc paged trả về từ backend (items/data và totalPages)
      const list = data.items || data.data || (Array.isArray(data) ? data : []);
      setCustomers(list);
      if (data.pages) {
        setTotalPages(data.pages);
      } else if (data.total) {
        setTotalPages(Math.ceil(data.total / 20) || 1);
      }
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách khách hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [page, statusFilter]);

  // Tìm kiếm khi nhấn Enter hoặc click nút tìm
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchCustomers();
  };

  // 2. Xem chi tiết khách hàng
  const handleViewDetail = async (customerId) => {
    setSelectedCustomerId(customerId);
    setLoadingDetail(true);
    setCustomerDetail(null);
    try {
      const data = await api(`/api/admin/customers/${customerId}`);
      setCustomerDetail(data);
    } catch (err) {
      alert(err.message || 'Không thể tải thông tin chi tiết khách hàng');
      setSelectedCustomerId(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Xử lý xác nhận Khóa hoặc Mở khóa tài khoản
  const handleConfirmAccountAction = async () => {
    if (actionType === 'LOCK' && !reasonInput.trim()) {
      alert('Vui lòng nhập lý do khóa tài khoản!');
      return;
    }

    setLoadingAction(true);
    try {
      const endpoint = actionType === 'LOCK' ? `/api/admin/accounts/${targetAccount.accountId}/lock` : `/api/admin/accounts/${targetAccount.accountId}/unlock`;

      await api(endpoint, {
        method: 'POST',
        body: { reason: reasonInput || 'Mở khóa tài khoản bởi quản trị viên' },
      });

      setSuccessMsg(actionType === 'LOCK' ? 'Đã khóa tài khoản thành công!' : 'Đã mở khóa tài khoản thành công!');

      // Đóng modal và reset
      setTargetAccount(null);
      setReasonInput('');
      setActionType(null);

      // Tải lại danh sách và chi tiết khách hàng
      fetchCustomers();
      if (selectedCustomerId) {
        handleViewDetail(selectedCustomerId);
      }
    } catch (err) {
      alert(err.message || 'Thực hiện thao tác thất bại');
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản Lý Khách Hàng</h1>
        </div>
        <button onClick={fetchCustomers} className="p-2 bg-primary text-white rounded-lg border flex items-center gap-2 self-start" title="Tải lại">
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Thông báo lỗi / thành công */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Thanh tìm kiếm và lọc */}
      <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Tìm theo tên, email hoặc số điện thoại..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="ACTIVE">Hoạt động (ACTIVE)</option>
          <option value="LOCKED">Đã khóa (LOCKED)</option>
          <option value="UNVERIFIED">Chưa xác thực (UNVERIFIED)</option>
        </select>

        <button type="submit" className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          Tìm kiếm
        </button>
      </form>

      {/* Bảng danh sách khách hàng */}
      <div className="overflow-x-auto border rounded-lg mb-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
              <th className="p-3">Khách hàng</th>
              <th className="p-3">Liên hệ</th>
              <th className="p-3">Trạng thái</th>
              <th className="p-3 text-center">Đơn hàng</th>
              <th className="p-3">Ngày đăng ký</th>
              <th className="p-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {loading ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-500">
                  Đang tải danh sách khách hàng...
                </td>
              </tr>
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-500">
                  Không tìm thấy khách hàng nào.
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr key={c.customerId} className="hover:bg-gray-50 transition-colors">
                  <td className="p-3">
                    <div className="font-medium text-gray-900 flex items-center gap-1.5">
                      {c.fullName || 'Chưa cập nhật'}
                      {c.riskFlag ? (
                        <span title="Cảnh báo rủi ro">
                          <ShieldAlert className="w-4 h-4 text-red-500" />
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-gray-400 font-mono">ID: {c.customerId.substring(0, 8)}...</div>
                  </td>
                  <td className="p-3">
                    <div className="text-gray-800">{c.email}</div>
                    <div className="text-xs text-gray-500">{c.phone || '—'}</div>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        c.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800'
                          : c.status === 'LOCKED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="p-3 text-center font-medium">
                    <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md text-xs">{c.orderCount || 0} đơn</span>
                  </td>
                  <td className="p-3 text-xs text-gray-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('vi-VN') : '—'}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleViewDetail(c.customerId)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex items-center gap-1 text-xs font-medium border border-blue-200 transition-colors"
                      title="Xem chi tiết"
                    >
                      <Eye className="w-4 h-4" />
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

      {/* MODAL XEM CHI TIẾT KHÁCH HÀNG */}
      {selectedCustomerId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b sticky top-y bg-white z-10">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" /> Chi Tiết Khách Hàng
              </h3>
              <button onClick={() => setSelectedCustomerId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {loadingDetail ? (
                <div className="text-center py-12 text-gray-500">Đang tải thông tin chi tiết...</div>
              ) : customerDetail ? (
                <div className="space-y-6">
                  {/* Thông tin cơ bản */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg border mb-3">
                    <div>
                      <p className="text-xs text-gray-500">Họ và tên</p>
                      <p className="font-semibold text-gray-800">{customerDetail.fullName || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Email</p>
                      <p className="font-medium text-gray-800">{customerDetail.email}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Số điện thoại</p>
                      <p className="text-gray-800">{customerDetail.phone || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Số dư tài khoản</p>
                      <p className="font-semibold text-green-600">{vnd(customerDetail.accountBalance)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Ngày sinh / Giới tính</p>
                      <p className="text-gray-800">
                        {customerDetail.dateOfBirth ? new Date(customerDetail.dateOfBirth).toLocaleDateString('vi-VN') : '—'}
                        {customerDetail.gender ? ` (${customerDetail.gender})` : ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Trạng thái tài khoản</p>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full mt-0.5 ${
                          customerDetail.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {customerDetail.status} {customerDetail.lockReason ? `- Lý do: ${customerDetail.lockReason}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-end mb-3">
                    {customerDetail.status === 'LOCKED' ? (
                      <button
                        onClick={() => {
                          setTargetAccount(customerDetail);
                          setActionType('UNLOCK');
                          setReasonInput('');
                        }}
                        className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium flex items-center gap-1"
                      >
                        Mở khóa tài khoản
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setTargetAccount(customerDetail);
                          setActionType('LOCK');
                          setReasonInput('');
                        }}
                        className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium flex items-center gap-1"
                      >
                        Khóa tài khoản
                      </button>
                    )}
                  </div>

                  {/* Danh sách địa chỉ */}
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-orange-500" /> Địa chỉ nhận hàng ({customerDetail.addresses?.length || 0})
                    </h4>
                    {customerDetail.addresses && customerDetail.addresses.length > 0 ? (
                      <div className="space-y-2">
                        {customerDetail.addresses.map((addr, idx) => (
                          <div key={idx} className="p-3 border rounded-lg text-xs bg-white flex justify-between items-start">
                            <div>
                              <p className="font-medium text-gray-800">
                                {addr.recipientName || customerDetail.fullName} - {addr.phone}
                              </p>
                              <p className="text-gray-600 mt-0.5">
                                {addr.detail}, {addr.ward}, {addr.district}, {addr.province}
                              </p>
                            </div>
                            {addr.isDefault ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-semibold text-[10px]">Mặc định</span> : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">Khách hàng chưa lưu địa chỉ nào.</p>
                    )}
                  </div>

                  {/* Lịch sử đơn hàng gần đây */}
                  <div>
                    <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-1.5">
                      <ShoppingBag className="w-4 h-4 text-blue-500" /> Đơn hàng gần đây ({customerDetail.orders?.length || 0})
                    </h4>
                    {customerDetail.orders && customerDetail.orders.length > 0 ? (
                      <div className="overflow-x-auto border rounded-lg">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50 border-b text-gray-600">
                            <tr>
                              <th className="p-2.5">Mã đơn</th>
                              <th className="p-2.5">Trạng thái</th>
                              <th className="p-2.5">Thanh toán</th>
                              <th className="p-2.5 text-right">Tổng tiền</th>
                              <th className="p-2.5 text-right">Ngày đặt</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {customerDetail.orders.map((order) => (
                              <tr key={order.orderId} className="hover:bg-gray-50">
                                <td className="p-2.5 font-mono font-medium text-blue-600">{order.orderCode}</td>
                                <td className="p-2.5">
                                  <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-700">{order.orderStatus}</span>
                                </td>
                                <td className="p-2.5">
                                  {order.paymentStatus} ({order.paymentMethod})
                                </td>
                                <td className="p-2.5 text-right font-medium">{vnd(order.totalAmount)}</td>
                                <td className="p-2.5 text-right text-gray-500">
                                  {order.createdAt ? new Date(order.createdAt).toLocaleDateString('vi-VN') : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">Khách hàng chưa có đơn hàng nào.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-center py-12 text-red-500">Không thể tải dữ liệu chi tiết.</p>
              )}
            </div>

            {/* Modal Footer */}
          </div>
        </div>
      )}

      {/* MODAL NHẬP LÝ DO KHÓA / MỞ KHÓA TÀI KHOẢN */}
      {targetAccount && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className={`text-lg font-bold flex items-center gap-2 ${actionType === 'LOCK' ? 'text-red-600' : 'text-green-600'}`}>
              <ShieldAlert className="w-5 h-5" />
              {actionType === 'LOCK' ? 'Xác nhận khóa tài khoản' : 'Xác nhận mở khóa tài khoản'}
            </h3>

            <p className="text-sm text-gray-600">
              Bạn có chắc chắn muốn {actionType === 'LOCK' ? 'khóa' : 'mở khóa'} tài khoản của khách hàng{' '}
              <span className="font-semibold text-gray-800">{targetAccount.fullName || targetAccount.email}</span> không?
            </p>

            {actionType === 'LOCK' && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">
                  Lý do khóa tài khoản <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows="3"
                  placeholder="Nhập lý do vi phạm (ví dụ: Gian lận đơn hàng, spam hệ thống...)"
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 border-gray-300"
                ></textarea>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTargetAccount(null)}
                disabled={loadingAction}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmAccountAction}
                disabled={loadingAction}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                {loadingAction ? 'Đang xử lý...' : actionType === 'LOCK' ? 'Xác nhận Khóa' : 'Xác nhận Mở khóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
