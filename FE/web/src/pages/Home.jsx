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

  useEffect(() => {
    api('/api/categories').then((c) => setCats(c.items || c));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams({ sort });
    q && p.set('q', q);
    cat && p.set('categoryId', cat);
    api('/api/books?' + p).then(setData);
  }, [q, cat, sort]);

  if (!data) {
    return <div className="flex justify-center items-center py-20 text-gray-500 text-sm">Đang tải…</div>;
  }

  const list = data.items?.length ? data.items : data.suggestions || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Danh sách thể loại dạng thanh Chips cuộn ngang */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <a
          href="#"
          onClick={(e) => (e.preventDefault(), set('cat', ''))}
          className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
            !cat ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
          }`}
        >
          Tất cả
        </a>
        {cats.map((c) => {
          const isActive = cat === c.categoryId;
          return (
            <a
              key={c.categoryId}
              href="#"
              onClick={(e) => (e.preventDefault(), set('cat', c.categoryId))}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
                isActive ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {c.name}
            </a>
          );
        })}
      </div>

      {/* Thanh thông tin số lượng kết quả và bộ lọc sắp xếp (Sort) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50 px-4 py-3 rounded-lg border border-gray-200">
        <span className="text-sm text-gray-600 font-medium">
          <span className="text-gray-900 font-bold">{data.total || list.length}</span> cuốn sách{' '}
          {q && <span className="text-blue-600 font-medium">cho “{q}”</span>}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 uppercase font-semibold">Sắp xếp:</span>
          <select
            value={sort}
            onChange={(e) => set('sort', e.target.value)}
            className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="newest">Mới nhất</option>
            <option value="bestseller">Bán chạy</option>
            <option value="price_asc">Giá tăng dần</option>
            <option value="price_desc">Giá giảm dần</option>
          </select>
        </div>
      </div>

      {/* Lưới hiển thị danh sách sản phẩm (Grid Books) */}
      {list.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200 text-gray-500">Không tìm thấy cuốn sách nào phù hợp.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {list.map((b) => (
            <Link
              key={b.workId}
              to={`/book/${b.workId}`}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col group"
            >
              {/* Khung ảnh bìa sách */}
              <div className="relative aspect-3/4 bg-gray-100 overflow-hidden">
                <img src={b.coverImageUrl} alt={b.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                {!b.inStock && (
                  <div className="absolute top-2 right-2">
                    <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-semibold rounded shadow">Hết hàng</span>
                  </div>
                )}
              </div>

              {/* Thông tin chi tiết sách */}
              <div className="p-3 flex flex-col flex-1 justify-between space-y-2">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-gray-800 line-clamp-2 group-hover:text-blue-600 transition-colors">{b.title}</h3>
                  <p className="text-xs text-gray-500 line-clamp-1">{(b.authors || []).join(', ')}</p>
                </div>

                <div className="flex items-baseline gap-2 pt-1 border-t border-gray-100">
                  <span className="text-sm font-bold text-red-600">{vnd(b.price)}</span>
                  {b.listPrice > b.price && <span className="text-xs text-gray-400 line-through">{vnd(b.listPrice)}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
