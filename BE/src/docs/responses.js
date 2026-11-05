import { z } from 'zod';

const id = z.string().uuid();
const money = z.number().int();
const dt = z.string().datetime();
const paged = (item) =>
  z.object({ items: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });

const cartItem = z.object({
  editionId: id,
  workId: id,
  title: z.string(),
  isbn: z.string(),
  format: z.string(),
  coverImageUrl: z.string(),
  quantity: z.number().int(),
  unitPrice: money,
  listPrice: money,
  lineTotal: money,
  purchasable: z.boolean(),
  issues: z.array(z.object({ code: z.enum(['UNAVAILABLE', 'OUT_OF_STOCK', 'INSUFFICIENT_STOCK', 'PRICE_CHANGED']), message: z.string() }).passthrough()),
});
const cart = z.object({ items: z.array(cartItem), subtotal: money, itemCount: z.number().int() });

const quote = z.object({
  items: z.array(z.object({ editionId: id, title: z.string(), quantity: z.number().int(), unitPrice: money, listPrice: money, lineTotal: money })),
  subtotal: money,
  discount: z.object({ discountCodeId: id, code: z.string(), amount: money }).nullable(),
  discountAmount: money,
  ghnFee: money,
  shippingFee: money,
  freeShipping: z.boolean(),
  freeShippingThreshold: money,
  total: money,
  weightGram: z.number().int(),
  paymentMethods: z.array(
    z.object({ method: z.enum(['COD', 'SEPAY', 'VNPAY']), available: z.boolean(), code: z.string().optional(), reason: z.string().optional() }),
  ),
  address: z.object({
    addressId: id,
    receiverName: z.string(),
    phone: z.string(),
    detail: z.string(),
    province: z.string(),
    district: z.string(),
    ward: z.string(),
    ghnProvinceId: z.number().int(),
    ghnDistrictId: z.number().int(),
    ghnWardCode: z.string(),
  }),
});

const orderStatus = z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'PACKING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RETURNED', 'RETURNED_TO_WAREHOUSE']);
const paymentStatus = z.enum(['UNPAID', 'PAID', 'COD_COLLECTED', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED']);
const shippingStatus = z.enum(['NOT_CREATED', 'WAITING_PICKUP', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETURNING', 'RETURNED', 'CANCELLED', 'LOST', 'DAMAGED']);
const orderSummary = z.object({
  orderId: id,
  orderCode: z.string(),
  orderStatus,
  paymentStatus,
  shippingStatus,
  paymentMethod: z.enum(['COD', 'SEPAY', 'VNPAY']),
  totalAmount: money,
  paymentExpiresAt: dt.nullable(),
  createdAt: dt,
  itemCount: z.number().int(),
  firstTitle: z.string().nullable(),
});
const order = z
  .object({
    orderId: id,
    orderCode: z.string(),
    orderStatus,
    paymentStatus,
    shippingStatus,
    subtotal: money,
    discountAmount: money,
    shippingFee: money,
    totalAmount: money,
    paymentMethod: z.enum(['COD', 'SEPAY', 'VNPAY']),
    discountCode: z.string().nullable(),
    shippingAddressSnapshot: z.record(z.any()),
    note: z.string().nullable(),
    paymentExpiresAt: dt.nullable(),
    cancelReason: z.string().nullable(),
    createdAt: dt,
    items: z.array(
      z.object({
        editionId: id,
        workId: id,
        title: z.string(),
        isbn: z.string(),
        coverImageUrl: z.string(),
        quantity: z.number().int(),
        unitPrice: money,
        lineTotal: money,
      }),
    ),
    shipments: z.array(z.object({ direction: z.string(), status: z.string(), ghnOrderCode: z.string().nullable(), createdAt: dt })),
  })
  .passthrough();
const orderCreated = order.extend({ replayed: z.boolean().describe('true nếu gửi lại cùng Idempotency-Key (HTTP 200, không tạo đơn mới)') });

const bookItem = z.object({
  workId: id,
  title: z.string(),
  authors: z.array(z.string()),
  editionId: id,
  format: z.string(),
  coverImageUrl: z.string(),
  listPrice: money,
  salePrice: money.nullable(),
  price: money,
  inStock: z.boolean(),
});
const bookList = paged(bookItem).extend({ suggestions: z.array(bookItem).optional().describe('Chỉ có khi không tìm thấy kết quả: sách bán chạy') });
const bookDetail = z.object({
  workId: id,
  title: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  seriesId: id.nullable(),
  volumeNo: z.number().int().nullable(),
  authors: z.array(z.object({ authorId: id, name: z.string() })),
  categories: z.array(z.object({ categoryId: id, name: z.string() })),
  rating: z.object({ average: z.number().nullable(), count: z.number().int() }),
  editions: z.array(
    z.object({
      editionId: id,
      isbn: z.string(),
      format: z.string(),
      listPrice: money,
      salePrice: money.nullable(),
      price: money,
      pageCount: z.number().int().nullable(),
      publishedYear: z.number().int().nullable(),
      coverImageUrl: z.string(),
      businessStatus: z.enum(['ON_SALE', 'DISCONTINUED']),
      weightGram: z.number().int(),
      publisherId: id,
      publisherName: z.string(),
      discontinued: z.boolean(),
      inStock: z.boolean(),
      canBuy: z.boolean(),
    }),
  ),
  seriesVolumes: z.array(z.object({ workId: id, title: z.string(), volumeNo: z.number().int().nullable() })),
  related: z.array(z.object({ workId: id, title: z.string(), price: money, coverImageUrl: z.string() })),
});

export const RESPONSES = {
  'get /api/cart': [200, cart],
  'post /api/cart/items': [201, cart],
  'patch /api/cart/items/{editionId}': [200, cart],
  'delete /api/cart/items/{editionId}': [200, cart],
  'post /api/checkout/quote': [200, quote],
  'post /api/orders': [201, orderCreated],
  'get /api/orders': [200, paged(orderSummary)],
  'get /api/orders/{orderId}': [200, order],
  'get /api/staff/orders/{orderId}': [200, order],
  'get /api/books': [200, bookList],
  'get /api/books/{workId}': [200, bookDetail],
};
