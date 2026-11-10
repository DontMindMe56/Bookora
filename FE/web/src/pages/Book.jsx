import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api, vnd } from '../api';
import { useStore } from '../store';
import { ShoppingCart, Zap, CheckCircle2, AlertCircle, BookOpen, Layers } from 'lucide-react';

export default function Book() {
  const { id } = useParams();
  const nav = useNavigate();
  const refreshCart = useStore((s) => s.refreshCart);
  const [b, setB] = useState(null);
  const [ed, setEd] = useState(0);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/books/' + id).then((d) => {
      setB(d);
      setEd(0);
    });
  }, [id]);

  if (!b) {
    return <div className="flex justify-center items-center py-24 text-gray-500 text-sm">Đang tải thông tin sách…</div>;
  }

  const e = b.editions[ed] || {};

  const add = async (go) => {
    setLoading(true);
    try {
      await api('/api/cart/items', {
        method: 'POST',
        body: { editionId: e.editionId, quantity: Number(qty) },
      });
      await refreshCart();
      if (go) {
        nav('/cart');
      } else {
        toast.success('Đã thêm sản phẩm vào giỏ hàng');
      }
    } catch (x) {
      toast.error(x.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 shadow-sm grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        {/* Cột trái: Ảnh bìa sách */}
        <div className="md:col-span-5 lg:col-span-4">
          <div className="relative aspect-3/4 rounded-lg overflow-hidden border border-gray-200 shadow-md bg-gray-50">
            <img className="w-full h-full object-cover" src={e.coverImageUrl || b.coverImageUrl} alt={b.title} />
          </div>
        </div>

        {/* Cột phải: Thông tin chi tiết sản phẩm */}
        <div className="md:col-span-7 lg:col-span-8 space-y-6">
          {/* Tiêu đề và tác giả */}
          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">{b.title}</h1>
            <div className="text-sm text-gray-500 flex flex-wrap items-center gap-1.5 font-medium">
              <span className="text-gray-700">Tác giả:</span>
              <span>{(b.authors || []).map((a) => a.name).join(', ')}</span>
              <span className="mx-1 text-gray-300">•</span>
              <span className="text-gray-700">Thể loại:</span>
              <span>{(b.categories || []).map((c) => c.name).join(', ')}</span>
            </div>
          </div>

          {/* Chọn phiên bản (Edition) */}
          {b.editions && b.editions.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider block">Chọn phiên bản định dạng</label>
              <select
                value={ed}
                onChange={(x) => setEd(+x.target.value)}
                className="w-full md:w-auto bg-white border border-gray-300 text-gray-800 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              >
                {b.editions.map((x, i) => (
                  <option key={x.editionId} value={i}>
                    {x.format} — {x.publisherName} ({vnd(x.price)})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Giá tiền */}
          <div className="flex items-baseline gap-3 pt-2">
            <span className="text-3xl font-bold text-red-600">{vnd(e.price)}</span>
            {e.listPrice > e.price && <span className="text-base text-gray-400 line-through">{vnd(e.listPrice)}</span>}
          </div>

          {/* Trạng thái tồn kho */}
          <div>
            {e.inStock ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                <CheckCircle2 className="w-4 h-4" /> Còn hàng
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                <AlertCircle className="w-4 h-4" /> Hết hàng
              </span>
            )}
          </div>

          {/* Nhập số lượng và nút hành động */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="w-24">
              <input
                type="number"
                min="1"
                value={qty}
                onChange={(ev) => setQty(Math.max(1, parseInt(ev.target.value) || 1))}
                className="w-full text-center border border-gray-300 rounded-lg py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            <button
              disabled={!e.canBuy || loading}
              onClick={() => add(false)}
              className="flex-1 min-w-40 px-5 py-2.5 bg-primary disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-5 h-5" />
              <span>Thêm vào giỏ</span>
            </button>

            <button
              disabled={!e.canBuy || loading}
              onClick={() => add(true)}
              className="flex-1 min-w-35 px-5 py-2.5 bg-primary disabled:bg-gray-300 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" />
              <span>Mua ngay</span>
            </button>
          </div>

          {/* Phần giới thiệu / mô tả */}
          <div className="pt-6 border-t border-gray-100 space-y-2">
            <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-blue-600" /> Giới thiệu sách
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{b.description || 'Chưa có mô tả chi tiết cho tựa sách này.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
