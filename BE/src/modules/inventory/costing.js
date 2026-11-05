// Hàm thuần (không đụng DB) cho giá vốn và mức tồn tối thiểu => dễ kiểm thử.

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const toCents = (n) => Math.round(n * 100);

/**
 * Giá vốn bình quân gia quyền sau khi nhập `qty` cuốn giá `unitCost`.
 * Chưa có tồn hoặc chưa có giá vốn (0) => lấy luôn giá nhập, tránh kéo giá vốn về 0.
 */
export function weightedAverageCost({ onHand, currentCost, qty, unitCost }) {
  if (!(qty > 0)) throw new Error('qty phải > 0');
  if (onHand <= 0 || !(currentCost > 0)) return round2(unitCost);
  return round2((onHand * currentCost + qty * unitCost) / (onHand + qty));
}

/**
 * Giá vốn sau khi điều chỉnh giá nhập của một dòng phiếu cũ.
 * Chênh lệch chỉ ảnh hưởng phần của lô đó còn nằm trong kho (tối đa `lotQty`, tối đa `onHand`);
 * phần đã bán giữ nguyên (không tính lại báo cáo kỳ cũ). Hết tồn => giá vốn giữ nguyên.
 */
export function costAfterAdjustment({ onHand, currentCost, oldUnitCost, newUnitCost, lotQty }) {
  if (onHand <= 0) return round2(currentCost);
  const affected = Math.min(lotQty, onHand);
  return round2(Math.max(0, currentCost + ((newUnitCost - oldUnitCost) * affected) / onHand));
}

/**
 * Tồn tối thiểu = doanh số bình quân/ngày x thời gian giao + tồn an toàn.
 * Số lượng đặt lại = lớn nhất của (tồn tối thiểu, nhu cầu `horizonDays` ngày), tối thiểu 1.
 * (Công thức là giả định vì SRS chưa nêu chi tiết; các tham số lấy từ SystemParameter.)
 */
export function computeStockLevels({ sold, days, leadTimeDays, safetyStock, horizonDays }) {
  const avgDaily = days > 0 ? sold / days : 0;
  const minStockLevel = Math.max(0, Math.ceil((sold * leadTimeDays) / days - 1e-9)) + safetyStock;
  const demand = Math.ceil(avgDaily * horizonDays - 1e-9);
  return { avgDaily, minStockLevel, reorderQty: Math.max(minStockLevel, demand, 1) };
}
