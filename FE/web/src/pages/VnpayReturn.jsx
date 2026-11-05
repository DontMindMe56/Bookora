import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function VnpayReturn() {
  const [r, setR] = useState(null);
  useEffect(() => void api('/api/webhooks/vnpay/return' + location.search).then(setR, (e) => setR({ message: e.message })), []);
  if (!r) return <p className="mut">Đang xác nhận thanh toán…</p>;
  return (
    <div className="box center">
      <h2>{r.isVerified && r.isSuccess ? '✅ Thanh toán VNPay thành công' : '❌ Thanh toán chưa thành công'}</h2>
      {r.orderCode && <p>Mã đơn <b>{r.orderCode}</b> · {r.paymentStatus}</p>}
      {!r.isSuccess && <p className="mut">{r.message}</p>}
      <Link className="btn" to="/orders">Xem đơn hàng</Link>
    </div>
  );
}
