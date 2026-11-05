import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';
import AddressForm from './AddressForm';

const PM = { COD: 'Thanh toán khi nhận hàng (COD)', SEPAY: 'Chuyển khoản QR (SePay)', VNPAY: 'VNPay' };
const HIDE = ['VNPAY'];
const show = (r) => ({ ...r, paymentMethods: r.paymentMethods.filter((m) => !HIDE.includes(m.method)) });

export default function Checkout() {
  const nav = useNavigate();
  const key = useRef('bk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
  const [addrs, setAddrs] = useState(null);
  const [addr, setAddr] = useState('');
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState(null);
  const [pm, setPm] = useState('');
  const [busy, setBusy] = useState(false);

  const loadAddrs = () =>
    api('/api/addresses').then((r) => {
      setAddrs(r.items);
      setAddr((a) => (r.items.some((x) => x.addressId === a) ? a : r.items[0]?.addressId || ''));
      setAdding(false);
    });
  useEffect(() => void loadAddrs(), []);

  useEffect(() => {
    if (!addr) return;
    setQ(null);
    api('/api/checkout/quote', { method: 'POST', body: { addressId: addr, ...(applied && { discountCode: applied }) } }).then(
      (r) => ((r = show(r)), setQ(r), setPm((p) => (r.paymentMethods.some((m) => m.method === p && m.available) ? p : r.paymentMethods.find((m) => m.available)?.method || ''))),
      (e) => toast.error(e.message),
    );
  }, [addr, applied]);

  const place = async () => {
    setBusy(true);
    try {
      const o = await api('/api/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': key.current },
        body: { addressId: addr, paymentMethod: pm, expectedTotal: q.total, ...(applied && { discountCode: applied }), ...(note.trim() && { note: note.trim() }) },
      });
      if (pm === 'VNPAY') {
        const p = await api(`/api/orders/${o.orderId}/vnpay`, { method: 'POST' });
        location.href = p.paymentUrl;
        return;
      }
      nav(`/orders/${o.orderId}`, { replace: true });
    } catch (e) {
      if (e.code === 'QUOTE_CHANGED' && e.details?.quote) {
        setQ(show(e.details.quote));
        toast('Giá vừa thay đổi, vui lòng kiểm tra lại');
      } else toast.error(e.message);
      setBusy(false);
    }
  };

  if (!addrs) return <p className="mut">Đang tải…</p>;
  return (
    <>
      <div className="steps"><span>1. Giỏ hàng</span>›<b>2. Thanh toán</b>›<span>3. Hoàn tất</span></div>
      <div className="two">
        <div>
          <div className="box">
            <b>Địa chỉ nhận hàng</b>
            {addrs.map((a) => (
              <label className="pm" key={a.addressId}>
                <input type="radio" checked={addr === a.addressId} onChange={() => setAddr(a.addressId)} />
                <span>{a.receiverName} · {a.phone}<small>{[a.detail, a.ward, a.district, a.province].filter(Boolean).join(', ')}</small></span>
              </label>
            ))}
            <button className="ghost" onClick={() => setAdding(!adding)}>+ Thêm địa chỉ mới</button>
          </div>
          {(adding || !addrs.length) && <AddressForm onSaved={loadAddrs} />}
          <div className="box">
            <b>Mã giảm giá</b>
            <div className="row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Nhập mã" />
              <button className="ghost" onClick={() => setApplied(code.trim())}>Áp dụng</button>
            </div>
          </div>
          <div className="box">
            <b>Ghi chú</b>
            <textarea rows="2" style={{ width: '100%' }} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="box">
          {!addr ? <span className="mut">Hãy thêm địa chỉ để xem giá</span> : !q ? <span className="mut">Đang tính giá…</span> : (
            <>
              <b>Đơn hàng</b>
              {q.items.map((i, k) => <div className="sum" key={k}><span>{i.title || i.name} × {i.quantity}</span><span>{vnd(i.lineTotal ?? i.unitPrice * i.quantity)}</span></div>)}
              <div className="sum"><span>Tạm tính</span><span>{vnd(q.subtotal)}</span></div>
              {!!q.discountAmount && <div className="sum"><span>Giảm giá</span><span>-{vnd(q.discountAmount)}</span></div>}
              <div className="sum"><span>Phí vận chuyển</span><span>{q.shippingFee ? vnd(q.shippingFee) : 'Miễn phí'}</span></div>
              <div className="sum big"><span>Tổng</span><span>{vnd(q.total)}</span></div>
              <p><b>Phương thức thanh toán</b></p>
              {q.paymentMethods.map((m) => (
                <label className="pm" key={m.method}>
                  <input type="radio" disabled={!m.available} checked={pm === m.method} onChange={() => setPm(m.method)} />
                  <span>{PM[m.method]}{!m.available && <small>{m.reason || 'Chưa khả dụng'}</small>}</span>
                </label>
              ))}
              <button disabled={!pm || busy} onClick={place} style={{ width: '100%', marginTop: 10 }}>Đặt hàng</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}