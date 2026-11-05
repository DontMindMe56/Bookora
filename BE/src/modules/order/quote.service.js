import { query } from '../../db.js';
import { config } from '../../config.js';
import { ghnCall } from '../../services/ghn.js';
import { getInt } from '../../services/params.js';
import { AppError, conflict, unprocessable } from '../../utils/errors.js';
import { getCart } from '../cart/cart.service.js';
import { getAddress } from '../address/address.service.js';
import { resolveLocation } from '../geo/geo.service.js';
import { evaluateCodeForLines } from '../discount/discount.service.js';
import { vnd } from '../../utils/format.js';

export const PAYMENT_METHODS = ['COD', 'SEPAY', 'VNPAY'];

// Kích thước mặc định (mm) cho ấn bản chưa khai báo; GHN yêu cầu cm nguyên >= 1.
const DEFAULT_MM = { length: 240, width: 160, height: 20 };
const GHN_MAX_INSURANCE = 5_000_000;
const mmToCm = (mm) => Math.max(1, Math.ceil(mm / 10));

/**
 * Kiện hàng gửi GHN: khối lượng = tổng khối lượng sách + bao bì; dài/rộng = lớn nhất, cao = tổng chiều dày (xếp chồng).
 * Hàm thuần để dễ kiểm thử. `lines` = [{ quantity, weightGram, lengthMm, widthMm, heightMm }].
 */
export function buildPackage(lines, packagingGram) {
  let weight = packagingGram,
    length = 0,
    width = 0,
    height = 0;
  for (const l of lines) {
    weight += l.weightGram * l.quantity;
    length = Math.max(length, l.lengthMm ?? DEFAULT_MM.length);
    width = Math.max(width, l.widthMm ?? DEFAULT_MM.width);
    height += (l.heightMm ?? DEFAULT_MM.height) * l.quantity;
  }
  return { weight, length: mmToCm(length), width: mmToCm(width), height: mmToCm(height) };
}

/**
 * Hỏi GHN phí vận chuyển. Không đặt được hàng nếu GHN lỗi hoặc không giao được tới địa chỉ
 * (mọi lỗi của GHN được ném ra nguyên vẹn dạng AppError 502/503/504).
 * GIẢ ĐỊNH CHƯA KIỂM CHỨNG VỚI GHN THẬT: endpoint `/v2/shipping-order/fee`, header ShopId, trường `data.total`.
 */
async function getGhnFee(address, pkg, insuranceValue) {
  if (!config.ghn.shopId) throw new AppError(503, 'GHN_NOT_CONFIGURED', 'Chưa cấu hình GHN_SHOP_ID');
  const data = await ghnCall('/v2/shipping-order/fee', {
    headers: { ShopId: String(config.ghn.shopId) },
    body: {
      service_type_id: config.ghn.serviceTypeId,
      ...(config.ghn.fromDistrictId ? { from_district_id: config.ghn.fromDistrictId } : {}),
      to_district_id: address.ghnDistrictId,
      to_ward_code: address.ghnWardCode,
      weight: pkg.weight,
      length: pkg.length,
      width: pkg.width,
      height: pkg.height,
      insurance_value: Math.min(insuranceValue, GHN_MAX_INSURANCE),
    },
  });
  const fee = Number(data?.total);
  if (!Number.isFinite(fee) || fee < 0) throw new AppError(502, 'GHN_ERROR', 'GHN không trả về phí vận chuyển hợp lệ');
  return Math.round(fee);
}

/**
 * Tắt COD khi khách có >= COD_DISABLE_RETURNED_COUNT đơn COD hoàn về kho trong COD_DISABLE_WINDOW_DAYS ngày.
 * GIẢ ĐỊNH: "hoàn về do không nhận hàng" = đơn COD ở trạng thái RETURNED_TO_WAREHOUSE (trạng thái này chỉ sinh ra
 * từ luồng giao thất bại, không phải từ trả hàng sau khi nhận). Orders chưa có cột thời điểm hoàn nên tạm tính theo createdAt.
 */
async function codBlockedFor(customerId, conn) {
  const limit = await getInt('COD_DISABLE_RETURNED_COUNT');
  const days = await getInt('COD_DISABLE_WINDOW_DAYS');
  const [{ n }] = await query(
    `SELECT COUNT(*) AS n FROM Orders
      WHERE customerId = ? AND paymentMethod = 'COD' AND orderStatus = 'RETURNED_TO_WAREHOUSE'
        AND COALESCE(completedAt, createdAt) >= NOW() - INTERVAL ? DAY`,
    [customerId, days],
    conn,
  );
  return n >= limit;
}

/** Phí ship thật sự khách phải trả: miễn phí khi tiền hàng sau giảm >= ngưỡng. */
export const applyFreeShipping = (afterDiscount, ghnFee, threshold) => (afterDiscount >= threshold ? 0 : ghnFee);

