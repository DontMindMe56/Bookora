import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, vnd } from '../api';

export default function Home() {
  const [sp, setSp] = useSearchParams();
  const [cats, setCats] = useState([]);
  const [data, setData] = useState(null);

  // Lấy các tham số từ URL
  const q = sp.get('q') || '',
    authorQuery = sp.get('author') || '',
    cat = sp.get('cat') || '',
    sort = sp.get('sort') || 'newest';

  // State cục bộ cho 2 ô input
  const [keywordInput, setKeywordInput] = useState(q);
  const [authorInput, setAuthorInput] = useState(authorQuery);

  // State cho danh sách gợi ý xổ xuống
  const [keywordSuggestions, setKeywordSuggestions] = useState([]);
  const [authorSuggestions, setAuthorSuggestions] = useState([]);
  const [showKeywordDrop, setShowKeywordDrop] = useState(false);
  const [showAuthorDrop, setShowAuthorDrop] = useState(false);

  // Ref để ẩn popup khi click ra ngoài
  const keywordRef = useRef(null);
  const authorRef = useRef(null);

  const setParam = (k, v) => setSp((p) => (v ? p.set(k, v) : p.delete(k), p));

  // Đồng bộ lại input khi URL thay đổi từ bên ngoài
  useEffect(() => {
    setKeywordInput(q);
    setAuthorInput(authorQuery);
  }, [q, authorQuery]);

  // Click ra ngoài thì ẩn dropdown gợi ý
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (keywordRef.current && !keywordRef.current.contains(e.target)) setShowKeywordDrop(false);
      if (authorRef.current && !authorRef.current.contains(e.target)) setShowAuthorDrop(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Lấy danh sách thể loại ban đầu
  useEffect(() => {
    api('/api/categories').then((c) => setCats(c.items || c));
  }, []);

  // Gọi API lấy dữ liệu sách theo các query trên URL
  useEffect(() => {
    const p = new URLSearchParams({ sort });
    q && p.set('q', q);
    authorQuery && p.set('author', authorQuery);
    cat && p.set('categoryId', cat);
    api('/api/books?' + p).then(setData);
  }, [q, authorQuery, cat, sort]);

  // --- LOGIC 1 & 2: GỢI Ý TÊN SÁCH (Phụ thuộc vào từ khóa đang nhập VÀ Tác giả đang chọn) ---
  useEffect(() => {
    if (!keywordInput.trim()) {
      setKeywordSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ q: keywordInput, limit: '5' });
      // Nếu ô tác giả đã có giá trị, ràng buộc chỉ tìm sách của tác giả đó
      if (authorInput.trim()) {
        p.set('author', authorInput.trim());
      }
      api(`/api/books?${p}`)
        .then((res) => setKeywordSuggestions(res.items || res.suggestions || []))
        .catch(() => setKeywordSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [keywordInput, authorInput]);

  // --- LOGIC 1 & 3: GỢI Ý TÁC GIẢ (Phụ thuộc vào tên tác giả đang nhập VÀ Tên sách đang chọn) ---
  useEffect(() => {
    if (!authorInput.trim()) {
      setAuthorSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const p = new URLSearchParams({ limit: '20' }); // Lấy rộng hơn chút để trích xuất tác giả
      if (keywordInput.trim()) {
        p.set('q', keywordInput.trim());
      }
      api(`/api/books?${p}`)
        .then((res) => {
          const items = res.items || res.suggestions || [];
          // Gom tất cả tác giả từ các cuốn sách tìm được, sau đó lọc theo chữ cái người dùng đang gõ ở ô tác giả
          const allAuthors = [...new Set(items.flatMap((b) => b.authors || []))];
          const filtered = allAuthors.filter((name) => name.toLowerCase().includes(authorInput.toLowerCase())).slice(0, 5); // Lấy tối đa 5 gợi ý
          setAuthorSuggestions(filtered);
        })
        .catch(() => setAuthorSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [authorInput, keywordInput]);

  // Khi bấm nút Tìm kiếm hoặc nhấn Enter
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSp((p) => {
      keywordInput ? p.set('q', keywordInput) : p.delete('q');
      authorInput ? p.set('author', authorInput) : p.delete('author');
      return p;
    });
    setShowKeywordDrop(false);
    setShowAuthorDrop(false);
  };

  if (!data) {
    return <div className="flex justify-center items-center py-20 text-gray-500 text-sm">Đang tải…</div>;
  }

  const list = data.items?.length ? data.items : data.suggestions || [];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* THANH TÌM KIẾM GỒM 2 INPUT VÀ 1 NÚT TRÊN CÙNG MỘT HÀNG NGANG */}
      <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row items-center gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        {/* Input 1: Tìm theo tên sách */}
        <div className="relative flex-1 w-full" ref={keywordRef}>
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={keywordInput}
            onChange={(e) => {
              setKeywordInput(e.target.value);
              setShowKeywordDrop(true);
            }}
            onFocus={() => setShowKeywordDrop(true)}
            placeholder="Nhập tên sách, từ khóa..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          {/* Dropdown gợi ý Tên sách (Chỉ hiện đúng tên sách, gọn gàng) */}
          {showKeywordDrop && keywordSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
              {keywordSuggestions.map((item) => (
                <div
                  key={item.workId || item.id}
                  onClick={() => {
                    setKeywordInput(item.title);
                    setSp((p) => {
                      p.set('q', item.title);
                      return p;
                    });
                    setShowKeywordDrop(false);
                  }}
                  className="px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 cursor-pointer border-b border-gray-50 last:border-none"
                >
                  <span className="font-medium line-clamp-1">{item.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Input 2: Tìm theo tác giả */}
        <div className="relative flex-1 w-full" ref={authorRef}>
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <input
            type="text"
            value={authorInput}
            onChange={(e) => {
              setAuthorInput(e.target.value);
              setShowAuthorDrop(true);
            }}
            onFocus={() => setShowAuthorDrop(true)}
            placeholder="Tên tác giả..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          {/* Dropdown gợi ý Tác giả */}
          {showAuthorDrop && authorSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
              {authorSuggestions.map((authorName, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setAuthorInput(authorName);
                    setSp((p) => {
                      p.set('author', authorName);
                      return p;
                    });
                    setShowAuthorDrop(false);
                  }}
                  className="px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 cursor-pointer border-b border-gray-50 last:border-none"
                >
                  {authorName}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Nút Tìm kiếm */}
        <button
          type="submit"
          className="w-full md:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors shadow-sm whitespace-nowrap flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Tìm kiếm
        </button>
      </form>

      {/* Danh sách thể loại dạng thanh Chips cuộn ngang */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <a
          href="#"
          onClick={(e) => (e.preventDefault(), setParam('cat', ''))}
          className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
            !cat ? 'bg-primary text-white shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
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
              onClick={(e) => (e.preventDefault(), setParam('cat', c.categoryId))}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors border ${
                isActive ? 'bg-primary text-white shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
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
          {authorQuery && <span className="text-purple-600 font-medium"> của tác giả “{authorQuery}”</span>}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 uppercase font-semibold">Sắp xếp:</span>
          <select
            value={sort}
            onChange={(e) => setParam('sort', e.target.value)}
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
