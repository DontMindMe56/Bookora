import { query } from '../db.js';

// Tham số nghiệp vụ lưu ở SystemParameter; cache 30s để đỡ truy vấn lặp.
let cache = new Map();
let loadedAt = 0;

async function load() {
  if (cache.size && Date.now() - loadedAt < 30_000) return;
  const rows = await query('SELECT paramKey, paramValue FROM SystemParameter');
  cache = new Map(rows.map((r) => [r.paramKey, r.paramValue]));
  loadedAt = Date.now();
}

async function getParam(key) {
  await load();
  if (!cache.has(key)) throw new Error(`Thiếu tham số hệ thống: ${key}`);
  return cache.get(key);
}
export const getInt = async (key) => parseInt(await getParam(key), 10);
export const getList = async (key) =>
  (await getParam(key))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export const invalidateParams = () => {
  loadedAt = 0;
};