/** Đọc kích thước/khối lượng các ấn bản để tính kiện hàng. */
export async function loadPackageLines(items) {
  const rows = await query('SELECT editionId, weightGram, lengthMm, widthMm, heightMm FROM Edition WHERE editionId IN (?)', [items.map((i) => i.editionId)]);
  const by = new Map(rows.map((r) => [r.editionId, r]));
  return items.map((i) => ({ quantity: i.quantity, ...by.get(i.editionId) }));
}

/**
 * Báo giá checkout cho giỏ hàng + địa chỉ hiện tại. Mọi số tiền đều tính ở server.
 * Ném 409 CART_NOT_PURCHASABLE nếu giỏ còn dòng hết hàng / ngừng bán (khách phải sửa giỏ trước).
 * Kết quả dùng lại ở bước tạo đơn: `lines` (chốt giá từng dòng), `ghnFee` (phí GHN gốc, chưa miễn phí).
 */
export async function buildQuote(customerId, { addressId, phone, discountCode }) {
  const cart = await getCart({ customerId });
  if (!cart.items.length) throw unprocessable('Giỏ hàng trống', 'CART_EMPTY');
  const bad = cart.items.filter((i) => !i.purchasable);
  if (bad.length) {
    throw conflict(
      'Giỏ hàng có sản phẩm không thể đặt, vui lòng cập nhật giỏ hàng',
      'CART_NOT_PURCHASABLE',
      bad.map((i) => ({ editionId: i.editionId, title: i.title, issues: i.issues })),
    );
  }

  const address = await getAddress(customerId, addressId);
  if (address.needsConfirm) throw unprocessable('Địa chỉ cần được xác nhận lại do GHN thay đổi địa giới', 'ADDRESS_NEEDS_CONFIRM');
  const loc = await resolveLocation(undefined, address); // còn nằm trong vùng GHN giao hàng; lấy tên theo danh mục
  const receiverPhone = phone ?? address.phone;

  const lines = cart.items.map((i) => ({
    editionId: i.editionId,
    title: i.title,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    listPrice: i.listPrice,
    lineTotal: i.lineTotal,
  }));
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);

  let discount = null;
  if (discountCode) {
    const r = await evaluateCodeForLines(
      customerId,
      discountCode,
      lines.map(({ editionId, quantity, unitPrice, listPrice }) => ({ editionId, quantity, unitPrice, listPrice })),
    );
    discount = { discountCodeId: r.discountCodeId, code: r.code, amount: r.amount };
  }
  const discountAmount = discount?.amount ?? 0;
  const afterDiscount = subtotal - discountAmount;

  const pkg = buildPackage(await loadPackageLines(lines), await getInt('DEFAULT_PACKAGING_WEIGHT_GRAM'));
  const ghnFee = await getGhnFee(address, pkg, subtotal);
  const threshold = await getInt('FREE_SHIPPING_THRESHOLD');
  const shippingFee = applyFreeShipping(afterDiscount, ghnFee, threshold);
  const total = afterDiscount + shippingFee;

  const gateway = (method, configured) => ({
    method,
    available: Boolean(configured),
    ...(configured ? {} : { code: 'GATEWAY_UNAVAILABLE', reason: 'Cổng thanh toán tạm ngưng' }),
  });
  const codLimit = await getInt('COD_LIMIT');
  const codOverLimit = total > codLimit;
  const codBlocked = await codBlockedFor(customerId);
  const paymentMethods = [
    {
      method: 'COD',
      available: !codOverLimit && !codBlocked,
      ...(codOverLimit
        ? { code: 'COD_OVER_LIMIT', reason: `Đơn vượt hạn mức thanh toán khi nhận hàng (${vnd(codLimit)})` }
        : codBlocked
          ? { code: 'COD_DISABLED', reason: 'Thanh toán khi nhận hàng tạm không áp dụng cho tài khoản của bạn' }
          : {}),
    },
    gateway('SEPAY', config.sepay.bank && config.sepay.accountNo),
    gateway('VNPAY', config.vnpay.tmnCode && config.vnpay.secret),
  ];

  return {
    items: lines,
    subtotal,
    discount,
    discountAmount,
    ghnFee,
    shippingFee,
    freeShipping: shippingFee === 0 && ghnFee > 0,
    freeShippingThreshold: threshold,
    total,
    weightGram: pkg.weight,
    paymentMethods,
    address: {
      addressId: address.addressId,
      receiverName: address.receiverName,
      phone: receiverPhone,
      detail: address.detail,
      province: loc.province,
      district: loc.district,
      ward: loc.ward,
      ghnProvinceId: address.ghnProvinceId,
      ghnDistrictId: address.ghnDistrictId,
      ghnWardCode: address.ghnWardCode,
    },
  };
}
