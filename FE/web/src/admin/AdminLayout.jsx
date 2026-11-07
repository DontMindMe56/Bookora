import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../store';

export default function AdminLayout() {
  const { token, role, setToken } = useStore();
  const nav = useNavigate();
  if (!token || !['STAFF', 'ADMIN'].includes(role)) return <Navigate to="/admin/login" replace />;
  return (
    <>
      <div className="bar" style={{ borderBottom: '1px solid #e6e1d8', marginBottom: 16, padding: 0, paddingBottom: 10 }}>
        <b className="logo">Quản trị</b>
        {role === 'ADMIN' && <NavLink to="/admin/customers">Khách hàng</NavLink>}
        {role === 'ADMIN' && <NavLink to="/admin/staffs">Nhân Sự</NavLink>}
        <NavLink to="/admin" end>
          Đơn hàng
        </NavLink>
        {role === 'ADMIN' && <NavLink to="/admin/reports">Báo cáo</NavLink>}
        {role === 'ADMIN' && <NavLink to="/admin/parameters">Tham số hệ thống</NavLink>}
        {role === 'ADMIN' && <NavLink to="/admin/logs">Logs</NavLink>}
        <span style={{ flex: 1 }} />
        <span className="mut">{role}</span>
        <NavLink to="/">Cửa hàng</NavLink>
        <button className="ghost" onClick={() => (setToken(null), nav('/admin/login'))}>
          Đăng xuất
        </button>
      </div>
      <Outlet />
    </>
  );
}
