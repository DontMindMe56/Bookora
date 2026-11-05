import { query } from '../../db.js';
import { uuid } from '../../utils/security.js';
import { notFound, unprocessable } from '../../utils/errors.js';

/** Sách đã ngừng kinh doanh/ẩn vẫn nằm trong danh sách, kèm nhãn "Không còn bán". */
export async function getWishlist(customerId) {
  const rows = await query(
    `SELECT wl.editionId, wl.addedAt, e.isbn, e.format, e.listPrice, e.salePrice, e.businessStatus, e.coverImageUrl,
            w.workId, w.title, COALESCE(i.qtyAvailable, 0) AS qtyAvailable
       FROM Wishlist wl JOIN Edition e ON e.editionId = wl.editionId JOIN Work w ON w.workId = e.workId
       LEFT JOIN Inventory i ON i.editionId = e.editionId
      WHERE wl.customerId = ? ORDER BY wl.addedAt DESC`,
    [customerId],
  );
  const items = rows.map((r) => {
    const onSale = r.businessStatus === 'ON_SALE';
    return {
      editionId: r.editionId,
      workId: r.workId,
      title: r.title,
      isbn: r.isbn,
      format: r.format,
      coverImageUrl: r.coverImageUrl,
      unitPrice: r.salePrice ?? r.listPrice,
      listPrice: r.listPrice,
      addedAt: r.addedAt,
      available: onSale,
      inStock: onSale && r.qtyAvailable > 0,
      ...(onSale ? {} : { label: 'Không còn bán' }),
    };
  });
  return { items, total: items.length };
}

/** Thêm vào yêu thích (idempotent). Chỉ thêm được sách đang bán. */
export async function addToWishlist(customerId, editionId) {
  const [e] = await query('SELECT businessStatus FROM Edition WHERE editionId = ?', [editionId]);
  if (!e) throw notFound('Không tìm thấy sách');
  if (e.businessStatus !== 'ON_SALE') throw unprocessable('Sách không còn bán', 'EDITION_UNAVAILABLE');
  const r = await query('INSERT IGNORE INTO Wishlist (wishlistId, customerId, editionId) VALUES (?,?,?)', [uuid(), customerId, editionId]);
  return { editionId, added: r.affectedRows === 1 };
}

export async function removeFromWishlist(customerId, editionId) {
  const r = await query('DELETE FROM Wishlist WHERE customerId = ? AND editionId = ?', [customerId, editionId]);
  return { editionId, removed: r.affectedRows === 1 };
}
