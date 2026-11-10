import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Search, RefreshCw, User, Layers, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../api';
import toast from 'react-hot-toast';

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  // Các state lọc trên Client-side
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');

  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 1. Tải danh sách audit logs từ API
  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const data = await api(`/api/admin/audit-logs?page=${page}`);
      const items = data.items || data.data || (Array.isArray(data) ? data : []);
      setLogs(items);
    } catch (err) {
      toast.error(err.message || 'Không thể tải nhật ký hệ thống');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [page]);

  // 2. Lọc thông minh ngay trên Frontend
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesSearch =
        searchTerm === '' ||
        (log.reason && log.reason.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.actorEmail && log.actorEmail.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.action && log.action.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (log.entityType && log.entityType.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesAction = actionFilter === '' || log.action === actionFilter;
      const matchesEntity = entityFilter === '' || log.entityType === entityFilter;

      return matchesSearch && matchesAction && matchesEntity;
    });
  }, [logs, searchTerm, actionFilter, entityFilter]);

  // Tính tổng số trang dựa trên mảng đã lọc
  const totalPages = Math.ceil(filteredLogs.length / pageSize) || 1;

  // Cắt mảng hiển thị theo trang hiện tại
  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredLogs.slice(start, start + pageSize);
  }, [filteredLogs, page, pageSize]);

  // Danh sách duy nhất cho select filter
  const uniqueActions = useMemo(() => [...new Set(logs.map((l) => l.action).filter(Boolean))], [logs]);
  const uniqueEntities = useMemo(() => [...new Set(logs.map((l) => l.entityType).filter(Boolean))], [logs]);

  return (
    <div className="p-6 max-w-7xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">Nhật Ký Hệ Thống (Audit Logs)</h1>
        </div>
        <button
          onClick={fetchAuditLogs}
          className="px-3 py-2 bg-primary text-white rounded-lg border flex items-center gap-2 text-sm font-medium self-start"
          title="Tải lại"
        >
          <div className="flex items-center gap-1">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            <span>Tải lại</span>
          </div>
        </button>
      </div>

      {/* Thanh tìm kiếm và bộ lọc trực tiếp trên client */}
      <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Tìm kiếm nhanh trong trang (lý do, email, hành động...)..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-white border-gray-300"
            />
          </div>
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm('');
                setPage(1);
              }}
              className="px-3 py-2 text-xs text-gray-600 hover:bg-gray-200 rounded-lg border"
            >
              Xóa tìm kiếm
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tất cả hành động (Action)</option>
            {uniqueActions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>

          <select
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg text-sm bg-white border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Tất cả đối tượng (Entity Type)</option>
            {uniqueEntities.map((ent) => (
              <option key={ent} value={ent}>
                {ent}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bảng danh sách Audit Logs */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
              <th className="p-3">Thời gian</th>
              <th className="p-3">Nhân sự thực hiện (Actor)</th>
              <th className="p-3">Hành động & Đối tượng</th>
              <th className="p-3">Lý do (Reason)</th>
              <th className="p-3">Dữ liệu thay đổi (Old / New)</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-500">
                  Đang tải nhật ký hệ thống...
                </td>
              </tr>
            ) : paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-500">
                  Không tìm thấy bản ghi nhật ký nào phù hợp.
                </td>
              </tr>
            ) : (
              paginatedLogs.map((log, index) => (
                <tr key={log.logId || index} className="hover:bg-gray-50 transition-colors align-top">
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{log.createdAt ? new Date(log.createdAt).toLocaleString('vi-VN') : '—'}</td>
                  <td className="p-3">
                    <div className="font-medium text-gray-800 flex items-center gap-1.5">
                      <User className="w-4 h-4 text-gray-400 shrink-0" />
                      <span>{log.actorEmail || log.actorId || 'Hệ thống'}</span>
                    </div>
                  </td>
                  <td className="p-3 space-y-1">
                    <div>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono font-semibold">{log.action}</span>
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-gray-400" />
                      <span>
                        {log.entityType} {log.entityId ? `(#${log.entityId.substring(0, 8)})` : ''}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-xs text-gray-700 italic max-w-xs truncate" title={log.reason}>
                    {log.reason || '—'}
                  </td>
                  <td className="p-3 text-xs font-mono text-gray-600 space-y-1 max-w-md">
                    {log.oldValue && (
                      <div
                        className="bg-red-50 p-1.5 rounded border border-red-100 truncate"
                        title={`Cũ: ${typeof log.oldValue === 'object' ? JSON.stringify(log.oldValue) : log.oldValue}`}
                      >
                        <span className="text-red-600 font-bold mr-1">-</span> {typeof log.oldValue === 'object' ? JSON.stringify(log.oldValue) : log.oldValue}
                      </div>
                    )}
                    {log.newValue && (
                      <div
                        className="bg-green-50 p-1.5 rounded border border-green-100 truncate"
                        title={`Mới: ${typeof log.newValue === 'object' ? JSON.stringify(log.newValue) : log.newValue}`}
                      >
                        <span className="text-green-600 font-bold mr-1">+</span>{' '}
                        {typeof log.newValue === 'object' ? JSON.stringify(log.newValue) : log.newValue}
                      </div>
                    )}
                    {!log.oldValue && !log.newValue && <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Khối Phân trang đồng bộ chuẩn w-5 h-5 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-xs text-gray-500">
            Trang <span className="font-medium">{page}</span> / <span className="font-medium">{totalPages}</span> · Tổng số{' '}
            <span className="font-medium">{filteredLogs.length}</span> bản ghi
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              disabled={page === 1}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              disabled={page === totalPages}
              className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
