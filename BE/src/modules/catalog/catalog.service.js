import { query, withTx } from '../../db.js';
import { audit } from '../../services/audit.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import { uuid } from '../../utils/security.js';
import { escapeLike, foldD, isValidIsbn13, normalizeIsbn, removeAccents } from '../../utils/text.js';
import { limitOffset, paged } from '../../utils/pagination.js';

const PAGE_SIZE = 20;

// ===================== TÌM KIẾM / LỌC =====================
export async function searchBooks(f) {
  if (f.minPrice != null && f.maxPrice != null && f.minPrice > f.maxPrice)
    throw badRequest('Giá thấp nhất không được lớn hơn giá cao nhất', 'INVALID_PRICE_RANGE');

  const where = [`e.businessStatus = 'ON_SALE'`]; // Ẩn / Ngừng kinh doanh không xuất hiện trong danh sách
  const params = [];
  if (f.q) {
    // Collation utf8mb4_0900_ai_ci bỏ qua hoa/thường và dấu, nhưng có thể coi đ/Đ là chữ riêng (không khớp d) => không dựa vào collation:
    // tên sách + tác giả tìm trên Work.searchText (đã bỏ dấu, đ -> d, chữ thường) với từ khóa cũng được chuẩn hóa như vậy;
    // title LIKE giữ lại cho dòng cũ chưa có searchText; nhà xuất bản / tác giả đệm thêm REPLACE đ -> d.
    const q = f.q.trim();
    const like = `%${escapeLike(q)}%`;
    const plain = `%${escapeLike(removeAccents(q).toLowerCase())}%`;
    let cond = `w.searchText LIKE ? OR w.title LIKE ? OR ${foldD('p.name')} LIKE ? OR EXISTS (SELECT 1 FROM WorkAuthor wa JOIN Author a ON a.authorId = wa.authorId WHERE wa.workId = w.workId AND (a.name LIKE ? OR ${foldD('a.name')} LIKE ?))`;
    params.push(plain, like, plain, like, plain);
    if (/^[\d\-\s]{4,}$/.test(f.q)) {
      cond += ` OR e.isbn LIKE ?`;
      params.push(`%${normalizeIsbn(f.q)}%`);
    }
    where.push(`(${cond})`);
  }
  if (f.categoryId) {
    where.push(`EXISTS (SELECT 1 FROM WorkCategory wc WHERE wc.workId = w.workId
                 AND wc.categoryId IN (SELECT categoryId FROM Category WHERE categoryId = ? OR parentId = ?))`);
    params.push(f.categoryId, f.categoryId);
  }
  if (f.publisherId) {
    where.push('e.publisherId = ?');
    params.push(f.publisherId);
  }
  if (f.format) {
    where.push('e.format = ?');
    params.push(f.format);
  }
  if (f.minPrice != null) {
    where.push('COALESCE(e.salePrice, e.listPrice) >= ?');
    params.push(f.minPrice);
  }
  if (f.maxPrice != null) {
    where.push('COALESCE(e.salePrice, e.listPrice) <= ?');
    params.push(f.maxPrice);
  }
  const whereSql = where.join(' AND ');

  const orderBy = {
    price_asc: 'price ASC, workId',
    price_desc: 'price DESC, workId',
    newest: 'workCreatedAt DESC, workId',
    bestseller: 'workSold DESC, workCreatedAt DESC, workId',
  }[f.sort || 'newest'];

  // Mỗi tác phẩm hiển thị 1 dòng, đại diện bởi ấn bản có giá thấp nhất
  const rows = await query(
    `WITH cand AS (
       SELECT w.workId, w.title, w.createdAt AS workCreatedAt, e.editionId, e.format, COALESCE(e.coverImageUrl, '/uploads/covers/default.webp') AS coverImageUrl, e.listPrice, e.salePrice,
              COALESCE(e.salePrice, e.listPrice) AS price, COALESCE(i.qtyAvailable, 0) AS qtyAvailable,
              SUM(COALESCE(bs.sold, 0)) OVER (PARTITION BY w.workId) AS workSold,
              ROW_NUMBER() OVER (PARTITION BY w.workId ORDER BY COALESCE(e.salePrice, e.listPrice), e.editionId) AS rn
         FROM Edition e
         JOIN Work w ON w.workId = e.workId
         JOIN Publisher p ON p.publisherId = e.publisherId
         LEFT JOIN Inventory i ON i.editionId = e.editionId
         LEFT JOIN (SELECT oi.editionId, SUM(oi.quantity) AS sold
                      FROM OrderItem oi JOIN Orders o ON o.orderId = oi.orderId
                     WHERE o.orderStatus = 'COMPLETED' AND o.completedAt >= NOW() - INTERVAL 30 DAY
                     GROUP BY oi.editionId) bs ON bs.editionId = e.editionId
        WHERE ${whereSql})
     SELECT * FROM cand WHERE rn = 1 ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, ...limitOffset(f.page, PAGE_SIZE)],
  );

  const [{ total }] = await query(
    `SELECT COUNT(DISTINCT w.workId) AS total FROM Edition e JOIN Work w ON w.workId = e.workId
       JOIN Publisher p ON p.publisherId = e.publisherId WHERE ${whereSql}`,
    params,
  );

  const authors = rows.length
    ? await query(`SELECT wa.workId, a.name FROM WorkAuthor wa JOIN Author a ON a.authorId = wa.authorId WHERE wa.workId IN (?)`, [rows.map((r) => r.workId)])
    : [];
  const authorMap = new Map();
  for (const a of authors) authorMap.set(a.workId, [...(authorMap.get(a.workId) || []), a.name]);

  const items = rows.map((r) => ({
    workId: r.workId,
    title: r.title,
    authors: authorMap.get(r.workId) || [],
    editionId: r.editionId,
    format: r.format,
    coverImageUrl: r.coverImageUrl,
    listPrice: r.listPrice,
    salePrice: r.salePrice,
    price: r.price,
    inStock: r.qtyAvailable > 0,
  }));

  let suggestions;
  if (!items.length && !f.noSuggest) {
    // Không có kết quả => gợi ý sách bán chạy
    suggestions = (await searchBooks({ sort: 'bestseller', page: 1, noSuggest: true })).items.slice(0, 8);
  }
  return { ...paged(items, total, f.page, PAGE_SIZE), ...(suggestions ? { suggestions } : {}) };
}

// ===================== CHI TIẾT =====================
export async function getWorkDetail(workId) {
  const [work] = await query('SELECT workId, title, description, language, seriesId, volumeNo, createdAt FROM Work WHERE workId = ?', [workId]);
  if (!work) throw notFound('Không tìm thấy sách');

  // Ấn bản Ẩn không truy cập được; Ngừng kinh doanh vẫn xem được (kèm nhãn, không có nút mua)
  const editions = await query(
    `SELECT e.editionId, e.isbn, e.format, e.listPrice, e.salePrice, e.pageCount, e.publishedYear, COALESCE(e.coverImageUrl, '/uploads/covers/default.webp') AS coverImageUrl, e.businessStatus,
            e.weightGram, p.publisherId, p.name AS publisherName, COALESCE(i.qtyAvailable, 0) AS qtyAvailable
       FROM Edition e JOIN Publisher p ON p.publisherId = e.publisherId LEFT JOIN Inventory i ON i.editionId = e.editionId
      WHERE e.workId = ? AND e.businessStatus IN ('ON_SALE','DISCONTINUED') ORDER BY e.listPrice`,
    [workId],
  );
  if (!editions.length) throw notFound('Không tìm thấy sách');

  const [authors, categories, rating, series, related] = await Promise.all([
    query('SELECT a.authorId, a.name FROM WorkAuthor wa JOIN Author a ON a.authorId = wa.authorId WHERE wa.workId = ?', [workId]),
    query('SELECT c.categoryId, c.name FROM WorkCategory wc JOIN Category c ON c.categoryId = wc.categoryId WHERE wc.workId = ?', [workId]),
    query(
      `SELECT ROUND(AVG(r.rating), 1) AS average, COUNT(*) AS count FROM Review r JOIN Edition e ON e.editionId = r.editionId
            WHERE e.workId = ? AND r.status = 'VISIBLE'`,
      [workId],
    ),
    work.seriesId
      ? query(
          `SELECT w.workId, w.title, w.volumeNo FROM Work w WHERE w.seriesId = ? AND w.workId <> ?
                 AND EXISTS (SELECT 1 FROM Edition e WHERE e.workId = w.workId AND e.businessStatus IN ('ON_SALE','DISCONTINUED'))
                ORDER BY w.volumeNo`,
          [work.seriesId, workId],
        )
      : [],
    query(
      `SELECT w.workId, w.title, MIN(COALESCE(e.salePrice, e.listPrice)) AS price, ANY_VALUE(COALESCE(e.coverImageUrl, '/uploads/covers/default.webp')) AS coverImageUrl
             FROM Work w JOIN Edition e ON e.workId = w.workId AND e.businessStatus = 'ON_SALE'
            WHERE w.workId <> ? AND (
                  EXISTS (SELECT 1 FROM WorkAuthor a1 JOIN WorkAuthor a2 ON a1.authorId = a2.authorId WHERE a1.workId = w.workId AND a2.workId = ?)
               OR EXISTS (SELECT 1 FROM WorkCategory c1 JOIN WorkCategory c2 ON c1.categoryId = c2.categoryId WHERE c1.workId = w.workId AND c2.workId = ?))
            GROUP BY w.workId, w.title LIMIT 8`,
      [workId, workId, workId],
    ),
  ]);

  return {
    ...work,
    authors,
    categories,
    rating: { average: rating[0].average, count: rating[0].count },
    editions: editions.map(({ qtyAvailable, businessStatus, ...e }) => ({
      ...e,
      price: e.salePrice ?? e.listPrice,
      businessStatus,
      discontinued: businessStatus === 'DISCONTINUED',
      inStock: businessStatus === 'ON_SALE' && qtyAvailable > 0,
      canBuy: businessStatus === 'ON_SALE' && qtyAvailable > 0,
    })),
    seriesVolumes: series,
    related,
  };
}

export const listCategories = () => query('SELECT categoryId, name, parentId, description FROM Category ORDER BY name');

// ===================== QUẢN TRỊ ẤN BẢN =====================
async function findOrCreate(conn, table, idCol, name, extra = {}) {
  const [hit] = await query(`SELECT ${idCol} AS id FROM ${table} WHERE name = ? LIMIT 1`, [name], conn); // ai_ci => ghép không dấu
  if (hit) return hit.id;
  const id = uuid();
  const cols = ['name', ...Object.keys(extra)];
  await query(`INSERT INTO ${table} (${idCol}, ${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`, [id, name, ...Object.values(extra)], conn);
  return id;
}

export async function createEdition(actor, d) {
  const isbn = normalizeIsbn(d.isbn);
  if (!isValidIsbn13(isbn)) throw unprocessable('ISBN-13 không hợp lệ', 'INVALID_ISBN');
  if (d.salePrice != null && d.salePrice >= d.listPrice) throw unprocessable('Giá khuyến mãi phải nhỏ hơn giá niêm yết', 'INVALID_SALE_PRICE');

  return withTx(async (conn) => {
    const [dup] = await query('SELECT editionId FROM Edition WHERE isbn = ?', [isbn], conn);
    if (dup) throw conflict('ISBN đã tồn tại', 'ISBN_TAKEN');

    const publisherId = await findOrCreate(conn, 'Publisher', 'publisherId', d.publisher.trim());

    let workId = d.workId;
    if (workId) {
      const [w] = await query('SELECT workId FROM Work WHERE workId = ?', [workId], conn);
      if (!w) throw notFound('Không tìm thấy tác phẩm', 'WORK_NOT_FOUND');
    } else {
      workId = uuid();
      const authorNames = [...new Set(d.authors.map((a) => a.trim()).filter(Boolean))];
      await query(
        `INSERT INTO Work (workId, title, description, language, seriesId, volumeNo, searchText) VALUES (?,?,?,?,?,?,?)`,
        [
          workId,
          d.title.trim(),
          d.description ?? null,
          d.language ?? null,
          d.seriesId ?? null,
          d.volumeNo ?? null,
          removeAccents(`${d.title} ${authorNames.join(' ')}`).toLowerCase(),
        ],
        conn,
      );
      for (const name of authorNames) {
        const authorId = await findOrCreate(conn, 'Author', 'authorId', name);
        await query('INSERT IGNORE INTO WorkAuthor (workId, authorId) VALUES (?,?)', [workId, authorId], conn);
      }
      for (const name of [...new Set(d.categories.map((c) => c.trim()).filter(Boolean))]) {
        const categoryId = await findOrCreate(conn, 'Category', 'categoryId', name);
        await query('INSERT IGNORE INTO WorkCategory (workId, categoryId) VALUES (?,?)', [workId, categoryId], conn);
      }
    }

    const editionId = uuid();
    await query(
      `INSERT INTO Edition (editionId, workId, publisherId, isbn, format, listPrice, salePrice, pageCount, weightGram,
                            lengthMm, widthMm, heightMm, coverImageUrl, businessStatus, publishedYear)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        editionId,
        workId,
        publisherId,
        isbn,
        d.format,
        d.listPrice,
        d.salePrice ?? null,
        d.pageCount ?? null,
        d.weightGram,
        d.lengthMm ?? null,
        d.widthMm ?? null,
        d.heightMm ?? null,
        d.coverImageUrl ?? null,
        d.businessStatus,
        d.publishedYear ?? null,
      ],
      conn,
    );
    await query('INSERT INTO Inventory (editionId) VALUES (?)', [editionId], conn);
    await audit(conn, {
      actorId: actor.accountId,
      action: 'CREATE',
      entityType: 'EDITION',
      entityId: editionId,
      newValue: { isbn, listPrice: d.listPrice, businessStatus: d.businessStatus },
    });
    return { editionId, workId, isbn };
  });
}

