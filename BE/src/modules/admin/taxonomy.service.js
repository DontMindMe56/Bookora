import { query, withTx } from '../../db.js';
import { audit } from '../../services/audit.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { nameLike } from '../../utils/text.js';
import { uuid } from '../../utils/security.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 50;

export const TAXONOMY = {
  categories: {
    table: 'Category',
    id: 'categoryId',
    label: 'thể loại',
    fields: ['name', 'parentId', 'description'],
    usage: [
      ['WorkCategory', 'categoryId'],
      ['Category', 'parentId'],
      ['DiscountCodeCategory', 'categoryId'],
    ],
  },
  authors: { table: 'Author', id: 'authorId', label: 'tác giả', fields: ['name', 'biography'], usage: [['WorkAuthor', 'authorId']] },
  publishers: { table: 'Publisher', id: 'publisherId', label: 'nhà xuất bản', fields: ['name', 'address', 'phone'], usage: [['Edition', 'publisherId']] },
  series: { table: 'Series', id: 'seriesId', label: 'bộ sách', fields: ['name'], usage: [['Work', 'seriesId']] },
};

const pick = (def, d) => Object.fromEntries(def.fields.filter((f) => d[f] !== undefined).map((f) => [f, d[f]]));

async function checkCategory(conn, def, id, d) {
  if (def.table !== 'Category' || d.parentId == null) return;
  if (d.parentId === id) throw unprocessable('Thể loại không thể là cha của chính nó', 'INVALID_PARENT');
  const [p] = await query('SELECT parentId FROM Category WHERE categoryId = ?', [d.parentId], conn);
  if (!p) throw notFound('Không tìm thấy thể loại cha');
  if (p.parentId) throw unprocessable('Chỉ hỗ trợ hai cấp thể loại', 'INVALID_PARENT');
  if (id) {
    const [{ n }] = await query('SELECT COUNT(*) AS n FROM Category WHERE parentId = ?', [id], conn);
    if (n) throw unprocessable('Thể loại đang có thể loại con nên không thể trở thành thể loại con', 'INVALID_PARENT');
  }
}

export async function listItems(def, { q, page }) {
  const n = q ? nameLike(['name'], q) : null;
  const where = q ? `WHERE ${n.sql}` : '',
    params = q ? n.params : [];
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM ${def.table} ${where}`, params);
  const items = await query(`SELECT * FROM ${def.table} ${where} ORDER BY name LIMIT ? OFFSET ?`, [...params, ...limitOffset(page, PAGE_SIZE)]);
  return paged(items, total, page, PAGE_SIZE);
}

export async function createItem(actor, def, d) {
  const id = uuid();
  return withTx(async (conn) => {
    await checkCategory(conn, def, null, d);
    const row = pick(def, d);
    const [dup] = await query(
      `SELECT 1 FROM ${def.table} WHERE name = ? ${def.table === 'Category' ? 'AND parentId <=> ?' : ''}`,
      def.table === 'Category' ? [d.name, d.parentId ?? null] : [d.name],
      conn,
    );
    if (dup) throw conflict(`Tên ${def.label} đã tồn tại`, 'NAME_TAKEN');
    await query(
      `INSERT INTO ${def.table} (${def.id}, ${Object.keys(row).join(',')}) VALUES (?, ${Object.keys(row)
        .map(() => '?')
        .join(',')})`,
      [id, ...Object.values(row)],
      conn,
    );
    await audit(conn, { actorId: actor.accountId, action: 'CREATE', entityType: def.table.toUpperCase(), entityId: id, newValue: row });
    return { [def.id]: id, ...row };
  });
}

export async function updateItem(actor, def, id, d) {
  return withTx(async (conn) => {
    const [cur] = await query(`SELECT * FROM ${def.table} WHERE ${def.id} = ? FOR UPDATE`, [id], conn);
    if (!cur) throw notFound(`Không tìm thấy ${def.label}`);
    await checkCategory(conn, def, id, d);
    const row = pick(def, d);
    if (row.name !== undefined) {
      const parent = def.table === 'Category' ? (row.parentId !== undefined ? row.parentId : cur.parentId) : undefined;
      const [dup] = await query(
        `SELECT 1 FROM ${def.table} WHERE name = ? AND ${def.id} <> ? ${def.table === 'Category' ? 'AND parentId <=> ?' : ''}`,
        def.table === 'Category' ? [row.name, id, parent ?? null] : [row.name, id],
        conn,
      );
      if (dup) throw conflict(`Tên ${def.label} đã tồn tại`, 'NAME_TAKEN');
    }
    const keys = Object.keys(row);
    if (keys.length) await query(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${def.id} = ?`, [...Object.values(row), id], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE',
      entityType: def.table.toUpperCase(),
      entityId: id,
      oldValue: Object.fromEntries(keys.map((k) => [k, cur[k]])),
      newValue: row,
    });
    return { ...cur, ...row };
  });
}

export async function deleteItem(actor, def, id) {
  return withTx(async (conn) => {
    const [cur] = await query(`SELECT * FROM ${def.table} WHERE ${def.id} = ? FOR UPDATE`, [id], conn);
    if (!cur) throw notFound(`Không tìm thấy ${def.label}`);
    for (const [table, col] of def.usage) {
      const [{ n }] = await query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, [id], conn);
      if (n) throw conflict(`Không thể xóa ${def.label} đang được sử dụng`, 'IN_USE', { usedBy: table, count: n });
    }
    await query(`DELETE FROM ${def.table} WHERE ${def.id} = ?`, [id], conn);
    await audit(conn, { actorId: actor.accountId, action: 'DELETE', entityType: def.table.toUpperCase(), entityId: id, oldValue: cur });
    return { deleted: true };
  });
}
