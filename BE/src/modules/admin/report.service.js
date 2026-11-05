import { query } from '../../db.js';
import { unprocessable } from '../../utils/errors.js';

const DAY = 86400_000;

export function range({ from, to }) {
  const end = to ? new Date(new Date(`${to}T00:00:00+07:00`).getTime() + DAY) : new Date();
  const start = from ? new Date(`${from}T00:00:00+07:00`) : new Date(end.getTime() - 30 * DAY);
  if (start >= end) throw unprocessable('Khoảng thời gian không hợp lệ', 'INVALID_RANGE');
  return [start, end];
}

const vn = (col) => `CONVERT_TZ(${col}, '+00:00', '+07:00')`;
const REFUNDED = `(SELECT COALESCE(SUM(r.amount), 0) FROM Refund r WHERE r.orderId = o.orderId AND r.status = 'REFUNDED' AND r.source = 'RETURN')`;

export async function revenueReport({ groupBy, ...r }) {
  const [start, end] = range(r);
  if (groupBy === 'category') {
    const rows = await query(
      `SELECT COALESCE((SELECT c.name FROM WorkCategory wc JOIN Category c ON c.categoryId = wc.categoryId WHERE wc.workId = e.workId ORDER BY c.name LIMIT 1), 'Chưa phân loại') AS \`group\`,
              SUM(oi.lineTotal) AS revenue, SUM(oi.lineTotal - COALESCE(oi.costPrice, 0) * oi.quantity) AS grossProfit, SUM(oi.quantity) AS units
         FROM Orders o JOIN OrderItem oi ON oi.orderId = o.orderId JOIN Edition e ON e.editionId = oi.editionId
        WHERE o.orderStatus = 'COMPLETED' AND o.completedAt >= ? AND o.completedAt < ? GROUP BY \`group\` ORDER BY revenue DESC`,
      [start, end],
    );
    return { groupBy, from: start, to: end, rows };
  }
  const fmt = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
  const rows = await query(
    `SELECT DATE_FORMAT(${vn('o.completedAt')}, '${fmt}') AS \`group\`, COUNT(*) AS orders,
            SUM(o.subtotal - o.discountAmount - ${REFUNDED}) AS revenue,
            SUM(items.profit - o.discountAmount - ${REFUNDED}) AS grossProfit
       FROM Orders o
       JOIN (SELECT orderId, SUM(lineTotal - COALESCE(costPrice, 0) * quantity) AS profit FROM OrderItem GROUP BY orderId) items ON items.orderId = o.orderId
      WHERE o.orderStatus = 'COMPLETED' AND o.completedAt >= ? AND o.completedAt < ? GROUP BY \`group\` ORDER BY \`group\``,
    [start, end],
  );
  return { groupBy, from: start, to: end, rows };
}

export async function bestSellers({ limit, ...r }) {
  const [start, end] = range(r);
  return query(
    `SELECT e.editionId, e.isbn, w.title, SUM(oi.quantity) AS units, SUM(oi.lineTotal) AS revenue
       FROM Orders o JOIN OrderItem oi ON oi.orderId = o.orderId JOIN Edition e ON e.editionId = oi.editionId JOIN Work w ON w.workId = e.workId
      WHERE o.orderStatus = 'COMPLETED' AND o.completedAt >= ? AND o.completedAt < ? GROUP BY e.editionId, e.isbn, w.title ORDER BY units DESC, e.editionId LIMIT ?`,
    [start, end, limit],
  );
}

export async function overview(r) {
  const [start, end] = range(r);
  const [c] = await query(
    `SELECT COUNT(*) AS total, SUM(orderStatus IN ('CANCELLED','EXPIRED')) AS cancelled, SUM(orderStatus IN ('RETURNED','RETURNED_TO_WAREHOUSE')) AS returned,
            SUM(orderStatus = 'COMPLETED') AS completed, AVG(CASE WHEN orderStatus = 'COMPLETED' THEN totalAmount END) AS avgOrderValue
       FROM Orders WHERE createdAt >= ? AND createdAt < ?`,
    [start, end],
  );
  const [s] = await query(
    `SELECT COALESCE(SUM(i.qtyOnHand), 0) AS unitsOnHand, COALESCE(SUM(i.qtyOnHand * e.costPrice), 0) AS stockValue,
            COALESCE(SUM(e.businessStatus = 'ON_SALE' AND i.qtyAvailable = 0), 0) AS outOfStock, COALESCE(SUM(i.qtyAvailable < i.minStockLevel), 0) AS belowMin
       FROM Inventory i JOIN Edition e ON e.editionId = i.editionId`,
  );
  const total = Number(c.total),
    pct = (n) => (total ? Math.round((Number(n ?? 0) / total) * 10000) / 100 : 0);
  return {
    from: start,
    to: end,
    orders: total,
    completed: Number(c.completed ?? 0),
    cancelRate: pct(c.cancelled),
    returnRate: pct(c.returned),
    avgOrderValue: Math.round(Number(c.avgOrderValue ?? 0)),
    inventory: {
      unitsOnHand: Number(s.unitsOnHand),
      stockValue: Math.round(Number(s.stockValue)),
      outOfStock: Number(s.outOfStock),
      belowMin: Number(s.belowMin),
    },
  };
}