/** Sửa giá / trạng thái kinh doanh, ghi lịch sử (giá trước và sau, lý do). Đơn đã tạo giữ nguyên đơn giá. */
export async function updateEdition(actor, editionId, patch, reason) {
  return withTx(async (conn) => {
    const [cur] = await query(
      'SELECT listPrice, salePrice, salePromotionId, costPrice, businessStatus FROM Edition WHERE editionId = ? FOR UPDATE',
      [editionId],
      conn,
    );
    if (!cur) throw notFound('Không tìm thấy ấn bản');
    const { salePromotionId: curPromo, ...curPrices } = cur;
    const next = { ...curPrices, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    // Giá KM đang do chiến dịch quản lý: admin nhập giá tay => thành giá nhập tay (job không gỡ nữa);
    // chỉ đổi giá niêm yết => bỏ giá KM cũ, job khuyến mãi tính lại theo giá niêm yết mới (trong vòng 1 phút).
    let salePromotionId = curPromo;
    if (patch.salePrice !== undefined) salePromotionId = null;
    else if (curPromo && patch.listPrice !== undefined && patch.listPrice !== cur.listPrice) {
      next.salePrice = null;
      salePromotionId = null;
    }
    if (next.salePrice != null && next.salePrice >= next.listPrice) throw unprocessable('Giá khuyến mãi phải nhỏ hơn giá niêm yết', 'INVALID_SALE_PRICE');
    await query(
      'UPDATE Edition SET listPrice=?, salePrice=?, salePromotionId=?, businessStatus=? WHERE editionId=?',
      [next.listPrice, next.salePrice, salePromotionId, next.businessStatus, editionId],
      conn,
    );
    await audit(conn, {
      actorId: actor.accountId,
      action: 'UPDATE',
      entityType: 'EDITION',
      entityId: editionId,
      oldValue: { listPrice: cur.listPrice, salePrice: cur.salePrice, businessStatus: cur.businessStatus },
      newValue: { listPrice: next.listPrice, salePrice: next.salePrice, businessStatus: next.businessStatus },
      reason,
    });
    // Cảnh báo (không chặn) khi giá bán thấp hơn giá vốn bình quân
    const warnings = [];
    if (cur.costPrice > 0 && (next.salePrice ?? next.listPrice) < cur.costPrice) warnings.push('Giá bán thấp hơn giá vốn bình quân');
    return { editionId, ...next, warnings };
  });
}
