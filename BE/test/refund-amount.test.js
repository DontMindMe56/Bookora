import test from 'node:test';
import assert from 'node:assert/strict';
import { refundableAmount } from '../src/modules/refund/amount.js';

test('chuyển đủ tiền: hoàn đúng giá trị đơn', () => {
  assert.equal(refundableAmount({ amount: 200_000, totalAmount: 200_000 }), 200_000);
});

test('chuyển dư đã có khoản OVERPAID: hủy đơn chỉ hoàn giá trị đơn, không hoàn lại phần dư lần nữa', () => {
  assert.equal(refundableAmount({ amount: 250_000, totalAmount: 200_000, overpaidRefunded: 50_000 }), 200_000);
});

test('chuyển dư nhưng chưa có khoản OVERPAID: không vượt giá trị đơn', () => {
  assert.equal(refundableAmount({ amount: 250_000, totalAmount: 200_000 }), 200_000);
});

test('không âm', () => {
  assert.equal(refundableAmount({ amount: 10, totalAmount: 100, overpaidRefunded: 50 }), 0);
});
