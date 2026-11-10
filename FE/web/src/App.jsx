import { useEffect } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from './store';
import Home from './pages/Home';
import Book from './pages/Book';
import Cart from './pages/Cart';
import Login from './pages/Login';
import Checkout from './pages/Checkout';
import Done from './pages/Done';
import Orders from './pages/Orders';
import VnpayReturn from './pages/VnpayReturn';
import AdminLogin from './admin/AdminLogin';
import AdminLayout from './admin/AdminLayout';
import AdminOrders from './admin/AdminOrders';
import AdminOrderDetail from './admin/AdminOrderDetail';
import AdminReports from './admin/AdminReports';
import { AdminSystemParameter } from './admin/AdminSystemParameter';
import { AdminCustomers } from './admin/AdminCustomers';
import AdminStaffs from './admin/AdminStaffs';
import AdminAuditLogs from './admin/AdminAuditLogs';
import UserProfile from './pages/UserProfile';
import AdminBooks from './admin/AdminBooks';
import Register from './pages/Register';
import TermsAndPrivacy from './pages/TermsAndPrivacy';

function Private({ children }) {
  const token = useStore((s) => s.token);
  const loc = useLocation();
  return token ? children : <Navigate to="/login" state={{ from: loc.pathname }} replace />;
}

function Header() {
  const { token, role, setToken, cartCount, refreshCart } = useStore();
  const nav = useNavigate();
  useEffect(() => void refreshCart(), [token]);
  const search = (e) => {
    e.preventDefault();
    nav('/?q=' + encodeURIComponent(new FormData(e.target).get('q')));
  };
  return (
    <header>
      <div className="bar">
        <Link to="/" className="logo">
          📚 Bookora
        </Link>
        <form onSubmit={search}>
          <input name="q" placeholder="Tìm sách, tác giả…" />
          <button className="btn">Tìm</button>
        </form>
        {!['STAFF', 'ADMIN'].includes(role) && (
          <Link to="/orders" className="btn ghost">
            Đơn hàng
          </Link>
        )}
        {['STAFF', 'ADMIN'].includes(role) && (
          <Link to="/admin" className="btn ghost">
            Quản trị
          </Link>
        )}
        {!['STAFF', 'ADMIN'].includes(role) && (
          <Link to="/cart" className="btn ghost">
            Giỏ hàng ({cartCount})
          </Link>
        )}
        {token && (
          <Link to="/profile" className="btn ghost">
            Tài khoản
          </Link>
        )}
        {token ? (
          <button className="btn ghost" onClick={() => (setToken(null), nav('/'))}>
            Đăng xuất
          </button>
        ) : (
          <Link to="/login" className="btn">
            Đăng nhập
          </Link>
        )}
      </div>
    </header>
  );
}

export default function App() {
  const admin = useLocation().pathname.startsWith('/admin');
  return (
    <>
      {!admin && <Header />}
      <main>
        <Routes>
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminReports />} />
            <Route path="books" element={<AdminBooks />} />
            <Route path="customers" element={<AdminCustomers />} />
            <Route path="staffs" element={<AdminStaffs />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="orders/:id" element={<AdminOrderDetail />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="parameters" element={<AdminSystemParameter />} />
            <Route path="logs" element={<AdminAuditLogs />} />
          </Route>
          <Route path="/" element={<Home />} />
          <Route path="/book/:id" element={<Book />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/profile" element={<UserProfile />} />

          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/terms-and-privacy" element={<TermsAndPrivacy />} />

          <Route
            path="/checkout"
            element={
              <Private>
                <Checkout />
              </Private>
            }
          />
          <Route
            path="/orders"
            element={
              <Private>
                <Orders />
              </Private>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <Private>
                <Done />
              </Private>
            }
          />
          <Route path="/payment/vnpay-return" element={<VnpayReturn />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
