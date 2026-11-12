import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, X, FolderTree, Plus, Edit, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';

export default function AdminCategory() {
  // States cho danh sách thể loại
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Bộ lọc & Phân trang
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // State quản lý Modal Thêm / Sửa
  const [editingCategory, setEditingCategory] = useState(null); // null: đóng modal, object: Sửa, {} hoặc rỗng: Thêm mới
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ name: '', parentId: '', description: '' });
  const [loadingAction, setLoadingAction] = useState(false);

  // Tải danh sách thể loại
  const fetchCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        ...(searchTerm ? { q: searchTerm } : {}),
      });

      const data = await api(`/api/admin/categories?${queryParams.toString()}`);

      // Xử lý cấu trúc trả về từ backend (items/data hoặc mảng)
      const list = data.items || data.data || (Array.isArray(data) ? data : []);
      setCategories(list);
      if (data.pages) {
        setTotalPages(data.pages);
      } else if (data.total) {
        setTotalPages(Math.ceil(data.total / 50) || 1); // PAGE_SIZE = 50 theo backend của bạn
      } else {
        setTotalPages(1);
      }
    } catch (err) {
      setError(err.message || 'Không thể tải danh sách thể loại');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, [page]);

  // Tìm kiếm khi nhấn Enter hoặc click nút tìm
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchCategories();
  };

  // Mở modal thêm mới
  const handleOpenAdd = () => {
    setEditingCategory(null);
    setFormData({ name: '', parentId: '', description: '' });
    setError(null);
    setIsModalOpen(true);
  };

  // Mở modal chỉnh sửa
  const handleOpenEdit = (cat) => {
    setEditingCategory(cat);
    setFormData({
      name: cat.name || '',
      parentId: cat.parentId || '',
      description: cat.description || '',
    });
    setError(null);
    setIsModalOpen(true);
  };

  // Gửi request Thêm mới hoặc Cập nhật
  const handleSubmitForm = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('Vui lòng nhập tên thể loại!');
      return;
    }

    setLoadingAction(true);
    try {
      const url = editingCategory ? `/api/admin/categories/${editingCategory.categoryId}` : `/api/admin/categories`;
      const method = editingCategory ? 'PATCH' : 'POST';

      await api(url, {
        method,
        body: {
          name: formData.name.trim(),
          parentId: formData.parentId ? formData.parentId : null,
          description: formData.description.trim(),
        },
      });

      setSuccessMsg(editingCategory ? 'Cập nhật thể loại thành công!' : 'Tạo thể loại mới thành công!');
      setIsModalOpen(false);
      fetchCategories();
    } catch (err) {
      alert(err.message || 'Thực hiện thao tác thất bại');
    } finally {
      setLoadingAction(false);
    }
  };

  // Xử lý Xóa thể loại
  const handleDeleteCategory = async (catId, catName) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa thể loại "${catName}" không?`)) return;

    try {
      await api(`/api/admin/categories/${catId}`, {
        method: 'DELETE',
      });
      setSuccessMsg('Đã xóa thể loại thành công!');
      fetchCategories();
    } catch (err) {
      alert(err.message || 'Không thể xóa thể loại này (có thể đang được sử dụng hoặc có thể loại con).');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản Lý Thể Loại Sách</h1>
          <p className="text-sm text-gray-500 mt-0.5">Quản lý danh mục, phân cấp thể loại cha/con</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Thêm thể loại mới
          </button>
          <button
            onClick={fetchCategories}
            className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg border flex items-center gap-2 transition-colors"
            title="Tải lại"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Thông báo lỗi / thành công */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 text-green-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Thanh tìm kiếm */}
      <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Tìm kiếm theo tên thể loại..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm border-gray-300"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
          Tìm kiếm
        </button>
      </form>

      {/* Bảng danh sách thể loại */}
      <div className="overflow-x-auto border rounded-lg mb-4">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
              <th className="p-3">Tên thể loại</th>
              <th className="p-3">Mã định danh (ID)</th>
              <th className="p-3">Thể loại cha (Parent ID)</th>
              <th className="p-3">Mô tả</th>
              <th className="p-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-gray-500">
                  Đang tải danh sách thể loại...
                </td>
              </tr>
            ) : categories.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-10 text-gray-500">
                  Không tìm thấy thể loại nào.
                </td>
              </tr>
            ) : (
              categories.map((cat) => (
                <tr key={cat.categoryId} className="hover:bg-gray-50 transition-colors">
                  <td className="p-3">
                    <div className="font-medium text-gray-900 flex items-center gap-1.5">
                      <FolderTree className="w-4 h-4 text-blue-500" />
                      {cat.name}
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-400 font-mono">{cat.categoryId}</td>
                  <td className="p-3">
                    {cat.parentId ? (
                      <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono">{cat.parentId}</span>
                    ) : (
                      <span className="text-gray-400 italic text-xs">Cấp gốc (Root)</span>
                    )}
                  </td>
                  <td className="p-3 text-gray-600 text-xs max-w-xs truncate">{cat.description || '—'}</td>
                  <td className="p-3 text-right space-x-1">
                    <button
                      onClick={() => handleOpenEdit(cat)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg inline-flex items-center gap-1 text-xs font-medium border border-blue-200 transition-colors"
                      title="Chỉnh sửa"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(cat.categoryId, cat.name)}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg inline-flex items-center gap-1 text-xs font-medium border border-red-200 transition-colors"
                      title="Xóa"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-gray-500">
            Trang <span className="font-medium">{page}</span> / <span className="font-medium">{totalPages}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page === totalPages}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MODAL THÊM / SỬA THỂ LOẠI */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-blue-600" />
                {editingCategory ? 'Chỉnh sửa thể loại' : 'Thêm thể loại mới'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">
                  Tên thể loại <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ví dụ: Công nghệ thông tin, Văn học..."
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Mã thể loại cha (Parent ID)</label>
                <input
                  type="text"
                  placeholder="Để trống nếu là danh mục gốc (Hệ thống hỗ trợ 2 cấp)"
                  value={formData.parentId}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300 font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Mô tả</label>
                <textarea
                  rows="3"
                  placeholder="Mô tả ngắn gọn về danh mục..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 border-gray-300"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={loadingAction}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center gap-2"
                >
                  {loadingAction ? 'Đang xử lý...' : editingCategory ? 'Lưu thay đổi' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
