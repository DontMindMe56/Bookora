import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';

const PAY = { UNPAID: 'Chưa thanh toán', PAID: 'Đã thanh toán', COD_COLLECTED: 'Đã thu COD', FAILED: 'Thất bại', EXPIRED: 'Hết hạn', REFUND_PENDING: 'Chờ hoàn tiền', REFUNDED: 'Đã hoàn tiền' };

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
          d.orderStatus === 'CONFIRMED' ? toast.success('Thanh toán thành công!') : toast.error('Đơn hàng không còn chờ thanh toán');
        }
        was.current = d.orderStatus;
        setO(d);
        if (d.paymentMethod === 'SEPAY' && d.orderStatus === 'PENDING_PAYMENT') {
          api(`/api/orders/${id}/payment`).then((p) => !stop && setPay(p), () => {});
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

  if (!o) return <p className="mut">Đang tải…</p>;
  const waiting = o.orderStatus === 'PENDING_PAYMENT';
  const closed = ['CANCELLED', 'EXPIRED'].includes(o.orderStatus);
  return (
    <>
      <div className="steps"><span>1. Giỏ hàng</span>›<span>2. Thanh toán</span>›<b>3. Hoàn tất</b></div>
      <div className="box center">
        {waiting ? (
          <>
            <h2>⏳ Đang chờ thanh toán</h2>
            <p>Mã đơn <b>{o.orderCode}</b> · Tổng <b>{vnd(o.totalAmount)}</b></p>
            {pay && (
              <>
                <p>Quét mã chuyển khoản <b>{vnd(pay.amount)}</b> · nội dung <b>{pay.content}</b></p>
                <img src={pay.qrUrl} alt="QR" style={{ maxWidth: 260 }} />
                <p className="mut">{pay.bank} · {pay.accountNo} · {pay.accountName}</p>
                <p className="mut">Không đóng trang này. Hệ thống sẽ tự chuyển khi nhận được tiền.</p>
              </>
            )}
          </>
        ) : closed ? (
          <>
            <h2>❌ Đơn hàng đã {o.orderStatus === 'EXPIRED' ? 'hết hạn thanh toán' : 'bị hủy'}</h2>
            <p>Mã đơn <b>{o.orderCode}</b>. Nếu bạn đã chuyển tiền, hệ thống sẽ hoàn lại.</p>
          </>
        ) : (
          <>
            <h2>✅ {o.paymentMethod === 'COD' ? 'Đặt hàng thành công' : 'Thanh toán thành công'}</h2>
            <p>Mã đơn <b>{o.orderCode}</b> · Tổng <b>{vnd(o.totalAmount)}</b></p>
            <p className="mut">{PAY[o.paymentStatus] || o.paymentStatus}{o.paymentMethod === 'COD' && ' · thanh toán khi nhận hàng'}</p>
            <p>Vui lòng không quét hoặc chuyển khoản thêm cho đơn này.</p>
          </>
        )}
        <Link className="btn" to="/">Tiếp tục mua sắm</Link> <Link className="btn ghost" to="/orders">Xem đơn hàng</Link>
      </div>
      <div className="box">
        {o.items.map((i) => (
          <div className="line" key={i.editionId}>
            <img src={i.coverImageUrl} alt="" />
            <div className="g"><b>{i.title}</b><div className="mut">× {i.quantity}</div></div>
            <b>{vnd(i.lineTotal)}</b>
          </div>
        ))}
      </div>
    </>
  );
}