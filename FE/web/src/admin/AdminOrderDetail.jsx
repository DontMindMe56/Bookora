import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';

export default function AdminOrderDetail() {
  const { id } = useParams();
  const [o, setO] = useState(null);
  const [pack, setPack] = useState(null);
  const load = () => api('/api/staff/orders/' + id).then(setO, (e) => toast.error(e.message));
  useEffect(() => void load(), [id]);

  const act = (path, body, ok) =>
    api(`/api/staff/orders/${id}/${path}`, { method: 'POST', body }).then((r) => (toast.success(ok), load(), r), (e) => toast.error(e.message));

  const doPack = async () => setPack(await act('packing', { isbns: o.items.flatMap((i) => Array(i.quantity).fill(i.isbn)) }, 'Đã quét đóng gói'));
  const cancel = () => {
    const reason = prompt('Lý do hủy đơn (tối thiểu 3 ký tự):');
    reason && act('cancel', { reason }, 'Đã hủy đơn');
  };

  if (!o) return <p className="mut">Đang tải…</p>;
  const a = o.shippingAddressSnapshot || {};
  const packable = ['CONFIRMED', 'PACKING'].includes(o.orderStatus);
  return (
    <>
      <Link to="/admin" className="mut">‹ Danh sách đơn</Link>
      <h2>Đơn {o.orderCode}</h2>
      <div className="two">
        <div>
          <div className="box">
            {o.items.map((i) => (
              <div className="line" key={i.editionId}>
                <img src={i.coverImageUrl} alt="" />
                <div className="g"><b>{i.title}</b><div className="mut">ISBN {i.isbn} · {vnd(i.unitPrice)} × {i.quantity}</div></div>
                <b>{vnd(i.lineTotal)}</b>
              </div>
            ))}
            <div className="sum big"><span>Tổng</span><span>{vnd(o.totalAmount)}</span></div>
          </div>
          <div className="box">
            <b>Vận đơn</b>
            {!o.shipments.length && <p className="mut">Chưa có vận đơn.</p>}
            {o.shipments.map((s, k) => <div key={k}>{s.direction} · {s.status} · {s.ghnOrderCode || '—'}</div>)}
          </div>
        </div>
        <div>
          <div className="box">
            <b>Trạng thái</b>
            <div className="sum"><span>Đơn</span><span>{o.orderStatus}</span></div>
            <div className="sum"><span>Thanh toán</span><span>{o.paymentStatus} ({o.paymentMethod})</span></div>
            <div className="sum"><span>Vận chuyển</span><span>{o.shippingStatus}</span></div>
          </div>
          <div className="box">
            <b>Người nhận</b>
            <div>{a.receiverName} · {a.phone}</div>
            <div className="mut">{[a.detail, a.ward, a.district, a.province].filter(Boolean).join(', ')}</div>
            {o.note && <p className="mut">Ghi chú: {o.note}</p>}
          </div>
          <div className="box">
            <b>Xử lý</b>
            <div className="row">
              {packable && <button onClick={doPack}>Quét đóng gói</button>}
              {packable && <button onClick={() => act('shipment', undefined, 'Đã tạo vận đơn')}>Tạo vận đơn GHN</button>}
              {o.orderStatus === 'RETURNED' && <button onClick={() => act('returned-received', undefined, 'Đã nhập kho hàng hoàn')}>Xác nhận hoàn về kho</button>}
              {['PENDING_PAYMENT', 'CONFIRMED', 'PACKING'].includes(o.orderStatus) && <button className="ghost" onClick={cancel}>Hủy đơn</button>}
            </div>
            {pack && <p className="mut">{pack.complete ? '✅ Đủ hàng' : '⚠️ Chưa khớp'} · {pack.lines.map((l) => `${l.isbn}: ${l.scanned}/${l.expected}`).join(', ')}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
