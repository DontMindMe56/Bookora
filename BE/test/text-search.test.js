import test from 'node:test';
import assert from 'node:assert/strict';
import { accentPattern, foldD, nameLike } from '../src/utils/text.js';

test('accentPattern: bỏ dấu kể cả đ, giữ nguyên ký tự đặc biệt của LIKE đã escape', () => {
  assert.equal(accentPattern(' Đắc nhân tâm '), '%Dac nhan tam%');
  assert.equal(accentPattern('đinh'), '%dinh%');
  assert.equal(accentPattern('100%_'), '%100\\%\\_%');
});

test('foldD: đổi đ/Đ trong cột thành d/D', () => {
  assert.equal(foldD('w.title'), "REPLACE(REPLACE(w.title, 'đ', 'd'), 'Đ', 'D')");
});

test('nameLike: một placeholder và một tham số cho mỗi cột, đã bọc ngoặc', () => {
  const { sql, params } = nameLike(['w.title', 'r.comment'], 'Đắc nhân');
  assert.equal(sql.match(/\?/g).length, 2);
  assert.deepEqual(params, ['%Dac nhan%', '%Dac nhan%']);
  assert.ok(sql.startsWith('(') && sql.endsWith(')'));
  assert.ok(sql.includes('w.title') && sql.includes('r.comment'));
});
