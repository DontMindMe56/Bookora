import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';
import { useStore } from '../store';

export default function Cart() {
  const [c, setC] = useState(null);
  const { token, refreshCart } = useStore();
  const nav = useNavigate();
  const load = () => api('/api/cart').then((d) => (setC(d), refreshCart()));
  useEffect(() => void load(), []);

  const setQty = (id, quantity) => api(`/api/cart/items/${id}`, { method: 'PATCH', body: { quantity: Math.min(10, Math.max(1, quantity || 1)) } }).then(load, (e) => toast.error(e.message));
  const del = (id) => api(`/api/cart/items/${id}`, { method: 'DELETE' }).then(load);

  if (!c) return <p className="mut">Đang tải…</p>;
  if (!c.items.length) return <><h2>Giỏ hàng</h2><p>Giỏ hàng đang trống. <Link to="/">Tiếp tục mua sắm</Link></p></>;
  return (
    <>
      <h2>Giỏ hàng</h2>
      <div className="box">
        {c.items.map((i) => (
          <div className="line" key={i.editionId}>
            <img src={i.coverImageUrl} alt="" />
            <div className="g">
              <Link to={`/book/${i.workId}`}><b>{i.title}</b></Link>
              <div className="mut">{i.format}</div>
              {i.issues?.map((x) => <div key={x.message} className="mut" style={{ color: '#b4442f' }}>{x.message}</div>)}
            </div>
            <input type="number" min="1" max="10" defaultValue={i.quantity} style={{ width: 64 }} onBlur={(e) => setQty(i.editionId, +e.target.value)} />
            <b style={{ minWidth: 100, textAlign: 'right' }}>{vnd(i.lineTotal)}</b>
            <button className="ghost" onClick={() => del(i.editionId)}>Xóa</button>
          </div>
        ))}
        <div className="sum big"><span>Tạm tính</span><span>{vnd(c.subtotal)}</span></div>
      </div>
      <button onClick={() => nav(token ? '/checkout' : '/login', { state: { from: '/checkout' } })}>Tiến hành đặt hàng</button>
    </>
  );
}
