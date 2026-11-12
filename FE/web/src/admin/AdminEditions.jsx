import { useEffect, useRef, useState } from 'react';
import { BookOpen, Search, Plus, Edit, CheckCircle2, AlertCircle, Save, X, ChevronLeft, ChevronRight, ImageIcon, Upload, Trash } from 'lucide-react';
import { api, vnd } from '../api';
import toast from 'react-hot-toast';

export default function AdminEditions() {
  const [books, setBooks] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  // State cho Modal Thêm / Sửa sách
  const [showModal, setShowModal] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const fileInputRef = useRef(null);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    isbn: '',
    publisher: '',
    authors: '',
    categories: '',
    format: 'PAPERBACK',
    listPrice: '',
    salePrice: '',
    pageCount: '',
    weightGram: '',
    lengthMm: '',
    widthMm: '',
    heightMm: '',
    publishedYear: '',
    businessStatus: 'ON_SALE',
    description: '',
    coverImageUrl: '',
  });

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, q: searchQuery });
      const data = await api(`/api/books?${params}`);
      setBooks(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      toast.error(err.message || 'Không thể tải danh sách sách');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooks();
  }, [page, searchQuery]);

  const handleOpenCreate = () => {
    setEditingBook(null);
    setFormData({
      title: '',
      isbn: '',
      publisher: '',
      authors: '',
      categories: '',
      format: 'PAPERBACK',
      listPrice: '',
      salePrice: '',
      pageCount: '',
      weightGram: '',
      lengthMm: '',
      widthMm: '',
      heightMm: '',
      publishedYear: '',
      businessStatus: 'ON_SALE',
      description: '',
      coverImageUrl: '',
    });
    setShowModal(true);
  };

  // Mở modal sửa và đổ dữ liệu
  const handleOpenEdit = async (workId) => {
    try {
      const detail = await api(`/api/books/${workId}`);
      const edition = detail.editions?.[0] || {};

      setEditingBook({ workId, editionId: edition.editionId });
      setFormData({
        title: detail.title || '',
        isbn: edition.isbn || '',
        publisher: edition.publisherName || '',
        authors: (detail.authors || []).map((a) => a.name).join(', '),
        categories: (detail.categories || []).map((c) => c.name).join(', '),
        format: edition.format || 'PAPERBACK',
        listPrice: edition.listPrice || '',
        salePrice: edition.salePrice || '',
        pageCount: edition.pageCount || '',
        weightGram: edition.weightGram || '',
        lengthMm: edition.lengthMm || '',
        widthMm: edition.widthMm || '',
        heightMm: edition.heightMm || '',
        publishedYear: edition.publishedYear || '',
        businessStatus: edition.businessStatus || 'ON_SALE',
        description: detail.description || '',
        coverImageUrl: edition.coverImageUrl || detail.coverImageUrl || '',
      });
      setShowModal(true);
    } catch (err) {
      toast.error(err.message || 'Không thể tải thông tin chi tiết sách');
    }
  };

  const handleDelete = (workId) => {};

  // Hàm xử lý chọn và upload ảnh bìa
  const handleCoverFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast.error('Chỉ chấp nhận tệp ảnh định dạng JPG, PNG hoặc WebP');
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    setFormData((prev) => ({
      ...prev,
      coverImageUrl: previewUrl,
      coverFile: file,
    }));

    toast.success('Đã chọn ảnh bìa thành công');

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmitForm = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        title: formData.title,
        isbn: formData.isbn,
        publisher: formData.publisher,
        authors: formData.authors
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        categories: formData.categories
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        format: formData.format,
        listPrice: Number(formData.listPrice),
        salePrice: formData.salePrice ? Number(formData.salePrice) : null,
        pageCount: formData.pageCount ? Number(formData.pageCount) : null,
        weightGram: Number(formData.weightGram || 0),
        lengthMm: formData.lengthMm ? Number(formData.lengthMm) : null,
        widthMm: formData.widthMm ? Number(formData.widthMm) : null,
        heightMm: formData.heightMm ? Number(formData.heightMm) : null,
        publishedYear: formData.publishedYear ? Number(formData.publishedYear) : null,
        businessStatus: formData.businessStatus,
        description: formData.description,
      };

      let currentEditionId = editingBook?.editionId;

      if (currentEditionId) {
        // --- EDIT ---
        await api(`/api/admin/editions/${currentEditionId}/details`, {
          method: 'PATCH',
          body: { ...payload, reason: 'Cập nhật từ trang quản trị' },
        });
        toast.success('Cập nhật chi tiết sách thành công');
      } else {
        // --- CREATE ---
        const res = await api('/api/admin/editions', {
          method: 'POST',
          body: payload,
        });
        currentEditionId = res.editionId;
        toast.success('Thêm sách mới thành công');
      }

      // BƯỚC 2: Có chọn file ảnh mới trong form, tiến hành gọi API upload ảnh
      if (formData.coverFile && currentEditionId) {
        const coverFormData = new FormData();
        coverFormData.append('cover', formData.coverFile);

        try {
          await api(`/api/admin/editions/${currentEditionId}/cover`, {
            method: 'POST',
            body: coverFormData,
          });
          toast.success('Đã tải lên ảnh bìa thành công!');
        } catch (coverErr) {
          toast.error(coverErr.message || 'Lưu thông tin thành công nhưng tải ảnh bìa thất bại');
        }
      }

      setShowModal(false);
      fetchBooks();
    } catch (err) {
      toast.error(err.message || 'Thực hiện thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">Quản lý ấn bản</h1>
        </div>
        <button
          onClick={handleOpenCreate}
          className="px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg shadow-sm flex items-center justify-center gap-2 shrink-0"
        >
          <Plus className="w-5 h-5" />
          <span>Thêm mới</span>
        </button>
      </div>

      {/* Tìm kiếm */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Tìm kiếm theo tên, tác giả, nhà xuất bản..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm bg-gray-50 border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
          />
        </div>
      </div>

      {/* Bảng danh sách sách */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center items-center py-20 text-gray-500 text-sm">Đang tải dữ liệu…</div>
        ) : books.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">Không tìm thấy cuốn sách nào phù hợp.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold uppercase text-xs">
                  <th className="p-4">Sách</th>
                  <th className="p-4">Tác giả</th>
                  <th className="p-4">Định dạng</th>
                  <th className="p-4">Giá bán</th>
                  <th className="p-4">Tình trạng kho</th>
                  <th className="p-4 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {books.map((b) => (
                  <tr key={b.workId} className="hover:bg-gray-50/70 transition-colors">
                    <td className="p-4 flex items-center gap-3">
                      <div className="w-10 h-14 bg-gray-100 rounded border border-gray-200 overflow-hidden shrink-0">
                        <img src={b.coverImageUrl} alt={b.title} className="w-full h-full object-cover" />
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900 line-clamp-1">{b.title}</span>
                        <span className="text-xs text-gray-400">ID: {b.workId.slice(0, 8)}...</span>
                      </div>
                    </td>
                    <td className="p-4 text-gray-600 font-medium">{(b.authors || []).join(', ') || 'Đang cập nhật'}</td>
                    <td className="p-4 text-gray-700">
                      <span className="bg-gray-100 border border-gray-200 text-gray-700 text-xs px-2.5 py-1 rounded font-medium">{b.format}</span>
                    </td>
                    <td className="p-4 font-bold text-red-600">{vnd(b.price)}</td>
                    <td className="p-4">
                      {/* Quay lại hiển thị trạng thái Còn hàng / Hết hàng */}
                      {b.inStock ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Còn hàng
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full font-medium">
                          <AlertCircle className="w-3.5 h-3.5" /> Hết hàng
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => handleDelete(b.workId)}
                        className="px-1.5 py-1.5 hover:bg-red-50 text-red-600 border border-red-200 text-xs font-semibold rounded-lg transition-colors"
                      >
                        <Trash className="w-4 h-4" />
                      </button>{' '}
                      <button
                        onClick={() => handleOpenEdit(b.workId)}
                        className="px-1.5 py-1.5 hover:bg-blue-50 text-blue-600 border border-blue-200 text-xs font-semibold rounded-lg transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Phân trang thông minh (Chỉ hiện khi > 1 trang) */}
        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 text-xs text-gray-600">
            <span>
              Tổng số: <strong className="text-gray-900">{total}</strong> sách
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" /> Trước
              </button>
              <span className="font-semibold px-2">
                Trang {page} / {Math.ceil(total / 20)}
              </span>
              <button
                disabled={page >= Math.ceil(total / 20)}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1"
              >
                Sau <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal Thêm / Sửa Sách (Đầy đủ tất cả các trường) */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-6 shadow-xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-4">
              <h2 className="text-lg font-bold text-gray-900">{editingBook ? 'Cập nhật toàn bộ thông tin sách & ấn bản' : 'Thêm mới ấn bản sách'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4">
              {/* Phần quản lý ảnh bìa trực tiếp trong Modal */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl flex items-center gap-4">
                <div className="w-16 h-24 bg-white border border-gray-200 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                  {formData.coverImageUrl ? (
                    <img src={formData.coverImageUrl} alt="Cover Preview" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-gray-300" />
                  )}
                </div>
                <div className="space-y-2 flex-1">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Ảnh bìa ấn bản</h3>
                  <div>
                    <input type="file" ref={fileInputRef} onChange={handleCoverFileChange} accept="image/jpeg,image/png,image/webp" className="hidden" />
                    <button
                      type="button"
                      disabled={uploadingCover}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 text-gray-700 text-xs font-semibold rounded-lg shadow-sm transition-colors inline-flex items-center gap-1.5"
                    >
                      <Upload className={`w-4 h-4 ${uploadingCover ? 'animate-bounce' : ''}`} />
                      <span>{uploadingCover ? 'Đang xử lý...' : 'Chọn ảnh bìa'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Tên sách / Tác phẩm</label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Nhập tiêu đề sách..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mã ISBN-13</label>
                  <input
                    type="text"
                    required
                    value={formData.isbn}
                    onChange={(e) => setFormData({ ...formData, isbn: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Ví dụ: 978604..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Nhà xuất bản</label>
                  <input
                    type="text"
                    required
                    value={formData.publisher}
                    onChange={(e) => setFormData({ ...formData, publisher: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Tên NXB..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Giá niêm yết (VNĐ)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={formData.listPrice}
                    onChange={(e) => setFormData({ ...formData, listPrice: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="0"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Giá khuyến mãi (VNĐ)</label>
                  <input
                    type="number"
                    min="0"
                    value={formData.salePrice}
                    onChange={(e) => setFormData({ ...formData, salePrice: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Tùy chọn"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Tác giả (Cách nhau bằng dấu phẩy)</label>
                  <input
                    type="text"
                    required
                    value={formData.authors}
                    onChange={(e) => setFormData({ ...formData, authors: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Nguyễn Nhật Ánh, ..."
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Thể loại (Cách nhau bằng dấu phẩy)</label>
                  <input
                    type="text"
                    required
                    value={formData.categories}
                    onChange={(e) => setFormData({ ...formData, categories: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="Văn học, Truyện dài..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Định dạng</label>
                  <select
                    value={formData.format}
                    onChange={(e) => setFormData({ ...formData, format: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="PAPERBACK">Bìa mềm</option>
                    <option value="HARDCOVER">Bìa cứng</option>
                    <option value="EBOOK">Ebook</option>
                    <option value="AUDIOBOOK">Audiobook</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Trạng thái kinh doanh</label>
                  <select
                    value={formData.businessStatus}
                    onChange={(e) => setFormData({ ...formData, businessStatus: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                  >
                    <option value="ON_SALE">Đang kinh doanh (ON_SALE)</option>
                    <option value="DISCONTINUED">Ngừng kinh doanh (DISCONTINUED)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Năm xuất bản</label>
                  <input
                    type="number"
                    value={formData.publishedYear}
                    onChange={(e) => setFormData({ ...formData, publishedYear: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="2026"
                  />
                </div>
              </div>

              {/* Thông số kỹ thuật chi tiết */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Số trang</label>
                  <input
                    type="number"
                    value={formData.pageCount}
                    onChange={(e) => setFormData({ ...formData, pageCount: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="250"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Nặng (g)</label>
                  <input
                    type="number"
                    value={formData.weightGram}
                    onChange={(e) => setFormData({ ...formData, weightGram: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="350"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Dài (mm)</label>
                  <input
                    type="number"
                    value={formData.lengthMm}
                    onChange={(e) => setFormData({ ...formData, lengthMm: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="205"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Rộng (mm)</label>
                  <input
                    type="number"
                    value={formData.widthMm}
                    onChange={(e) => setFormData({ ...formData, widthMm: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="145"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Cao (mm)</label>
                  <input
                    type="number"
                    value={formData.heightMm}
                    onChange={(e) => setFormData({ ...formData, heightMm: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                    placeholder="15"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Mô tả sách</label>
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:ring-2 focus:ring-blue-500 font-medium"
                  placeholder="Nhập nội dung giới thiệu tóm tắt sách..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-primary disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  <span>{submitting ? 'Đang lưu...' : editingBook ? 'Lưu thay đổi' : 'Tạo sách mới'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
