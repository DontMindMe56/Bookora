import React, { useEffect, useState } from 'react';
import {
  TrendingUp,
  ShoppingBag,
  CheckCircle,
  XCircle,
  RotateCcw,
  DollarSign,
  Package,
  AlertOctagon,
  AlertTriangle,
  Calendar,
  RefreshCw,
  BarChart3,
  Award,
} from 'lucide-react';
import { api, vnd } from '../api';

export default function AdminReports() {
  const [r, setR] = useState({ from: '', to: '' });
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams(Object.entries(r).filter(([, v]) => v)).toString();
      const [overview, revenue, best] = await Promise.all([
        api('/api/admin/reports/overview?' + qs),
        api('/api/admin/reports/revenue?groupBy=day&' + qs),
        api('/api/admin/reports/best-sellers?' + qs),
      ]);
      setD({ overview, revenue: revenue.rows || [], best: best || [] });
    } catch (e) {
      setErr(e.message || 'Không thể tải dữ liệu báo cáo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [r]);

  // Component phụ hiển thị các thẻ Tile thống kê (KPIs)
  const tile = (title, value, icon, colorClass) => (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex items-center justify-between">
      <div>
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <p className="text-xl font-bold text-gray-800 mt-1">{value}</p>
      </div>
      <div className={`p-3 rounded-lg ${colorClass}`}>{icon}</div>
    </div>
  );

  const o = d?.overview;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">Báo Cáo & Thống Kê</h1>
        </div>
        <button
          onClick={fetchReports}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border flex items-center gap-2 self-start text-sm"
          title="Tải lại"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Bộ lọc khoảng thời gian */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Thời gian:</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Từ</label>
          <input
            type="date"
            value={r.from}
            onChange={(e) => setR({ ...r, from: e.target.value })}
            className="px-3 py-1.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Đến</label>
          <input
            type="date"
            value={r.to}
            onChange={(e) => setR({ ...r, to: e.target.value })}
            className="px-3 py-1.5 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
          />
        </div>
        <span className="text-xs text-gray-400 italic ml-auto">Mặc định: 30 ngày gần nhất</span>
      </div>

      {/* Thông báo lỗi */}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm">{err}</div>}

      {/* Trạng thái đang tải */}
      {loading && !d ? (
        <div className="text-center py-20 text-gray-500">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
          Đang tổng hợp dữ liệu báo cáo...
        </div>
      ) : (
        o && (
          <>
            {/* Lưới các thẻ Tiles Tổng quan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {tile('Tổng số đơn', o.orders, <ShoppingBag className="w-5 h-5 text-blue-600" />, 'bg-blue-50')}
              {tile('Đơn hoàn tất', o.completed, <CheckCircle className="w-5 h-5 text-green-600" />, 'bg-green-50')}
              {tile('Tỷ lệ hủy đơn', o.cancelRate + '%', <XCircle className="w-5 h-5 text-red-600" />, 'bg-red-50')}
              {tile('Tỷ lệ hoàn hàng', o.returnRate + '%', <RotateCcw className="w-5 h-5 text-orange-600" />, 'bg-orange-50')}

              {tile('Giá trị TB / đơn', vnd(o.avgOrderValue), <DollarSign className="w-5 h-5 text-indigo-600" />, 'bg-indigo-50')}
              {tile('Giá trị tồn kho', vnd(o.inventory.stockValue), <Package className="w-5 h-5 text-purple-600" />, 'bg-purple-50')}
              {tile('Sản phẩm hết hàng', o.inventory.outOfStock, <AlertOctagon className="w-5 h-5 text-rose-600" />, 'bg-rose-50')}
              {tile('Dưới mức tối thiểu', o.inventory.belowMin, <AlertTriangle className="w-5 h-5 text-amber-600" />, 'bg-amber-50')}
            </div>

            {/* Bố cục 2 cột cho Bảng Doanh thu và Sản phẩm bán chạy */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              {/* Cột trái: Doanh thu theo ngày */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" /> Doanh thu theo ngày
                </h3>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
                        <th className="p-3">Ngày</th>
                        <th className="p-3 text-center">Đơn</th>
                        <th className="p-3 text-right">Doanh thu</th>
                        <th className="p-3 text-right">Lợi nhuận gộp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {d.revenue.map((x) => (
                        <tr key={x.group} className="hover:bg-gray-50 transition-colors">
                          <td className="p-3 font-medium text-gray-800">{x.group}</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{x.orders}</span>
                          </td>
                          <td className="p-3 text-right font-semibold text-gray-900">{vnd(x.revenue)}</td>
                          <td className="p-3 text-right font-medium text-green-600">{vnd(x.grossProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.revenue.length && <p className="text-xs text-gray-400 italic text-center py-8">Chưa có đơn hoàn tất trong khoảng thời gian này.</p>}
              </div>

              {/* Cột phải: Sản phẩm bán chạy */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Award className="w-4 h-4 text-orange-500" /> Top Sản Phẩm Bán Chạy
                </h3>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
                        <th className="p-3">Sản phẩm</th>
                        <th className="p-3 text-center">Số lượng</th>
                        <th className="p-3 text-right">Doanh thu</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {d.best.map((x) => (
                        <tr key={x.editionId} className="hover:bg-gray-50 transition-colors">
                          <td className="p-3 font-medium text-gray-800 max-w-xs truncate" title={x.title}>
                            {x.title}
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-xs font-medium">{x.units} cuốn</span>
                          </td>
                          <td className="p-3 text-right font-semibold text-gray-900">{vnd(x.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.best.length && <p className="text-xs text-gray-400 italic text-center py-8">Chưa có dữ liệu bán hàng.</p>}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
