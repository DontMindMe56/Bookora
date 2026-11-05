// Kiểm thử đơn vị cho tính giá vốn / tồn tối thiểu (không cần DB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightedAverageCost, costAfterAdjustment, computeStockLevels, round2, toCents } from '../src/modules/inventory/costing.js';

test('giá vốn bình quân gia quyền', () => {
  assert.equal(weightedAverageCost({ onHand: 0, currentCost: 0, qty: 10, unitCost: 50000 }), 50000);
  // 10 cuốn @50.000 + 10 cuốn @60.000 => 55.000
  assert.equal(weightedAverageCost({ onHand: 10, currentCost: 50000, qty: 10, unitCost: 60000 }), 55000);
  // chưa có giá vốn (0) dù đang có tồn => lấy giá nhập, không kéo về 0
  assert.equal(weightedAverageCost({ onHand: 5, currentCost: 0, qty: 5, unitCost: 40000 }), 40000);
  // làm tròn 2 chữ số: (3*10000 + 1*10001) / 4 = 10000.25
  assert.equal(weightedAverageCost({ onHand: 3, currentCost: 10000, qty: 1, unitCost: 10001 }), 10000.25);
  assert.throws(() => weightedAverageCost({ onHand: 1, currentCost: 1, qty: 0, unitCost: 1 }));
});

test('điều chỉnh giá nhập chỉ ảnh hưởng phần còn trong kho', () => {
  // còn 10, lô 10 cuốn đổi giá 50.000 -> 40.000 => giá vốn giảm 10.000
  assert.equal(costAfterAdjustment({ onHand: 10, currentCost: 50000, oldUnitCost: 50000, newUnitCost: 40000, lotQty: 10 }), 40000);
  // lô 10 cuốn nhưng chỉ còn 4 trong kho => chênh lệch tính trên 4 cuốn, chia cho tồn 4
  assert.equal(costAfterAdjustment({ onHand: 4, currentCost: 50000, oldUnitCost: 50000, newUnitCost: 40000, lotQty: 10 }), 40000);
  // kho có 20 (lô này 10): ảnh hưởng 10/20 => giảm 5.000
  assert.equal(costAfterAdjustment({ onHand: 20, currentCost: 50000, oldUnitCost: 50000, newUnitCost: 40000, lotQty: 10 }), 45000);
  // hết tồn => giữ nguyên
  assert.equal(costAfterAdjustment({ onHand: 0, currentCost: 50000, oldUnitCost: 50000, newUnitCost: 1, lotQty: 10 }), 50000);
  // không âm
  assert.equal(costAfterAdjustment({ onHand: 1, currentCost: 100, oldUnitCost: 1000, newUnitCost: 0, lotQty: 1 }), 0);
});

test('tồn tối thiểu và số lượng đặt lại', () => {
  // 30 cuốn/30 ngày = 1/ngày, giao 7 ngày, an toàn 2 => min 9; đặt lại = max(9, 30) = 30
  assert.deepEqual(computeStockLevels({ sold: 30, days: 30, leadTimeDays: 7, safetyStock: 2, horizonDays: 30 }), {
    avgDaily: 1,
    minStockLevel: 9,
    reorderQty: 30,
  });
  // 3 cuốn/30 ngày, giao 10 ngày => 1 + an toàn 2 = 3 (không bị lỗi số thực 0.1*10)
  const r = computeStockLevels({ sold: 3, days: 30, leadTimeDays: 10, safetyStock: 2, horizonDays: 30 });
  assert.equal(r.minStockLevel, 3);
  assert.equal(r.reorderQty, 3);
  // không có doanh số => chỉ còn tồn an toàn, đặt lại tối thiểu bằng tồn tối thiểu
  assert.deepEqual(computeStockLevels({ sold: 0, days: 30, leadTimeDays: 7, safetyStock: 2, horizonDays: 30 }), {
    avgDaily: 0,
    minStockLevel: 2,
    reorderQty: 2,
  });
});

test('tiện ích tiền', () => {
  assert.equal(toCents(12.34), 1234);
  assert.equal(toCents(0.07), 7);
  assert.equal(round2(1.005 + 1e-9), 1.01);
});
