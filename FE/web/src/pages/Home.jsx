import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, vnd } from '../api';

export default function Home() {
  const [sp, setSp] = useSearchParams();
  const [cats, setCats] = useState([]);
  const [data, setData] = useState(null);
  const q = sp.get('q') || '',
    cat = sp.get('cat') || '',
    sort = sp.get('sort') || 'newest';
  const set = (k, v) => setSp((p) => (v ? p.set(k, v) : p.delete(k), p));

  useEffect(() => void api('/api/categories').then((c) => setCats(c.items || c)), []);
  useEffect(() => {
    const p = new URLSearchParams({ sort });
    q && p.set('q', q);
    cat && p.set('categoryId', cat);
    api('/api/books?' + p).then(setData);
  }, [q, cat, sort]);

  if (!data) return <p className="mut">Đang tải…</p>;
  const list = data.items.length ? data.items : data.suggestions || [];
  return (
    <>
      <div className="chips">
        <a className={'chip' + (cat ? '' : ' on')} href="#" onClick={(e) => (e.preventDefault(), set('cat', ''))}>Tất cả</a>
        {cats.map((c) => (
          <a key={c.categoryId} className={'chip' + (cat === c.categoryId ? ' on' : '')} href="#" onClick={(e) => (e.preventDefault(), set('cat', c.categoryId))}>{c.name}</a>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="mut">{data.total} cuốn {q && `cho “${q}”`}</span>
        <select value={sort} onChange={(e) => set('sort', e.target.value)}>
          <option value="newest">Mới nhất</option>
          <option value="bestseller">Bán chạy</option>
          <option value="price_asc">Giá tăng dần</option>
          <option value="price_desc">Giá giảm dần</option>
        </select>
      </div>
      <div className="grid">
        {list.map((b) => (
          <Link key={b.workId} to={`/book/${b.workId}`} className="card">
            <img className="cover" src={b.coverImageUrl} alt="" />
            <div className="in">
              <b>{b.title}</b>
              <div className="mut">{(b.authors || []).join(', ')}</div>
              <span className="pr">{vnd(b.price)}</span>
              {b.listPrice > b.price && <span className="old">{vnd(b.listPrice)}</span>}
              {!b.inStock && <div><span className="tag no">Hết hàng</span></div>}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
