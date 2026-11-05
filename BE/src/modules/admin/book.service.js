import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config.js';
import { query, withTx } from '../../db.js';
import { audit } from '../../services/audit.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { isValidIsbn13, normalizeIsbn, removeAccents } from '../../utils/text.js';
import { uuid } from '../../utils/security.js';

const COVER_DIR = path.join(config.uploadDir, 'covers');
const DEFAULT_COVER = path.join(COVER_DIR, 'default.webp');
const EDITION_FIELDS = ['format', 'pageCount', 'weightGram', 'lengthMm', 'widthMm', 'heightMm', 'publishedYear'];
const WORK_FIELDS = ['title', 'description', 'language', 'seriesId', 'volumeNo'];

export async function ensureDefaultCover() {
  await fs.mkdir(COVER_DIR, { recursive: true });
  try {
    await fs.access(DEFAULT_COVER);
    return;
  } catch {
    /* tạo mới */
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560"><rect width="400" height="560" fill="#e5e7eb"/><rect x="40" y="40" width="320" height="480" fill="none" stroke="#9ca3af" stroke-width="6"/><text x="200" y="300" font-size="40" text-anchor="middle" fill="#6b7280" font-family="sans-serif">No cover</text></svg>`;
  await sharp(Buffer.from(svg)).webp().toFile(DEFAULT_COVER);
}

async function findOrCreate(conn, table, idCol, name) {
  const [hit] = await query(`SELECT ${idCol} AS id FROM ${table} WHERE name = ? LIMIT 1`, [name], conn);
  if (hit) return hit.id;
  const id = uuid();
  await query(`INSERT INTO ${table} (${idCol}, name) VALUES (?,?)`, [id, name], conn);
  return id;
}

async function snapshot(conn, editionId) {
  const [e] = await query(
    `SELECT e.editionId, e.workId, e.isbn, e.format, e.pageCount, e.weightGram, e.lengthMm, e.widthMm, e.heightMm, e.publishedYear, p.name AS publisher,
            w.title, w.description, w.language, w.seriesId, w.volumeNo
       FROM Edition e JOIN Work w ON w.workId = e.workId JOIN Publisher p ON p.publisherId = e.publisherId WHERE e.editionId = ?`,
    [editionId],
    conn,
  );
  if (!e) return null;
  e.authors = (
    await query('SELECT a.name FROM WorkAuthor wa JOIN Author a ON a.authorId = wa.authorId WHERE wa.workId = ? ORDER BY a.name', [e.workId], conn)
  ).map((r) => r.name);
  e.categories = (
    await query('SELECT c.name FROM WorkCategory wc JOIN Category c ON c.categoryId = wc.categoryId WHERE wc.workId = ? ORDER BY c.name', [e.workId], conn)
  ).map((r) => r.name);
  return e;
}

export async function updateBookDetails(actor, editionId, d) {
  return withTx(async (conn) => {
    const [cur] = await query('SELECT workId FROM Edition WHERE editionId = ? FOR UPDATE', [editionId], conn);
    if (!cur) throw notFound('Không tìm thấy ấn bản');
    const before = await snapshot(conn, editionId);
    const set = (table, idCol, id, fields) => {
      const cols = fields.filter((f) => d[f] !== undefined);
      return cols.length
        ? query(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${idCol} = ?`, [...cols.map((c) => d[c]), id], conn)
        : null;
    };
    if (d.isbn !== undefined) {
      const isbn = normalizeIsbn(d.isbn);
      if (!isValidIsbn13(isbn)) throw unprocessable('ISBN-13 không hợp lệ', 'INVALID_ISBN');
      const [dup] = await query('SELECT editionId FROM Edition WHERE isbn = ? AND editionId <> ?', [isbn, editionId], conn);
      if (dup) throw conflict('ISBN đã tồn tại', 'ISBN_TAKEN');
      await query('UPDATE Edition SET isbn = ? WHERE editionId = ?', [isbn, editionId], conn);
    }
    if (d.publisher)
      await query(
        'UPDATE Edition SET publisherId = ? WHERE editionId = ?',
        [await findOrCreate(conn, 'Publisher', 'publisherId', d.publisher), editionId],
        conn,
      );
    await set('Edition', 'editionId', editionId, EDITION_FIELDS);
    await set('Work', 'workId', cur.workId, WORK_FIELDS);
    if (d.authors) {
      await query('DELETE FROM WorkAuthor WHERE workId = ?', [cur.workId], conn);
      for (const n of [...new Set(d.authors)])
        await query('INSERT INTO WorkAuthor (workId, authorId) VALUES (?,?)', [cur.workId, await findOrCreate(conn, 'Author', 'authorId', n)], conn);
    }
    if (d.categories) {
      await query('DELETE FROM WorkCategory WHERE workId = ?', [cur.workId], conn);
      for (const n of [...new Set(d.categories)])
        await query('INSERT INTO WorkCategory (workId, categoryId) VALUES (?,?)', [cur.workId, await findOrCreate(conn, 'Category', 'categoryId', n)], conn);
    }
    const after = await snapshot(conn, editionId);
    await query(
      'UPDATE Work SET searchText = ? WHERE workId = ?',
      [removeAccents(`${after.title} ${after.authors.join(' ')}`).toLowerCase(), cur.workId],
      conn,
    );
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE_DETAILS',
      entityType: 'EDITION',
      entityId: editionId,
      oldValue: before,
      newValue: after,
      reason: d.reason ?? null,
    });
    return after;
  });
}

export async function saveCover(actor, editionId, buffer) {
  const [e] = await query('SELECT editionId FROM Edition WHERE editionId = ?', [editionId]);
  if (!e) throw notFound('Không tìm thấy ấn bản');
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw unprocessable('Tệp không phải hình ảnh hợp lệ', 'INVALID_IMAGE');
  }
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw unprocessable('Chỉ chấp nhận ảnh JPG, PNG hoặc WebP', 'INVALID_IMAGE');
  await fs.mkdir(COVER_DIR, { recursive: true });
  const img = () => sharp(buffer).rotate();
  await img()
    .resize({ width: 800, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(path.join(COVER_DIR, `${editionId}.webp`));
  await img()
    .resize({ width: 200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(COVER_DIR, `${editionId}.thumb.webp`));
  const url = `/uploads/covers/${editionId}.webp?v=${Date.now()}`;
  await withTx(async (conn) => {
    const [old] = await query('SELECT coverImageUrl FROM Edition WHERE editionId = ?', [editionId], conn);
    await query('UPDATE Edition SET coverImageUrl = ? WHERE editionId = ?', [url, editionId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE_COVER',
      entityType: 'EDITION',
      entityId: editionId,
      oldValue: { coverImageUrl: old.coverImageUrl },
      newValue: { coverImageUrl: url },
    });
  });
  return { editionId, coverImageUrl: url, thumbnailUrl: `/uploads/covers/${editionId}.thumb.webp` };
}
