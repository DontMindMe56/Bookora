import { useState } from 'react';
import { FileText, ShieldCheck, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsAndPrivacy() {
  const nav = useNavigate();
  const [activeTab, setActiveTab] = useState('terms');

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <button
        onClick={() => {
          nav(-1);
        }}
        className="inline-flex items-center gap-1.5 text-sm font-semibold btn transition-colors"
      >
        <div className="flex items-center gap-1">
          <ArrowLeft className="w-5 h-5" />
          <span>Quay lại</span>
        </div>
      </button>

      {/* Tiêu đề trang */}
      <div className="text-center space-y-2 border-b pb-6">
        <h1 className="text-3xl font-extrabold text-gray-900">Điều khoản & Chính sách</h1>
        <p className="text-sm text-gray-500">Cập nhật lần cuối: Tháng 03 năm 2026. Vui lòng đọc kỹ các điều khoản trước khi sử dụng dịch vụ của chúng tôi.</p>
      </div>

      {/* Thanh chuyển đổi Tab */}
      <div className="flex justify-center">
        <div className="flex space-x-8">
          <button
            onClick={() => setActiveTab('terms')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'terms' ? 'bg-primary text-white shadow-sm' : 'text-gray-600 border border-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-1">
              <FileText className="w-5 h-5" />
              <span>Điều khoản sử dụng</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('privacy')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'privacy' ? 'bg-primary text-white shadow-sm' : 'text-gray-600 border border-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-5 h-5" />
              <span>Chính sách quyền riêng tư</span>
            </div>
          </button>
        </div>
      </div>

      {/* Nội dung hiển thị theo Tab */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-gray-700 leading-relaxed text-sm">
        {activeTab === 'terms' ? (
          /* ================= NỘI DUNG ĐIỀU KHOẢN SỬ DỤNG ================= */
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                1. Chấp nhận các điều khoản
              </h2>
              <p className="text-gray-600 pl-4">
                Khi bạn truy cập và sử dụng website hoặc dịch vụ của chúng tôi, bạn đồng ý tuân thủ và chịu ràng buộc bởi các điều khoản sử dụng này. Nếu bạn
                không đồng ý với bất kỳ phần nào, vui lòng ngừng sử dụng dịch vụ ngay lập tức.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                2. Tài khoản người dùng và bảo mật
              </h2>
              <p className="text-gray-600 pl-4">
                Bạn có trách nhiệm bảo mật thông tin tài khoản, mật khẩu của mình và chịu hoàn toàn trách nhiệm cho mọi hoạt động diễn ra dưới tài khoản của
                bạn. Bạn cam kết thông báo ngay cho chúng tôi nếu phát hiện bất kỳ hành vi truy cập trái phép nào.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                3. Quy định về mua hàng và thanh toán
              </h2>
              <p className="text-gray-600 pl-4">
                Tất cả các đơn hàng được đặt qua hệ thống phải tuân thủ quy trình xác thực, thanh toán và chính sách giao nhận hàng hóa của chúng tôi. Giá cả và
                tình trạng còn hàng có thể được cập nhật mà không cần thông báo trước.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                4. Sở hữu trí tuệ
              </h2>
              <p className="text-gray-600 pl-4">
                Toàn bộ nội dung hiển thị trên trang web bao gồm văn bản, đồ họa, logo, hình ảnh, mã nguồn đều thuộc quyền sở hữu của chúng tôi và được bảo vệ
                bởi luật sở hữu trí tuệ.
              </p>
            </section>
          </div>
        ) : (
          /* ================= NỘI DUNG CHÍNH SÁCH QUYỀN RIÊNG TƯ ================= */
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                1. Thông tin chúng tôi thu thập
              </h2>
              <p className="text-gray-600 pl-4">
                Chúng tôi thu thập thông tin cá nhân khi bạn đăng ký tài khoản, thực hiện giao dịch mua hàng hoặc liên hệ hỗ trợ, bao gồm: Họ tên, địa chỉ
                email, số điện thoại và địa chỉ nhận hàng.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                2. Mục đích sử dụng thông tin
              </h2>
              <ul className="list-disc list-inside text-gray-600 pl-4 space-y-1">
                <li>Xử lý đơn hàng và cung cấp dịch vụ mua bán sách.</li>
                <li>Gửi thông báo về trạng thái đơn hàng, mã xác thực tài khoản.</li>
                <li>Cải thiện chất lượng dịch vụ, chăm sóc khách hàng và trải nghiệm website.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                3. Bảo mật dữ liệu cá nhân
              </h2>
              <p className="text-gray-600 pl-4">
                Chúng tôi áp dụng các biện pháp bảo mật kỹ thuật và tổ chức nghiêm ngặt (như mã hóa mật khẩu, bảo mật phiên giao dịch) để bảo vệ thông tin cá
                nhân của bạn khỏi hành vi truy cập, sử dụng hoặc tiết lộ trái phép.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                4. Quyền của người dùng
              </h2>
              <p className="text-gray-600 pl-4">
                Bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc xóa thông tin cá nhân của mình bất cứ lúc nào thông qua phần quản lý tài khoản cá nhân
                (UserProfile) hoặc liên hệ trực tiếp với đội ngũ hỗ trợ của chúng tôi.
              </p>
            </section>
          </div>
        )}
      </div>

      {/* Footer nhỏ */}
      <div className="text-center text-xs text-gray-400 py-2">
        Nếu bạn có bất kỳ câu hỏi nào về các điều khoản này, vui lòng liên hệ với bộ phận hỗ trợ khách hàng của chúng tôi.
      </div>
    </div>
  );
}
