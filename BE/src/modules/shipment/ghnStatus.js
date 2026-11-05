const MAP = {
  ready_to_pick: 'WAITING_PICKUP',
  picking: 'WAITING_PICKUP',
  money_collect_picking: 'WAITING_PICKUP',
  picked: 'DELIVERING',
  storing: 'DELIVERING',
  transporting: 'DELIVERING',
  sorting: 'DELIVERING',
  delivering: 'DELIVERING',
  money_collect_delivering: 'DELIVERING',
  delivered: 'DELIVERED',
  delivery_fail: 'FAILED',
  waiting_to_return: 'RETURNING',
  return: 'RETURNING',
  return_transporting: 'RETURNING',
  return_sorting: 'RETURNING',
  returning: 'RETURNING',
  return_fail: 'RETURNING',
  returned: 'RETURNED',
  cancel: 'CANCELLED',
  lost: 'LOST',
  damage: 'DAMAGED',
  scrap: 'LOST',
};
const RANK = { CREATED: 0, WAITING_PICKUP: 1, DELIVERING: 2, FAILED: 3, RETURNING: 4, RETURNED: 5, DELIVERED: 5, CANCELLED: 6, LOST: 6, DAMAGED: 6 };
export const TERMINAL = ['DELIVERED', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED'];

export const mapGhnStatus = (s) => MAP[String(s ?? '').toLowerCase()] ?? null;

export function shouldApply({ current, next, lastEventAt, eventAt }) {
  if (TERMINAL.includes(current)) return false;
  if (!lastEventAt) return true;
  const a = Math.floor(eventAt.getTime() / 1000),
    b = Math.floor(lastEventAt.getTime() / 1000);
  return a > b || (a === b && RANK[next] > RANK[current]);
}
