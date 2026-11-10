import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Package, Truck, User, Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw, FileText } from 'lucide-react';
import { api, vnd } from '../api';

export default function AdminOrderDetail() {
  const { id } = useParams();
  const [o, setO] = useState(null);
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/staff/orders/' + id);
      setO(data);
    } catch (e) {
      toast.error(e.message || 'Không thể tải thông tin đơn hàng');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const act = async (path, body, okMessage) => {
    setActionLoading(true);
    try {
      const r = await api(`/api/staff/orders/${id}/${path}`, { method: 'POST', body });
      toast.success(okMessage);
      load();
      return r;
    } catch (e) {
      toast.error(e.message || 'Thực hiện thao tác thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  const doPack = async () => {
    const res = await act('packing', { isbns: o.items.flatMap((i) => Array(i.quantity).fill(i.isbn)) }, 'Đã quét đóng gói');
    if (res) setPack(res);
  };

  const cancel = () => {
    const reason = prompt('Nhập lý do hủy đơn (tối thiểu 3 ký tự):');
    if (reason && reason.trim().length >= 3) {
      act('cancel', { reason }, 'Đã hủy đơn thành công');
    } else if (reason !== null) {
      toast.error('Lý do hủy đơn phải có ít nhất 3 ký tự');
    }
  };

  if (loading && !o) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-20 text-gray-500">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
        Đang tải thông tin đơn hàng...
      </div>
    );
  }

  if (!o) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-20">
        <p className="text-gray-500 mb-4">Không tìm thấy thông tin đơn hàng.</p>
        <Link to="/admin/orders" className="text-blue-600 hover:underline font-medium">
          ← Quay lại danh sách đơn hàng
        </Link>
      </div>
    );
  }

  const a = o.shippingAddressSnapshot || {};
  const packable = ['CONFIRMED', 'PACKING'].includes(o.orderStatus);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header & Quay lại */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b">
        <div className="space-y-1">
          <Link to="/admin/orders" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 font-medium mb-1">
            <ArrowLeft className="w-4 h-4" /> Quay lại danh sách đơn hàng
          </Link>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            Chi Tiết Đơn Hàng <span className="font-mono">#{o.orderCode}</span>
          </h1>
        </div>
        <button onClick={load} className="p-2 bg-primary text-white rounded-lg border flex items-center gap-2 self-start text-sm" title="Tải lại">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* LAYOUT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* HÀNG 1 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-600" /> Sản phẩm trong đơn ({o.items?.length || 0})
            </h3>
            <div className="divide-y">
              {o.items.map((i) => (
                <div key={i.editionId} className="py-3 flex items-center gap-4 first:pt-0 last:pb-0">
                  <img
                    src={i.coverImageUrl || 'https://via.placeholder.com/60'}
                    alt={i.title}
                    className="w-14 h-18 object-cover rounded border bg-gray-50 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-800 text-sm truncate">{i.title}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">
                      ISBN: <span className="font-mono">{i.isbn}</span> · {vnd(i.unitPrice)} × {i.quantity}
                    </p>
                  </div>
                  <div className="text-right font-semibold text-gray-900 text-sm shrink-0">{vnd(i.lineTotal)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-4 border-2 flex justify-between items-center text-base font-bold text-gray-900 bg-gray-100 border-gray-400 p-3 rounded-lg">
            <span>Tổng cộng</span>
            <span className="text-blue-600 text-lg">{vnd(o.totalAmount)}</span>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-green-600" /> Trạng thái hiện tại
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-1.5 border-b">
                <span className="text-gray-500">Trạng thái đơn</span>
                <span className="font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{o.orderStatus}</span>
              </div>
              <div className="flex justify-between items-center py-1.5 border-b">
                <span className="text-gray-500">Thanh toán</span>
                <span className="font-medium text-gray-800">
                  {o.paymentStatus} <span className="text-xs text-gray-400">({o.paymentMethod})</span>
                </span>
              </div>
              <div className="flex justify-between items-center py-1.5">
                <span className="text-gray-500">Vận chuyển</span>
                <span className="font-medium text-gray-800">{o.shippingStatus}</span>
              </div>
            </div>
          </div>
        </div>

        {/* HÀNG 2 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
              <User className="w-4 h-4 text-purple-600" /> Thông tin người nhận
            </h3>
            <div className="space-y-1.5 text-sm">
              <p className="font-semibold text-gray-800">{a.receiverName || '—'}</p>
              <p className="text-gray-600">{a.phone || '—'}</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                {[a.detail, a.ward, a.district, a.province].filter(Boolean).join(', ') || 'Chưa có địa chỉ'}
              </p>
              {o.note && (
                <div className="mt-3 p-2.5 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                  <span className="font-semibold">Ghi chú:</span> {o.note}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Truck className="w-4 h-4 text-orange-500" /> Thông tin vận đơn
            </h3>
            {!o.shipments || o.shipments.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Chưa có thông tin vận đơn nào được tạo.</p>
            ) : (
              <div className="space-y-2">
                {o.shipments.map((s, k) => (
                  <div key={k} className="p-3 border rounded-lg text-xs bg-gray-50 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-gray-800">{s.direction}</span> ·
                      <span className="text-blue-600 font-medium ml-1">Trạng thái: {s.status}</span>
                    </div>
                    <div className="font-mono bg-white px-2 py-1 border rounded text-gray-700">Mã GHN: {s.ghnOrderCode || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* HÀNG 3 */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" /> Thao tác xử lý đơn hàng
          </h3>

          <div className="flex flex-wrap gap-3">
            {packable && (
              <button
                onClick={doPack}
                disabled={actionLoading}
                className="py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" /> Quét đóng gói
              </button>
            )}

            {packable && (
              <button
                onClick={() => act('shipment', undefined, 'Đã tạo vận đơn thành công')}
                disabled={actionLoading}
                className="py-2 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Truck className="w-4 h-4" /> Tạo vận đơn GHN
              </button>
            )}

            {o.orderStatus === 'RETURNED' && (
              <button
                onClick={() => act('returned-received', undefined, 'Đã nhập kho hàng hoàn thành công')}
                disabled={actionLoading}
                className="py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Package className="w-4 h-4" /> Xác nhận hoàn về kho
              </button>
            )}

            {['PENDING_PAYMENT', 'CONFIRMED', 'PACKING'].includes(o.orderStatus) && (
              <button
                onClick={cancel}
                disabled={actionLoading}
                className="py-2 px-4 bg-white border border-red-300 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" /> Hủy đơn hàng
              </button>
            )}
          </div>

          {pack && (
            <div
              className={`mt-4 p-3 rounded-lg border text-xs ${pack.complete ? 'bg-green-50 border-green-200 text-green-800' : 'bg-yellow-50 border-yellow-200 text-yellow-800'}`}
            >
              <div className="font-semibold flex items-center gap-1 mb-1">
                {pack.complete ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-yellow-600" />}
                {pack.complete ? 'Đủ hàng' : 'Chưa khớp hàng'}
              </div>
              <p className="text-gray-600">{pack.lines?.map((l) => `${l.isbn}: ${l.scanned}/${l.expected}`).join(', ')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
