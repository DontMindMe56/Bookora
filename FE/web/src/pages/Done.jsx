import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';
import { CheckCircle2, XCircle, Clock, QrCode, ShoppingBag, FileText, Loader2, ShieldCheck } from 'lucide-react';

const PAY = {
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
  COD_COLLECTED: 'Đã thu COD',
  FAILED: 'Thất bại',
  EXPIRED: 'Hết hạn',
  REFUND_PENDING: 'Chờ hoàn tiền',
  REFUNDED: 'Đã hoàn tiền',
};

export default function Done() {
  const { id } = useParams();
  const [o, setO] = useState(null);
  const [pay, setPay] = useState(null);
  const was = useRef(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const d = await api('/api/orders/' + id);
        if (stop) return;
        if (was.current === 'PENDING_PAYMENT' && d.orderStatus !== 'PENDING_PAYMENT') {
          if (d.orderStatus === 'CONFIRMED' || d.orderStatus === 'COMPLETED') {
            toast.success('Thanh toán thành công!');
          } else {
            toast.error('Đơn hàng không còn chờ thanh toán');
          }
        }
        was.current = d.orderStatus;
        setO(d);
        if (d.paymentMethod === 'SEPAY' && d.orderStatus === 'PENDING_PAYMENT') {
          api(`/api/orders/${id}/payment`).then(
            (p) => !stop && setPay(p),
            () => {},
          );
        } else {
          setPay(null);
          return;
        }
      } catch {}
      if (!stop) setTimeout(tick, 3000);
    };
    tick();
    return () => void (stop = true);
  }, [id]);

  if (!o) {
    return (
      <div className="flex justify-center items-center py-24 text-gray-500 text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-blue-600" /> Đang tải thông tin đơn hàng…
      </div>
    );
  }

  const waiting = o.orderStatus === 'PENDING_PAYMENT';
  const closed = ['CANCELLED', 'EXPIRED'].includes(o.orderStatus);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* 1. Thanh tiến trình (Stepper) */}
      <div className="flex items-center justify-center gap-2 text-xs sm:text-sm font-medium text-gray-400 pb-2 border-b">
        <span>Giỏ hàng</span>
        <span>›</span>
        <span>Thanh toán</span>
        <span>›</span>
        <span className="text-blue-600 font-bold flex items-center gap-1">
          <CheckCircle2 className="w-4 h-4" /> Hoàn tất
        </span>
      </div>

      {/* 2. Khung trạng thái chính */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 sm:p-8 shadow-sm text-center space-y-6">
        {waiting ? (
          <div className="space-y-4">
            <div className="inline-flex p-3 bg-amber-50 rounded-full text-amber-600 border border-amber-100 animate-pulse">
              <Clock className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Đang chờ thanh toán</h2>
              <p className="text-sm text-gray-600">
                Mã đơn: <span className="font-bold text-gray-900">#{o.orderCode}</span> · Tổng tiền:{' '}
                <span className="font-bold text-red-600">{vnd(o.totalAmount)}</span>
              </p>
            </div>

            {pay && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4 max-w-md mx-auto">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-700">
                    Quét mã QR để chuyển khoản chính xác số tiền: <strong className="text-red-600">{vnd(pay.amount)}</strong>
                  </p>
                  <p className="text-xs text-gray-500">
                    Nội dung chuyển khoản bắt buộc:{' '}
                    <span className="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{pay.content}</span>
                  </p>
                </div>

                <div className="bg-white p-3 inline-block rounded-xl border border-gray-200 shadow-sm">
                  <img src={pay.qrUrl} alt="QR Code thanh toán" className="w-56 h-56 object-contain mx-auto" />
                </div>

                <div className="text-xs text-gray-600 space-y-1 bg-white p-3 rounded-lg border border-gray-100 text-left">
                  <p className="font-medium text-gray-800">{pay.bank}</p>
                  <p>
                    Số tài khoản: <span className="font-mono font-bold">{pay.accountNo}</span>
                  </p>
                  <p>
                    Chủ tài khoản: <span className="uppercase font-bold">{pay.accountName}</span>
                  </p>
                </div>

                <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
                  ⚠️ Vui lòng không đóng trang này. Hệ thống sẽ tự động cập nhật khi nhận được tiền.
                </p>
              </div>
            )}
          </div>
        ) : closed ? (
          <div className="space-y-4">
            <div className="inline-flex p-3 bg-red-50 rounded-full text-red-600 border border-red-100">
              <XCircle className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Đơn hàng đã {o.orderStatus === 'EXPIRED' ? 'hết hạn thanh toán' : 'bị hủy'}</h2>
              <p className="text-sm text-gray-600">
                Mã đơn: <span className="font-bold text-gray-900">#{o.orderCode}</span>. Nếu bạn đã chuyển khoản, hệ thống sẽ tiến hành kiểm tra và hoàn lại
                tiền theo quy định.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="inline-flex p-3 bg-green-50 rounded-full text-green-600 border border-green-100">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{o.paymentMethod === 'COD' ? 'Đặt hàng thành công!' : 'Thanh toán thành công!'}</h2>
              <p className="text-sm text-gray-600">
                Mã đơn: <span className="font-bold text-gray-900">#{o.orderCode}</span> · Tổng tiền:{' '}
                <span className="font-bold text-red-600">{vnd(o.totalAmount)}</span>
              </p>
            </div>
            <div className="inline-block bg-green-50 border border-green-200 text-green-800 text-xs font-semibold px-3 py-1 rounded-full">
              {PAY[o.paymentStatus] || o.paymentStatus} {o.paymentMethod === 'COD' && '· Thanh toán khi nhận hàng (COD)'}
            </div>
            <p className="text-xs text-gray-500">Cảm ơn bạn đã mua hàng. Vui lòng không quét mã hoặc chuyển khoản thêm cho đơn hàng này.</p>
          </div>
        )}

        {/* Các nút hành động điều hướng */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4 border-t border-gray-100">
          <Link
            to="/"
            className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            <ShoppingBag className="w-5 h-5" />
            <span>Tiếp tục mua sắm</span>
          </Link>
          <Link
            to="/orders"
            className="w-full sm:w-auto px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            <FileText className="w-5 h-5" />
            <span>Xem đơn hàng</span>
          </Link>
        </div>
      </div>

      {/* 3. Chi tiết danh sách sản phẩm trong đơn */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 border-b pb-2">Chi tiết sản phẩm đã đặt</h3>
        <div className="divide-y divide-gray-100">
          {o.items.map((i) => (
            <div className="flex items-center justify-between py-3 gap-4" key={i.editionId}>
              <div className="flex items-center gap-3">
                <div className="w-12 h-16 bg-gray-100 rounded border border-gray-200 overflow-hidden shrink-0">
                  <img src={i.coverImageUrl} alt={i.title} className="w-full h-full object-cover" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 line-clamp-1">{i.title}</h4>
                  <p className="text-xs text-gray-500">
                    Số lượng: <span className="font-medium text-gray-700">× {i.quantity}</span>
                  </p>
                </div>
              </div>
              <span className="text-sm font-bold text-red-600 shrink-0">{vnd(i.lineTotal)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
