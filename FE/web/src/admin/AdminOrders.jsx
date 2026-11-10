import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, vnd } from '../api';

const ORDER = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RETURNED', 'RETURNED_TO_WAREHOUSE'];
const PAY = ['UNPAID', 'PAID', 'COD_COLLECTED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED'];
const SHIP = ['NOT_CREATED', 'WAITING_PICKUP', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETURNING', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED'];

export default function AdminOrders() {
  const [f, setF] = useState({ q: '', status: '', paymentStatus: '', shippingStatus: '' });
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  const set = (k, v) => {
    setF((x) => ({ ...x, [k]: v }));
    setPage(1);
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
      const res = await api('/api/staff/orders?' + p);
      setD(res);
    } catch {
      setD({ items: [], total: 0, totalPages: 1 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [f, page]);

  // Hàm helper render select box đồng bộ giao diện
  const sel = (k, list, label) => (
    <select
      value={f[k]}
      onChange={(e) => set(k, e.target.value)}
      className="px-3 py-2 border rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
    >
      <option value="">{label}</option>
      {list.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">Quản Lý Đơn Hàng</h1>
        </div>
        <button
          onClick={fetchOrders}
          className="p-2 bg-primary text-white rounded-lg transition-colors border flex items-center gap-2 self-start text-sm"
          title="Tải lại"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Bộ lọc & Tìm kiếm */}
      <div className="flex flex-col lg:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Tìm theo mã đơn, SĐT, tên người nhận…"
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300 text-sm"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {sel('status', ORDER, 'Trạng thái đơn')}
          {sel('paymentStatus', PAY, 'Thanh toán')}
          {sel('shippingStatus', SHIP, 'Vận chuyển')}
        </div>
      </div>

      {/* Bảng danh sách đơn hàng */}
      <div className="overflow-x-auto border rounded-lg mb-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
              <th className="p-3">Mã đơn</th>
              <th className="p-3">Người nhận</th>
              <th className="p-3">Tổng tiền</th>
              <th className="p-3">PT Thanh toán</th>
              <th className="p-3">Trạng thái đơn</th>
              <th className="p-3">Thanh toán</th>
              <th className="p-3">Vận chuyển</th>
              <th className="p-3 text-right">Ngày đặt</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-gray-500">
                  Đang tải danh sách đơn hàng...
                </td>
              </tr>
            ) : !d || !d.items || d.items.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-gray-500">
                  Không tìm thấy đơn hàng nào phù hợp.
                </td>
              </tr>
            ) : (
              d.items.map((o) => (
                <tr key={o.orderId} className="hover:bg-gray-50 transition-colors">
                  <td className="p-3 font-mono">
                    <Link to={`/admin/orders/${o.orderId}`} className="text-blue-600 font-bold hover:underline">
                      {o.orderCode}
                    </Link>
                  </td>
                  <td className="p-3">
                    <div className="font-medium text-gray-900">{o.receiverName}</div>
                    <div className="text-xs text-gray-500">{o.receiverPhone}</div>
                  </td>
                  <td className="p-3 font-semibold text-gray-900">{vnd(o.totalAmount)}</td>
                  <td className="p-3 text-gray-700">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs font-medium">{o.paymentMethod}</span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                        o.orderStatus === 'COMPLETED'
                          ? 'bg-green-100 text-green-800'
                          : o.orderStatus === 'CANCELLED'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {o.orderStatus}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${
                        o.paymentStatus === 'PAID' || o.paymentStatus === 'COD_COLLECTED' ? 'text-green-700 bg-green-50' : 'text-orange-700 bg-orange-50'
                      }`}
                    >
                      {o.paymentStatus}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-gray-600">{o.shippingStatus}</td>
                  <td className="p-3 text-right text-xs text-gray-500 whitespace-nowrap">
                    {o.createdAt ? new Date(o.createdAt).toLocaleString('vi-VN') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {d && d.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-2">
          <div className="text-xs text-gray-500">
            Trang <span className="font-medium">{page}</span> / <span className="font-medium">{d.totalPages || 1}</span> · Tổng số{' '}
            <span className="font-medium">{d.total}</span> đơn hàng
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= (d.totalPages || 1)}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
