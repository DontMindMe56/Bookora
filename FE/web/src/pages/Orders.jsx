import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, vnd } from '../api';

export default function Orders() {
  const [d, setD] = useState(null);
  useEffect(() => void api('/api/orders').then(setD), []);
  if (!d) return <p className="mut">Đang tải…</p>;
  return (
    <>
      <h2>Đơn hàng của tôi</h2>
      {!d.items.length && <p className="mut">Chưa có đơn hàng.</p>}
      {d.items.map((o) => (
        <Link key={o.orderId} to={`/orders/${o.orderId}`} className="box line" style={{ display: 'flex' }}>
          <div className="g"><b>{o.orderCode}</b><div className="mut">{o.firstTitle} · {o.itemCount} sản phẩm · {o.paymentMethod}</div></div>
          <span className="mut">{o.paymentStatus} / {o.orderStatus}</span>
          <b>{vnd(o.totalAmount)}</b>
        </Link>
      ))}
    </>
  );
}
