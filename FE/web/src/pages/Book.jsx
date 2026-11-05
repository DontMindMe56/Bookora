import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';
import { useStore } from '../store';

export default function Book() {
  const { id } = useParams();
  const nav = useNavigate();
  const refreshCart = useStore((s) => s.refreshCart);
  const [b, setB] = useState(null);
  const [ed, setEd] = useState(0);
  const [qty, setQty] = useState(1);

  useEffect(() => void api('/api/books/' + id).then((d) => (setB(d), setEd(0))), [id]);
  if (!b) return <p className="mut">Đang tải…</p>;
  const e = b.editions[ed];

  const add = async (go) => {
    try {
      await api('/api/cart/items', { method: 'POST', body: { editionId: e.editionId, quantity: qty } });
      await refreshCart();
      go ? nav('/cart') : toast.success('Đã thêm vào giỏ');
    } catch (x) {
      toast.error(x.message);
    }
  };

  return (
    <div className="det">
      <img className="cover" src={e.coverImageUrl} alt="" />
      <div>
        <h1 style={{ margin: 0 }}>{b.title}</h1>
        <div className="mut">{b.authors.map((a) => a.name).join(', ')} · {b.categories.map((c) => c.name).join(', ')}</div>
        <div className="row">
          <select value={ed} onChange={(x) => setEd(+x.target.value)}>
            {b.editions.map((x, i) => <option key={x.editionId} value={i}>{x.format} · {x.publisherName}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 24 }}>
          <span className="pr">{vnd(e.price)}</span>
          {e.listPrice > e.price && <span className="old">{vnd(e.listPrice)}</span>}
        </div>
        <span className={'tag' + (e.inStock ? '' : ' no')}>{e.inStock ? 'Còn hàng' : 'Hết hàng'}</span>
        <div className="row">
          <input type="number" min="1" max="10" value={qty} onChange={(x) => setQty(Math.min(10, Math.max(1, +x.target.value || 1)))} style={{ width: 70 }} />
          <button disabled={!e.canBuy} onClick={() => add(false)}>Thêm vào giỏ</button>
          <button className="ghost" disabled={!e.canBuy} onClick={() => add(true)}>Mua ngay</button>
        </div>
        <h3>Giới thiệu</h3>
        <p>{b.description || 'Chưa có mô tả.'}</p>
      </div>
    </div>
  );
}
