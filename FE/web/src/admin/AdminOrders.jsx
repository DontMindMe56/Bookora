import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, vnd } from '../api';

const ORDER = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RETURNED', 'RETURNED_TO_WAREHOUSE'];
const PAY = ['UNPAID', 'PAID', 'COD_COLLECTED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED'];
const SHIP = ['NOT_CREATED', 'WAITING_PICKUP', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETURNING', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED'];

export default function AdminOrders() {
  const [f, setF] = useState({ q: '', status: '', paymentStatus: '', shippingStatus: '' });
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const set = (k, v) => (setF((x) => ({ ...x, [k]: v })), setPage(1));

  useEffect(() => {
    const p = new URLSearchParams({ page, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    api('/api/staff/orders?' + p).then(setD, () => setD({ items: [], total: 0, totalPages: 1 }));
  }, [f, page]);

  const sel = (k, list, label) => (
    <select value={f[k]} onChange={(e) => set(k, e.target.value)}>
      <option value="">{label}</option>
      {list.map((x) => <option key={x}>{x}</option>)}
    </select>
  );

  return (
    <>
      <div className="row">
        <input placeholder="Mã đơn, SĐT, tên, mã vận đơn…" value={f.q} onChange={(e) => set('q', e.target.value)} style={{ minWidth: 260 }} />
        {sel('status', ORDER, 'Trạng thái đơn')}
        {sel('paymentStatus', PAY, 'Thanh toán')}
        {sel('shippingStatus', SHIP, 'Vận chuyển')}
      </div>
      {!d ? <p className="mut">Đang tải…</p> : (
        <div className="box" style={{ overflowX: 'auto' }}>
          <table width="100%" cellPadding="6" style={{ borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead><tr><th>Mã đơn</th><th>Người nhận</th><th>Tổng</th><th>PT</th><th>Đơn</th><th>Thanh toán</th><th>Vận chuyển</th><th>Ngày</th></tr></thead>
            <tbody>
              {d.items.map((o) => (
                <tr key={o.orderId} style={{ borderTop: '1px solid #eee' }}>
                  <td><Link to={`/admin/orders/${o.orderId}`} style={{ color: '#b4442f' }}><b>{o.orderCode}</b></Link></td>
                  <td>{o.receiverName}<div className="mut">{o.receiverPhone}</div></td>
                  <td>{vnd(o.totalAmount)}</td>
                  <td>{o.paymentMethod}</td>
                  <td>{o.orderStatus}</td>
                  <td>{o.paymentStatus}</td>
                  <td>{o.shippingStatus}</td>
                  <td className="mut">{new Date(o.createdAt).toLocaleString('vi-VN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.items.length && <p className="mut">Không có đơn nào.</p>}
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
            <span>Trang {page}/{d.totalPages || 1} · {d.total} đơn</span>
            <button className="ghost" disabled={page >= (d.totalPages || 1)} onClick={() => setPage(page + 1)}>›</button>
          </div>
        </div>
      )}
    </>
  );
}
