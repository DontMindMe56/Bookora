import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, vnd } from '../api';
import { Package, ChevronRight, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Orders() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/api/orders')
      .then(setD)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !d) {
    return <div className="flex justify-center items-center py-20 text-gray-500 text-sm">Đang tải danh sách đơn hàng…</div>;
  }

  const items = d.items || [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="border-b pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-600" /> Đơn hàng của tôi
          </h1>
          <p className="text-sm text-gray-500 mt-1">Quản lý và theo dõi lịch sử mua hàng của bạn</p>
        </div>
        <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-3 py-1 rounded-full border border-blue-100">Tổng số: {items.length} đơn</span>
      </div>

      {/* Danh sách đơn hàng */}
      {items.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200 shadow-sm space-y-3">
          <Package className="w-12 h-12 text-gray-300 mx-auto" />
          <p className="text-gray-500 text-sm">Bạn chưa có đơn hàng nào.</p>
          <Link to="/" className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            Khám phá sản phẩm ngay
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((o) => {
            // Xác định màu sắc hiển thị cho trạng thái đơn hàng (orderStatus) / thanh toán (paymentStatus)
            const isCompleted = o.orderStatus?.toLowerCase() === 'completed' || o.orderStatus?.toLowerCase() === 'success';
            const isCancelled = o.orderStatus?.toLowerCase() === 'cancelled';

            return (
              <Link
                key={o.orderId}
                to={`/orders/${o.orderId}`}
                className="block bg-white border border-gray-200 rounded-lg p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Thông tin chính của đơn hàng */}
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">#{o.orderCode}</span>
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{o.paymentMethod || 'COD'}</span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-1 font-medium">
                      {o.firstTitle || 'Sản phẩm sách'}
                      {o.itemCount > 1 ? ` và ${o.itemCount - 1} sản phẩm khác` : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      Tổng số lượng: <span className="font-medium text-gray-600">{o.itemCount}</span> sản phẩm
                    </p>
                  </div>

                  {/* Trạng thái và Tổng tiền */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-3 sm:pt-0 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2.5 py-1 rounded-full font-medium border bg-gray-50 text-gray-700 border-gray-200">
                        {o.paymentStatus} / {o.orderStatus}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-red-600">{vnd(o.totalAmount)}</span>
                      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform hidden sm:block" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
