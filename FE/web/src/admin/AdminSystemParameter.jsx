import React, { useState, useEffect } from 'react';
import { Edit2, Save, X, RefreshCw, Check, AlertCircle, History, List } from 'lucide-react';
import { api } from '../api'; // Import hàm api từ file api.js của dự án

export const AdminSystemParameter = () => {
  const [activeTab, setActiveTab] = useState('params'); // 'params' hoặc 'logs'

  // States cho danh sách thông số
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Editing state
  const [editingKey, setEditingKey] = useState(null);
  const [editFormData, setEditFormData] = useState({
    paramKey: '',
    paramValue: '',
    description: '',
    reason: '',
  });

  // States cho Lịch sử thay đổi (Audit Logs)
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // 1. Fetch parameters từ API bằng hàm api chuẩn của dự án
  const fetchParameters = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/api/admin/parameters');
      const list = Array.isArray(data) ? data : data.data || [];
      setParameters(list);
    } catch (err) {
      setError(err.message || 'Đã có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  // 2. Fetch Audit Logs từ API bằng hàm api chuẩn của dự án
  const fetchAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const data = await api('/api/admin/audit-logs?entityType=PARAMETER');
      const list = Array.isArray(data) ? data : data.items || data.data || [];
      setAuditLogs(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    fetchParameters();
  }, []);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  // Tự động xóa thông báo thành công sau 3 giây
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Bắt đầu sửa thông số
  const handleEditClick = (param) => {
    setEditingKey(param.paramKey);
    setEditFormData({
      paramKey: param.paramKey,
      paramValue: param.paramValue,
      description: param.description || '',
      reason: '',
    });
  };

  // Lưu cập nhật thông số (dùng hàm api với method PATCH)
  const handleSaveEdit = async () => {
    if (!editFormData.reason || !editFormData.reason.trim()) {
      alert('Vui lòng nhập lý do thay đổi (reason) để hệ thống ghi Audit Log!');
      return;
    }

    try {
      await api(`/api/admin/parameters/${editFormData.paramKey}`, {
        method: 'PATCH',
        body: {
          value: editFormData.paramValue,
          reason: editFormData.reason,
        },
      });

      setParameters((prev) =>
        prev.map((item) =>
          item.paramKey === editFormData.paramKey ? { ...item, paramValue: editFormData.paramValue, updatedAt: new Date().toISOString() } : item,
        ),
      );
      setEditingKey(null);
      setSuccessMsg('Cập nhật thông số thành công!');
    } catch (err) {
      alert(err.message || 'Không thể lưu thay đổi');
    }
  };

  // Lọc dữ liệu tìm kiếm thông số
  const filteredParameters = parameters.filter((param) => {
    const key = param.paramKey || '';
    const val = String(param.paramValue || '');
    const desc = param.description || '';

    return (
      key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      val.toLowerCase().includes(searchTerm.toLowerCase()) ||
      desc.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  return (
    <div className="p-6 max-w-6xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Header & Tabs chuyển đổi */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Quản Lý Thông Số Hệ Thống</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <button
              onClick={() => setActiveTab('params')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'params' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-1">
                <List className="w-4 h-4" />
                <span>Tham số</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'logs' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-1">
                <History className="w-4 h-4" />
                <span>Lịch sử thay đổi</span>
              </div>
            </button>
          </div>

          <button
            onClick={activeTab === 'params' ? fetchParameters : fetchAuditLogs}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border"
            title="Tải lại"
          >
            <RefreshCw className={`w-5 h-5 ${loading || loadingLogs ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notifications */}
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
        <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 text-green-700 flex items-center gap-2">
          <Check className="w-5 h-5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* TAB 1: DANH SÁCH THAM SỐ */}
      {activeTab === 'params' && (
        <>
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="Tìm theo Mã (paramKey), Giá trị hoặc Mô tả..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
                  <th className="p-3">Mã (paramKey)</th>
                  <th className="p-3">Giá trị (paramValue)</th>
                  <th className="p-3">Mô tả</th>
                  <th className="p-3">Cập nhật lúc</th>
                  <th className="p-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      Đang tải dữ liệu...
                    </td>
                  </tr>
                ) : filteredParameters.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-gray-500">
                      Không tìm thấy thông số phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredParameters.map((param) => {
                    const isEditing = editingKey === param.paramKey;

                    if (isEditing) {
                      return (
                        <tr key={param.paramKey} className="bg-yellow-50/50">
                          <td className="p-3 font-mono font-bold text-gray-700 align-top">{param.paramKey}</td>
                          <td className="p-3 space-y-2">
                            <input
                              type="text"
                              placeholder="Giá trị mới..."
                              value={editFormData.paramValue}
                              onChange={(e) => setEditFormData({ ...editFormData, paramValue: e.target.value })}
                              className="w-full px-2 py-1 border rounded bg-white text-sm"
                            />
                            <input
                              type="text"
                              placeholder="Nhập lý do thay đổi (Bắt buộc)..."
                              value={editFormData.reason}
                              onChange={(e) => setEditFormData({ ...editFormData, reason: e.target.value })}
                              className="w-full px-2 py-1 border rounded bg-white text-xs text-gray-700 border-orange-300 focus:ring-1 focus:ring-orange-500"
                            />
                          </td>
                          <td className="p-3 text-gray-500 align-top" colSpan={2}>
                            {param.description || '—'}
                          </td>
                          <td className="p-3 text-right align-top">
                            <div className="flex justify-end gap-1">
                              <button onClick={handleSaveEdit} className="p-1.5 text-green-600 hover:bg-green-100 rounded" title="Lưu thay đổi">
                                <Save className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditingKey(null)} className="p-1.5 text-gray-500 hover:bg-gray-200 rounded" title="Hủy">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={param.paramKey} className="hover:bg-gray-50 transition-colors">
                        <td className="p-3 font-mono font-medium text-blue-900">{param.paramKey}</td>
                        <td className="p-3 font-mono max-w-xs truncate" title={param.paramValue}>
                          <span className="bg-gray-100 px-2 py-1 rounded text-gray-800">{param.paramValue}</span>
                        </td>
                        <td className="p-3 text-gray-600 max-w-sm truncate" title={param.description}>
                          {param.description || '—'}
                        </td>
                        <td className="p-3 text-xs text-gray-400">{param.updatedAt ? new Date(param.updatedAt).toLocaleString() : '—'}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => handleEditClick(param)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded inline-flex items-center gap-1 text-xs font-medium"
                            title="Sửa"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* TAB 2: LỊCH SỬ THAY ĐỔI (AUDIT LOGS) */}
      {activeTab === 'logs' && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
                <th className="p-3">Thời gian</th>
                <th className="p-3">Người thực hiện</th>
                <th className="p-3">Hành động</th>
                <th className="p-3">Giá trị cũ → Mới</th>
                <th className="p-3">Lý do</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {loadingLogs ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    Đang tải lịch sử...
                  </td>
                </tr>
              ) : auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-500">
                    Chưa có lịch sử thay đổi nào.
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.logId || Math.random()} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                    <td className="p-3 text-xs text-gray-700">{log.actorEmail || `ID: ${log.actorId}`}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-100 text-blue-800">{log.action}</span>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      <div className="text-red-600">Cũ: {JSON.stringify(log.oldValue)}</div>
                      <div className="text-green-600">Mới: {JSON.stringify(log.newValue)}</div>
                    </td>
                    <td className="p-3 text-xs text-gray-600 italic">{log.reason || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
