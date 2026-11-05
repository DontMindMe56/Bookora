/**
 * Số tiền tối đa còn hoàn được cho giao dịch thanh toán của một đơn (hàm thuần).
 * - không vượt quá giá trị đơn (khách chuyển dư thì phần dư đã có khoản hoàn OVERPAID riêng);
 * - trừ phần đã hoàn qua khoản OVERPAID để không hoàn một khoản hai lần.
 */
export const refundableAmount = ({ amount, totalAmount, overpaidRefunded = 0 }) =>
  Math.max(0, Math.min(Number(amount) - Number(overpaidRefunded), Number(totalAmount)));
