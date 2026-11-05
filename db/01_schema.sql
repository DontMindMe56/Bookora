-- =====================================================================
-- HỆ THỐNG WEB BÁN SÁCH - SCHEMA (MySQL 8.0.16+)
-- Bám theo Chương 5 SRS; các bảng/cột bổ sung được đánh dấu [+]
-- Quy ước: UUID sinh ở tầng ứng dụng (CHAR(36)), thời gian lưu UTC,
--          tiền là số nguyên đồng (DECIMAL(18,0)).
-- =====================================================================
DROP DATABASE IF EXISTS bookstore;
CREATE DATABASE bookstore CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE bookstore;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. TÀI KHOẢN & PHÂN QUYỀN
-- ---------------------------------------------------------------------
CREATE TABLE Account (
  accountId       CHAR(36)     NOT NULL,
  email           VARCHAR(100) NOT NULL,                 -- ai_ci => không phân biệt hoa thường
  passwordHash    VARCHAR(255) NULL,
  role            VARCHAR(20)  NOT NULL DEFAULT 'CUSTOMER',
  status          VARCHAR(20)  NOT NULL DEFAULT 'UNVERIFIED',
  emailVerifiedAt DATETIME     NULL,
  googleId        VARCHAR(100) NULL,
  lastLoginAt     DATETIME     NULL,
  termsAcceptedAt DATETIME     NULL,                     -- [+] thời điểm đồng ý chính sách dữ liệu
  lockReason      VARCHAR(255) NULL,                     -- [+]
  deletedAt       DATETIME     NULL,                     -- [+] xóa tài khoản & dữ liệu cá nhân (ẩn danh)
  createdAt       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (accountId),
  UNIQUE KEY uq_account_email (email),
  UNIQUE KEY uq_account_google (googleId),
  CONSTRAINT ck_account_role   CHECK (role   IN ('CUSTOMER','STAFF','ADMIN')),
  CONSTRAINT ck_account_status CHECK (status IN ('ACTIVE','UNVERIFIED','LOCKED')),
  CONSTRAINT ck_account_cred   CHECK (passwordHash IS NOT NULL OR googleId IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE Customer (
  customerId     CHAR(36)      NOT NULL,
  accountId      CHAR(36)      NOT NULL,
  fullName       VARCHAR(100)  NOT NULL,
  phone          VARCHAR(15)   NULL,
  dateOfBirth    DATE          NULL,
  gender         VARCHAR(10)   NULL,
  accountBalance DECIMAL(18,0) NOT NULL DEFAULT 0,
  riskFlag       BOOLEAN       NOT NULL DEFAULT FALSE,
  createdAt      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customerId),
  UNIQUE KEY uq_customer_account (accountId),
  KEY ix_customer_phone (phone),
  CONSTRAINT fk_customer_account FOREIGN KEY (accountId) REFERENCES Account(accountId),
  CONSTRAINT ck_customer_balance CHECK (accountBalance >= 0),
  CONSTRAINT ck_customer_gender  CHECK (gender IS NULL OR gender IN ('Nam','Nữ','Khác'))
) ENGINE=InnoDB;

CREATE TABLE Staff (
  staffId   CHAR(36)     NOT NULL,
  accountId CHAR(36)     NOT NULL,
  fullName  VARCHAR(100) NOT NULL,
  phone     VARCHAR(15)  NULL,
  position  VARCHAR(50)  NOT NULL,                       -- Nhân viên kho / Quản trị viên
  createdAt DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (staffId),
  UNIQUE KEY uq_staff_account (accountId),
  CONSTRAINT fk_staff_account FOREIGN KEY (accountId) REFERENCES Account(accountId)
) ENGINE=InnoDB;

-- [+] Token dùng một lần: xác thực email, đặt lại mật khẩu, đặt mật khẩu lần đầu, xóa tài khoản, nhập tài khoản hoàn tiền
CREATE TABLE AuthToken (
  tokenId     CHAR(36)    NOT NULL,
  accountId   CHAR(36)    NOT NULL,
  tokenType   VARCHAR(30) NOT NULL,
  tokenHash   CHAR(64)    NOT NULL,                      -- SHA-256 của token, không lưu token gốc
  expiresAt   DATETIME    NOT NULL,
  usedAt      DATETIME    NULL,
  revokedAt   DATETIME    NULL,                          -- khi yêu cầu link mới, link cũ mất hiệu lực
  createdAt   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tokenId),
  UNIQUE KEY uq_token_hash (tokenHash),
  KEY ix_token_account (accountId, tokenType),
  CONSTRAINT fk_token_account FOREIGN KEY (accountId) REFERENCES Account(accountId),
  CONSTRAINT ck_token_type CHECK (tokenType IN
    ('VERIFY_EMAIL','RESET_PASSWORD','SET_PASSWORD','DELETE_ACCOUNT','CHANGE_EMAIL'))
) ENGINE=InnoDB;

-- [+] Phiên đăng nhập (để hủy phiên khi đổi mật khẩu/khóa tài khoản)
CREATE TABLE UserSession (
  sessionId    CHAR(36)     NOT NULL,
  accountId    CHAR(36)     NOT NULL,
  ipAddress    VARCHAR(45)  NULL,
  userAgent    VARCHAR(255) NULL,
  lastActiveAt DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiresAt    DATETIME     NOT NULL,
  revokedAt    DATETIME     NULL,
  createdAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sessionId),
  KEY ix_session_account (accountId, revokedAt),
  CONSTRAINT fk_session_account FOREIGN KEY (accountId) REFERENCES Account(accountId)
) ENGINE=InnoDB;

-- [+] Đếm đăng nhập sai theo cặp (email, IP)
CREATE TABLE LoginAttempt (
  email       VARCHAR(100) NOT NULL,
  ipAddress   VARCHAR(45)  NOT NULL,
  failedCount INT          NOT NULL DEFAULT 0,
  lockedUntil DATETIME     NULL,
  updatedAt   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (email, ipAddress)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. SÁCH & DANH MỤC
-- ---------------------------------------------------------------------
CREATE TABLE Series (                                    -- [+] bộ sách (mỗi tập bán độc lập)
  seriesId CHAR(36)     NOT NULL,
  name     VARCHAR(255) NOT NULL,
  PRIMARY KEY (seriesId)
) ENGINE=InnoDB;

CREATE TABLE Publisher (
  publisherId CHAR(36)     NOT NULL,
  name        VARCHAR(150) NOT NULL,
  address     VARCHAR(255) NULL,
  phone       VARCHAR(15)  NULL,
  PRIMARY KEY (publisherId),
  UNIQUE KEY uq_publisher_name (name)
) ENGINE=InnoDB;

CREATE TABLE Author (
  authorId  CHAR(36)     NOT NULL,
  name      VARCHAR(150) NOT NULL,
  biography TEXT         NULL,
  PRIMARY KEY (authorId),
  KEY ix_author_name (name)
) ENGINE=InnoDB;

CREATE TABLE Category (
  categoryId  CHAR(36)     NOT NULL,
  name        VARCHAR(100) NOT NULL,
  parentId    CHAR(36)     NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (categoryId),
  UNIQUE KEY uq_category_name (parentId, name),
  CONSTRAINT fk_category_parent FOREIGN KEY (parentId) REFERENCES Category(categoryId)
) ENGINE=InnoDB;

CREATE TABLE Work (
  workId      CHAR(36)     NOT NULL,
  title       VARCHAR(255) NOT NULL,
  description MEDIUMTEXT   NULL,
  language    VARCHAR(20)  NULL,
  seriesId    CHAR(36)     NULL,                         -- [+]
  volumeNo    INT          NULL,                         -- [+]
  searchText  VARCHAR(1000) NULL,                        -- [+] chuỗi đã bỏ dấu (app điền) phục vụ tìm kiếm
  createdAt   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workId),
  KEY ix_work_series (seriesId),
  FULLTEXT KEY ft_work_search (title, searchText),
  CONSTRAINT fk_work_series FOREIGN KEY (seriesId) REFERENCES Series(seriesId)
) ENGINE=InnoDB;

CREATE TABLE Edition (
  editionId      CHAR(36)      NOT NULL,
  workId         CHAR(36)      NOT NULL,
  publisherId    CHAR(36)      NOT NULL,
  isbn           VARCHAR(20)   NOT NULL,                 -- ISBN-13 đã chuẩn hóa (chỉ số)
  format         VARCHAR(30)   NOT NULL,                 -- Bìa mềm / Bìa cứng
  listPrice      DECIMAL(18,0) NOT NULL,
  salePrice      DECIMAL(18,0) NULL,                     -- giá KM đang áp dụng (job khuyến mãi cập nhật)
  costPrice      DECIMAL(18,2) NOT NULL DEFAULT 0,       -- giá vốn bình quân (0 khi chưa nhập)
  pageCount      INT           NULL,
  weightGram     INT           NOT NULL,
  lengthMm       INT           NULL,
  widthMm        INT           NULL,
  heightMm       INT           NULL,
  coverImageUrl  VARCHAR(500)  NULL,
  businessStatus VARCHAR(20)   NOT NULL DEFAULT 'ON_SALE',
  publishedYear  INT           NULL,
  createdAt      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (editionId),
  UNIQUE KEY uq_edition_isbn (isbn),
  KEY ix_edition_work (workId),
  KEY ix_edition_publisher (publisherId),
  KEY ix_edition_status_price (businessStatus, listPrice),
  CONSTRAINT fk_edition_work      FOREIGN KEY (workId)      REFERENCES Work(workId),
  CONSTRAINT fk_edition_publisher FOREIGN KEY (publisherId) REFERENCES Publisher(publisherId),
  CONSTRAINT ck_edition_isbn   CHECK (isbn REGEXP '^[0-9]{13}$'),
  CONSTRAINT ck_edition_list   CHECK (listPrice > 0),
  CONSTRAINT ck_edition_cost   CHECK (costPrice >= 0),
  CONSTRAINT ck_edition_sale   CHECK (salePrice IS NULL OR (salePrice > 0 AND salePrice < listPrice)),
  CONSTRAINT ck_edition_weight CHECK (weightGram > 0),
  CONSTRAINT ck_edition_status CHECK (businessStatus IN ('ON_SALE','HIDDEN','DISCONTINUED'))
) ENGINE=InnoDB;

CREATE TABLE WorkAuthor (
  workId   CHAR(36) NOT NULL,
  authorId CHAR(36) NOT NULL,
  PRIMARY KEY (workId, authorId),
  KEY ix_wa_author (authorId),
  CONSTRAINT fk_wa_work   FOREIGN KEY (workId)   REFERENCES Work(workId),
  CONSTRAINT fk_wa_author FOREIGN KEY (authorId) REFERENCES Author(authorId)
) ENGINE=InnoDB;

CREATE TABLE WorkCategory (
  workId     CHAR(36) NOT NULL,
  categoryId CHAR(36) NOT NULL,
  PRIMARY KEY (workId, categoryId),
  KEY ix_wc_category (categoryId),
  CONSTRAINT fk_wc_work     FOREIGN KEY (workId)     REFERENCES Work(workId),
  CONSTRAINT fk_wc_category FOREIGN KEY (categoryId) REFERENCES Category(categoryId)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. NHÀ CUNG CẤP, TỒN KHO, NHẬP KHO
-- ---------------------------------------------------------------------
CREATE TABLE Supplier (
  supplierId CHAR(36)     NOT NULL,
  name       VARCHAR(150) NOT NULL,
  phone      VARCHAR(15)  NOT NULL,
  email      VARCHAR(100) NULL,
  address    VARCHAR(255) NOT NULL,
  leadTimeDays INT        NOT NULL DEFAULT 7,            -- [+] thời gian giao, dùng tính tồn tối thiểu
  status     VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (supplierId),
  CONSTRAINT ck_supplier_status CHECK (status IN ('ACTIVE','INACTIVE'))
) ENGINE=InnoDB;

CREATE TABLE Inventory (
  editionId            CHAR(36) NOT NULL,
  qtyOnHand            INT      NOT NULL DEFAULT 0,
  qtyReserved          INT      NOT NULL DEFAULT 0,
  qtyAvailable         INT GENERATED ALWAYS AS (qtyOnHand - qtyReserved) STORED,  -- luôn nhất quán
  qtyPendingInspection INT      NOT NULL DEFAULT 0,
  minStockLevel        INT      NOT NULL DEFAULT 0,
  reorderQty           INT      NULL,
  defaultSupplierId    CHAR(36) NULL,
  minStockOverridden   BOOLEAN  NOT NULL DEFAULT FALSE,  -- [+] giá trị ghi đè không bị tính lại
  reorderOverridden    BOOLEAN  NOT NULL DEFAULT FALSE,
  supplierOverridden   BOOLEAN  NOT NULL DEFAULT FALSE,
  updatedAt            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (editionId),
  KEY ix_inventory_available (qtyAvailable, minStockLevel),
  CONSTRAINT fk_inventory_edition  FOREIGN KEY (editionId)         REFERENCES Edition(editionId),
  CONSTRAINT fk_inventory_supplier FOREIGN KEY (defaultSupplierId) REFERENCES Supplier(supplierId),
  CONSTRAINT ck_inv_onhand   CHECK (qtyOnHand >= 0),
  CONSTRAINT ck_inv_reserved CHECK (qtyReserved >= 0 AND qtyReserved <= qtyOnHand),  -- => khả dụng không âm
  CONSTRAINT ck_inv_pending  CHECK (qtyPendingInspection >= 0),
  CONSTRAINT ck_inv_min      CHECK (minStockLevel >= 0)
) ENGINE=InnoDB;

CREATE TABLE StockMovement (
  movementId    CHAR(36)     NOT NULL,
  editionId     CHAR(36)     NOT NULL,
  movementType  VARCHAR(30)  NOT NULL,
  quantity      INT          NOT NULL,
  qtyAfter      INT          NOT NULL,
  referenceType VARCHAR(30)  NULL,
  referenceId   CHAR(36)     NULL,
  reason        VARCHAR(255) NULL,
  performedBy   CHAR(36)     NULL,                       -- NULL = hệ thống
  createdAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (movementId),
  KEY ix_sm_edition_time (editionId, createdAt),
  KEY ix_sm_ref (referenceType, referenceId),
  CONSTRAINT fk_sm_edition FOREIGN KEY (editionId)   REFERENCES Edition(editionId),
  CONSTRAINT fk_sm_staff   FOREIGN KEY (performedBy) REFERENCES Staff(staffId),
  CONSTRAINT ck_sm_type CHECK (movementType IN
    ('IMPORT','SALE','CANCEL','RETURN','RETURN_TO_WAREHOUSE','ADJUST','DAMAGE','RESTORE')),
  CONSTRAINT ck_sm_qty CHECK (quantity <> 0 AND qtyAfter >= 0)
) ENGINE=InnoDB;

CREATE TABLE PurchaseOrder (                             -- [+] phiếu đặt hàng nhà cung cấp
  purchaseOrderId CHAR(36)    NOT NULL,
  poCode          VARCHAR(30) NOT NULL,
  supplierId      CHAR(36)    NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  isAuto          BOOLEAN     NOT NULL DEFAULT TRUE,
  createdAt       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closedAt        DATETIME    NULL,
  PRIMARY KEY (purchaseOrderId),
  UNIQUE KEY uq_po_code (poCode),
  KEY ix_po_status (status, createdAt),
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplierId) REFERENCES Supplier(supplierId),
  CONSTRAINT ck_po_status CHECK (status IN ('OPEN','PARTIALLY_RECEIVED','RECEIVED','AUTO_CLOSED','CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE PurchaseOrderDetail (
  poDetailId      CHAR(36) NOT NULL,
  purchaseOrderId CHAR(36) NOT NULL,
  editionId       CHAR(36) NOT NULL,
  qtyOrdered      INT      NOT NULL,
  qtyReceived     INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (poDetailId),
  UNIQUE KEY uq_pod (purchaseOrderId, editionId),
  CONSTRAINT fk_pod_po      FOREIGN KEY (purchaseOrderId) REFERENCES PurchaseOrder(purchaseOrderId),
  CONSTRAINT fk_pod_edition FOREIGN KEY (editionId)       REFERENCES Edition(editionId),
  CONSTRAINT ck_pod_qty CHECK (qtyOrdered > 0 AND qtyReceived >= 0)
) ENGINE=InnoDB;

CREATE TABLE ImportVoucher (
  voucherId       CHAR(36)      NOT NULL,
  voucherCode     VARCHAR(30)   NOT NULL,
  supplierId      CHAR(36)      NOT NULL,
  purchaseOrderId CHAR(36)      NULL,                    -- [+]
  importDate      DATE          NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
  totalQuantity   INT           NOT NULL DEFAULT 0,
  totalAmount     DECIMAL(18,2) NULL,
  createdBy       CHAR(36)      NOT NULL,
  confirmedBy     CHAR(36)      NULL,
  confirmedAt     DATETIME      NULL,
  createdAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- [+] phục vụ tự hủy sau 30 ngày
  PRIMARY KEY (voucherId),
  UNIQUE KEY uq_voucher_code (supplierId, voucherCode),   -- không trùng trong cùng nhà cung cấp
  KEY ix_voucher_status (status, createdAt),
  CONSTRAINT fk_iv_supplier  FOREIGN KEY (supplierId)      REFERENCES Supplier(supplierId),
  CONSTRAINT fk_iv_po        FOREIGN KEY (purchaseOrderId) REFERENCES PurchaseOrder(purchaseOrderId),
  CONSTRAINT fk_iv_createdBy FOREIGN KEY (createdBy)       REFERENCES Staff(staffId),
  CONSTRAINT fk_iv_confirmed FOREIGN KEY (confirmedBy)     REFERENCES Staff(staffId),
  CONSTRAINT ck_iv_status CHECK (status IN ('DRAFT','CONFIRMED','CANCELLED'))
) ENGINE=InnoDB;

CREATE TABLE ImportVoucherDetail (
  detailId  CHAR(36)      NOT NULL,
  voucherId CHAR(36)      NOT NULL,
  editionId CHAR(36)      NOT NULL,
  quantity  INT           NOT NULL,
  unitCost  DECIMAL(18,2) NOT NULL,
  lineTotal DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (detailId),
  KEY ix_ivd_voucher (voucherId),
  KEY ix_ivd_edition (editionId),
  CONSTRAINT fk_ivd_voucher FOREIGN KEY (voucherId) REFERENCES ImportVoucher(voucherId),
  CONSTRAINT fk_ivd_edition FOREIGN KEY (editionId) REFERENCES Edition(editionId),
  CONSTRAINT ck_ivd CHECK (quantity > 0 AND unitCost >= 0 AND lineTotal = quantity * unitCost)
) ENGINE=InnoDB;

CREATE TABLE CostAdjustment (                            -- [+] phiếu điều chỉnh giá nhập (phiếu gốc không bị sửa)
  adjustmentId   CHAR(36)      NOT NULL,
  voucherId      CHAR(36)      NOT NULL,
  detailId       CHAR(36)      NOT NULL,
  editionId      CHAR(36)      NOT NULL,
  oldUnitCost    DECIMAL(18,2) NOT NULL,
  newUnitCost    DECIMAL(18,2) NOT NULL,
  costBefore     DECIMAL(18,2) NOT NULL,                 -- giá vốn bình quân trước/sau
  costAfter      DECIMAL(18,2) NOT NULL,
  reason         VARCHAR(255)  NOT NULL,
  attachmentUrl  VARCHAR(500)  NULL,
  createdBy      CHAR(36)      NOT NULL,                 -- chỉ quản trị viên
  createdAt      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (adjustmentId),
  CONSTRAINT fk_ca_voucher FOREIGN KEY (voucherId) REFERENCES ImportVoucher(voucherId),
  CONSTRAINT fk_ca_detail  FOREIGN KEY (detailId)  REFERENCES ImportVoucherDetail(detailId),
  CONSTRAINT fk_ca_edition FOREIGN KEY (editionId) REFERENCES Edition(editionId),
  CONSTRAINT fk_ca_staff   FOREIGN KEY (createdBy) REFERENCES Staff(staffId),
  CONSTRAINT ck_ca CHECK (newUnitCost >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. GIỎ HÀNG, YÊU THÍCH, ĐỊA CHỈ
-- ---------------------------------------------------------------------
CREATE TABLE CartItem (
  cartItemId CHAR(36)     NOT NULL,
  customerId CHAR(36)     NULL,
  sessionId  VARCHAR(100) NULL,
  editionId  CHAR(36)     NOT NULL,
  quantity   INT          NOT NULL,
  priceAtAdd DECIMAL(18,0) NULL,                          -- [+] giá lúc thêm, để báo đổi giá khi mở lại giỏ
  addedAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cartItemId),
  UNIQUE KEY uq_cart_customer (customerId, editionId),   -- NULL không vi phạm => khách vãng lai dùng key dưới
  UNIQUE KEY uq_cart_session  (sessionId, editionId),
  KEY ix_cart_updated (updatedAt),
  CONSTRAINT fk_cart_customer FOREIGN KEY (customerId) REFERENCES Customer(customerId),
  CONSTRAINT fk_cart_edition  FOREIGN KEY (editionId)  REFERENCES Edition(editionId),
  CONSTRAINT ck_cart_owner CHECK (customerId IS NOT NULL OR sessionId IS NOT NULL),
  CONSTRAINT ck_cart_qty   CHECK (quantity BETWEEN 1 AND 10)
) ENGINE=InnoDB;

CREATE TABLE Wishlist (
  wishlistId CHAR(36) NOT NULL,
  customerId CHAR(36) NOT NULL,
  editionId  CHAR(36) NOT NULL,
  addedAt    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (wishlistId),
  UNIQUE KEY uq_wishlist (customerId, editionId),
  CONSTRAINT fk_wl_customer FOREIGN KEY (customerId) REFERENCES Customer(customerId),
  CONSTRAINT fk_wl_edition  FOREIGN KEY (editionId)  REFERENCES Edition(editionId)
) ENGINE=InnoDB;

CREATE TABLE Address (
  addressId     CHAR(36)     NOT NULL,
  customerId    CHAR(36)     NOT NULL,
  receiverName  VARCHAR(100) NOT NULL,
  phone         VARCHAR(15)  NOT NULL,
  province      VARCHAR(100) NOT NULL,
  district      VARCHAR(100) NULL,
  ward          VARCHAR(100) NOT NULL,
  ghnProvinceId INT          NULL,                       -- [+] mã địa giới GHN
  ghnDistrictId INT          NULL,
  ghnWardCode   VARCHAR(20)  NULL,
  detail        VARCHAR(255) NOT NULL,
  isDefault     BOOLEAN      NOT NULL DEFAULT FALSE,
  needsConfirm  BOOLEAN      NOT NULL DEFAULT FALSE,
  lastUsedAt    DATETIME     NULL,                       -- [+] chọn địa chỉ mặc định mới khi xóa mặc định
  PRIMARY KEY (addressId),
  KEY ix_address_customer (customerId),
  CONSTRAINT fk_address_customer FOREIGN KEY (customerId) REFERENCES Customer(customerId)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. KHUYẾN MÃI & MÃ GIẢM GIÁ
-- ---------------------------------------------------------------------
CREATE TABLE DiscountCode (
  discountCodeId   CHAR(36)      NOT NULL,
  code             VARCHAR(30)   NOT NULL,
  type             VARCHAR(20)   NOT NULL,
  value            DECIMAL(18,2) NOT NULL,
  minOrderValue    DECIMAL(18,0) NULL,
  maxDiscount      DECIMAL(18,0) NULL,
  totalUsageLimit  INT           NULL,
  perCustomerLimit INT           NULL,
  usedCount        INT           NOT NULL DEFAULT 0,
  excludeOnSale    BOOLEAN       NOT NULL DEFAULT FALSE,  -- [+] không áp dụng cho sách đang KM
  startAt          DATETIME      NOT NULL,
  endAt            DATETIME      NOT NULL,
  status           VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (discountCodeId),
  UNIQUE KEY uq_discount_code (code),
  CONSTRAINT ck_dc_type   CHECK (type IN ('PERCENT','FIXED')),
  CONSTRAINT ck_dc_value  CHECK (value > 0 AND (type <> 'PERCENT' OR value <= 100)),
  CONSTRAINT ck_dc_time   CHECK (startAt < endAt),
  CONSTRAINT ck_dc_used   CHECK (usedCount >= 0 AND (totalUsageLimit IS NULL OR usedCount <= totalUsageLimit)),
  CONSTRAINT ck_dc_status CHECK (status IN ('ACTIVE','INACTIVE','EXPIRED'))
) ENGINE=InnoDB;

CREATE TABLE DiscountCodeCategory (                      -- [+] phạm vi thể loại (không có dòng = toàn bộ sách)
  discountCodeId CHAR(36) NOT NULL,
  categoryId     CHAR(36) NOT NULL,
  PRIMARY KEY (discountCodeId, categoryId),
  CONSTRAINT fk_dcc_code     FOREIGN KEY (discountCodeId) REFERENCES DiscountCode(discountCodeId),
  CONSTRAINT fk_dcc_category FOREIGN KEY (categoryId)     REFERENCES Category(categoryId)
) ENGINE=InnoDB;

CREATE TABLE Promotion (
  promotionId     CHAR(36)      NOT NULL,
  name            VARCHAR(150)  NOT NULL,
  scopeType       VARCHAR(20)   NOT NULL,
  discountType    VARCHAR(20)   NOT NULL,
  discountValue   DECIMAL(18,2) NOT NULL,
  startAt         DATETIME      NOT NULL,
  endAt           DATETIME      NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',
  allowBelowCost  BOOLEAN       NOT NULL DEFAULT FALSE,
  belowCostReason VARCHAR(255)  NULL,                    -- [+] bắt buộc khi bán lỗ
  createdBy       CHAR(36)      NOT NULL,
  createdAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (promotionId),
  KEY ix_promo_time (status, startAt, endAt),
  CONSTRAINT fk_promo_staff FOREIGN KEY (createdBy) REFERENCES Staff(staffId),
  CONSTRAINT ck_promo_scope  CHECK (scopeType IN ('EDITION','CATEGORY','PUBLISHER','ISBN_LIST')),
  CONSTRAINT ck_promo_dtype  CHECK (discountType IN ('PERCENT','FIXED')),
  CONSTRAINT ck_promo_value  CHECK (discountValue > 0),
  CONSTRAINT ck_promo_time   CHECK (startAt < endAt),
  CONSTRAINT ck_promo_status CHECK (status IN ('ACTIVE','INACTIVE','EXPIRED')),
  CONSTRAINT ck_promo_loss   CHECK (allowBelowCost = FALSE OR belowCostReason IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE PromotionTarget (                           -- [+] targetId = editionId/categoryId/publisherId tùy scopeType
  promotionId CHAR(36) NOT NULL,
  targetId    CHAR(36) NOT NULL,
  PRIMARY KEY (promotionId, targetId),
  KEY ix_pt_target (targetId),
  CONSTRAINT fk_pt_promo FOREIGN KEY (promotionId) REFERENCES Promotion(promotionId)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. ĐƠN HÀNG, THANH TOÁN, VẬN CHUYỂN, TRẢ HÀNG, HOÀN TIỀN
-- ---------------------------------------------------------------------
CREATE TABLE Orders (                                    -- "Order" là từ khóa SQL nên đặt tên Orders
  orderId                 CHAR(36)      NOT NULL,
  orderCode               VARCHAR(20)   NOT NULL,
  customerId              CHAR(36)      NOT NULL,
  orderStatus             VARCHAR(30)   NOT NULL,
  paymentStatus           VARCHAR(30)   NOT NULL DEFAULT 'UNPAID',
  shippingStatus          VARCHAR(30)   NOT NULL DEFAULT 'NOT_CREATED',
  subtotal                DECIMAL(18,0) NOT NULL,
  discountAmount          DECIMAL(18,0) NOT NULL DEFAULT 0,
  shippingFee             DECIMAL(18,0) NOT NULL DEFAULT 0,
  totalAmount             DECIMAL(18,0) NOT NULL,
  paymentMethod           VARCHAR(20)   NOT NULL,
  discountCodeId          CHAR(36)      NULL,
  shippingAddressSnapshot JSON          NOT NULL,
  note                    VARCHAR(500)  NULL,
  idempotencyKey          VARCHAR(64)   NULL,              -- [+] gửi lại do lỗi mạng không tạo đơn trùng
  paymentExpiresAt        DATETIME      NULL,              -- [+] hạn thanh toán (30 phút)
  cancelReason            VARCHAR(255)  NULL,              -- [+]
  deliveredAt             DATETIME      NULL,              -- [+] GHN báo đã giao: mốc 7 ngày trả hàng / 90 ngày đánh giá
  stockRestoredAt         DATETIME      NULL,              -- [+] đảm bảo hoàn kho đúng một lần
  discountReturnedAt      DATETIME      NULL,              -- [+] đảm bảo trả lượt mã đúng một lần
  createdAt               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmedAt             DATETIME      NULL,
  completedAt             DATETIME      NULL,
  PRIMARY KEY (orderId),
  UNIQUE KEY uq_order_code (orderCode),
  UNIQUE KEY uq_order_idem (customerId, idempotencyKey),
  KEY ix_order_customer (customerId, createdAt),
  KEY ix_order_status (orderStatus, confirmedAt),
  KEY ix_order_payexp (orderStatus, paymentExpiresAt),
  CONSTRAINT fk_order_customer FOREIGN KEY (customerId)     REFERENCES Customer(customerId),
  CONSTRAINT fk_order_discount FOREIGN KEY (discountCodeId) REFERENCES DiscountCode(discountCodeId),
  CONSTRAINT ck_order_code    CHECK (orderCode REGEXP '^DH[A-Z0-9]{8}$'),
  CONSTRAINT ck_order_status  CHECK (orderStatus IN ('PENDING_PAYMENT','CONFIRMED','PACKING','COMPLETED',
                                     'CANCELLED','EXPIRED','RETURNED','RETURNED_TO_WAREHOUSE')),
  CONSTRAINT ck_order_pay     CHECK (paymentStatus IN ('UNPAID','PAID','COD_COLLECTED','FAILED','EXPIRED',
                                     'REFUND_PENDING','REFUNDED')),
  CONSTRAINT ck_order_ship    CHECK (shippingStatus IN ('NOT_CREATED','WAITING_PICKUP','DELIVERING','DELIVERED',
                                     'FAILED','RETURNING','RETURNED','CANCELLED','LOST','DAMAGED')),
  CONSTRAINT ck_order_method  CHECK (paymentMethod IN ('COD','SEPAY','VNPAY')),
  CONSTRAINT ck_order_money   CHECK (subtotal >= 0 AND discountAmount >= 0 AND shippingFee >= 0
                                     AND totalAmount = subtotal - discountAmount + shippingFee)
  -- Hạn mức COD (<= 2.000.000) là THAM SỐ cấu hình nên kiểm tra ở tầng ứng dụng, không CHECK cứng ở DB.
) ENGINE=InnoDB;

CREATE TABLE OrderItem (
  orderItemId CHAR(36)      NOT NULL,
  orderId     CHAR(36)      NOT NULL,
  editionId   CHAR(36)      NOT NULL,
  quantity    INT           NOT NULL,
  unitPrice   DECIMAL(18,0) NOT NULL,
  costPrice   DECIMAL(18,2) NULL,                        -- chốt khi GHN lấy hàng (xuất kho)
  lineTotal   DECIMAL(18,0) NOT NULL,
  PRIMARY KEY (orderItemId),
  UNIQUE KEY uq_orderitem (orderId, editionId),
  KEY ix_orderitem_edition (editionId),
  CONSTRAINT fk_oi_order   FOREIGN KEY (orderId)   REFERENCES Orders(orderId),
  CONSTRAINT fk_oi_edition FOREIGN KEY (editionId) REFERENCES Edition(editionId),
  CONSTRAINT ck_oi CHECK (quantity BETWEEN 1 AND 10 AND unitPrice >= 0 AND lineTotal = unitPrice * quantity)
) ENGINE=InnoDB;

CREATE TABLE DiscountCodeUsage (                         -- [+] đếm lượt mỗi khách + trả lượt đúng một lần
  usageId        CHAR(36) NOT NULL,
  discountCodeId CHAR(36) NOT NULL,
  customerId     CHAR(36) NOT NULL,
  orderId        CHAR(36) NOT NULL,
  usedAt         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returnedAt     DATETIME NULL,
  PRIMARY KEY (usageId),
  UNIQUE KEY uq_dcu_order (orderId),                     -- mỗi đơn tối đa một mã
  KEY ix_dcu_code_customer (discountCodeId, customerId),
  CONSTRAINT fk_dcu_code     FOREIGN KEY (discountCodeId) REFERENCES DiscountCode(discountCodeId),
  CONSTRAINT fk_dcu_customer FOREIGN KEY (customerId)     REFERENCES Customer(customerId),
  CONSTRAINT fk_dcu_order    FOREIGN KEY (orderId)        REFERENCES Orders(orderId)
) ENGINE=InnoDB;

CREATE TABLE ReturnRequest (
  returnId      CHAR(36)     NOT NULL,
  orderId       CHAR(36)     NOT NULL,
  customerId    CHAR(36)     NOT NULL,
  reason        VARCHAR(50)  NOT NULL,
  status        VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
  imageUrls     JSON         NULL,                       -- 1–5 ảnh
  refundAccount VARBINARY(512) NULL,                     -- mã hóa ở tầng ứng dụng (AES-GCM)
  inspectedBy   CHAR(36)     NULL,                       -- [+]
  inspectedAt   DATETIME     NULL,
  inspectionNote VARCHAR(500) NULL,
  shipBackDueAt DATETIME     NULL,                       -- [+] hạn khách gửi hàng (7 ngày)
  createdAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (returnId),
  UNIQUE KEY uq_return_order (orderId),                  -- mỗi đơn một yêu cầu
  KEY ix_return_customer (customerId, createdAt),
  KEY ix_return_status (status),
  CONSTRAINT fk_rr_order     FOREIGN KEY (orderId)     REFERENCES Orders(orderId),
  CONSTRAINT fk_rr_customer  FOREIGN KEY (customerId)  REFERENCES Customer(customerId),
  CONSTRAINT fk_rr_inspector FOREIGN KEY (inspectedBy) REFERENCES Staff(staffId),
  CONSTRAINT ck_rr_reason CHECK (reason IN ('DEFECT','WRONG_ITEM')),
  CONSTRAINT ck_rr_status CHECK (status IN ('PENDING','APPROVED','REJECTED','SHIPPING_BACK','RECEIVED','COMPLETED','EXPIRED')),
  CONSTRAINT ck_rr_images CHECK (imageUrls IS NULL OR JSON_LENGTH(imageUrls) BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE Shipment (
  shipmentId      CHAR(36)      NOT NULL,
  orderId         CHAR(36)      NOT NULL,
  returnRequestId CHAR(36)      NULL,
  ghnOrderCode    VARCHAR(50)   NULL,
  direction       VARCHAR(10)   NOT NULL,
  status          VARCHAR(30)   NOT NULL,
  codAmount       DECIMAL(18,0) NOT NULL DEFAULT 0,
  shippingFee     DECIMAL(18,0) NULL,                    -- phí thực tế GHN (đối soát)
  pickedUpAt      DATETIME      NULL,                    -- [+] GHN lấy hàng => xuất kho
  lastGhnStatus   VARCHAR(50)   NULL,                    -- [+] trạng thái thô của GHN
  lastGhnEventAt  DATETIME      NULL,                    -- [+] chống thông báo trễ/sai thứ tự làm lùi trạng thái
  lastSyncAt      DATETIME      NULL,
  createdAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shipmentId),
  UNIQUE KEY uq_ship_ghn (ghnOrderCode),
  UNIQUE KEY uq_ship_order_dir (orderId, direction),     -- mỗi đơn một vận đơn mỗi chiều => không trùng
  KEY ix_ship_status (status, lastSyncAt),
  CONSTRAINT fk_ship_order  FOREIGN KEY (orderId)         REFERENCES Orders(orderId),
  CONSTRAINT fk_ship_return FOREIGN KEY (returnRequestId) REFERENCES ReturnRequest(returnId),
  CONSTRAINT ck_ship_dir    CHECK (direction IN ('FORWARD','RETURN')),
  CONSTRAINT ck_ship_status CHECK (status IN ('CREATED','WAITING_PICKUP','DELIVERING','DELIVERED','FAILED',
                                     'RETURNING','RETURNED','CANCELLED','LOST','DAMAGED','PICKUP_FAILED')),
  CONSTRAINT ck_ship_cod    CHECK (codAmount >= 0)
) ENGINE=InnoDB;

CREATE TABLE PaymentTransaction (
  transactionId   CHAR(36)      NOT NULL,
  orderId         CHAR(36)      NULL,                    -- NULL = giao dịch SePay chưa xác định chủ
  provider        VARCHAR(20)   NOT NULL,
  providerTxnId   VARCHAR(100)  NULL,
  txnRef          VARCHAR(64)   NULL,                    -- [+] mã tham chiếu mỗi lần thử VNPay (vnp_TxnRef)
  amount          DECIMAL(18,0) NOT NULL,
  status          VARCHAR(30)   NOT NULL,
  refundStatus    VARCHAR(30)   NULL,
  transferContent VARCHAR(255)  NULL,                    -- [+] nội dung chuyển khoản SePay
  bankTxnAt       DATETIME      NULL,                    -- [+] thời điểm giao dịch ngân hàng (xét ân hạn 5 phút)
  rawPayload      JSON          NULL,                    -- [+] payload webhook gốc
  createdAt       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (transactionId),
  UNIQUE KEY uq_pt_provider_txn (provider, providerTxnId),   -- mỗi giao dịch xử lý đúng một lần
  UNIQUE KEY uq_pt_txnref (txnRef),
  KEY ix_pt_order (orderId),
  CONSTRAINT fk_pt_order FOREIGN KEY (orderId) REFERENCES Orders(orderId),
  CONSTRAINT ck_pt_provider CHECK (provider IN ('SEPAY','VNPAY','COD')),
  CONSTRAINT ck_pt_amount   CHECK (amount > 0),
  CONSTRAINT ck_pt_status   CHECK (status IN ('SUCCESS','FAILED','PENDING','REFUND_PENDING','REFUNDED'))
) ENGINE=InnoDB;

CREATE TABLE Refund (                                    -- [+] khoản hoàn tiền (trạng thái chi tiết, lệnh chi VietQR)
  refundId           CHAR(36)      NOT NULL,
  refundCode         VARCHAR(20)   NOT NULL,             -- đưa vào nội dung chuyển khoản
  orderId            CHAR(36)      NULL,
  transactionId      CHAR(36)      NULL,
  returnId           CHAR(36)      NULL,
  customerId         CHAR(36)      NULL,
  source             VARCHAR(30)   NOT NULL,
  method             VARCHAR(20)   NOT NULL,             -- VNPAY_API / BANK_TRANSFER / BALANCE
  amount             DECIMAL(18,0) NOT NULL,
  status             VARCHAR(30)   NOT NULL,
  bankName           VARCHAR(100)  NULL,
  accountNumberEnc   VARBINARY(512) NULL,                -- mã hóa, che khi hiển thị
  accountHolderName  VARCHAR(100)  NULL,
  mismatchCount      INT           NOT NULL DEFAULT 0,   -- tối đa 3 lần không khớp tên
  needsAdminApproval BOOLEAN       NOT NULL DEFAULT FALSE,
  approvedBy         CHAR(36)      NULL,                 -- NULL + không cần duyệt = tự duyệt
  approvedAt         DATETIME      NULL,
  transferredBy      CHAR(36)      NULL,
  transferredAt      DATETIME      NULL,
  bankTxnRef         VARCHAR(100)  NULL,                 -- mã giao dịch ngân hàng / mã hoàn VNPay
  retryCount         INT           NOT NULL DEFAULT 0,
  nextRetryAt        DATETIME      NULL,
  accountLinkExpiresAt DATETIME    NULL,
  accountLinkExtendCount INT       NOT NULL DEFAULT 0,
  failReason         VARCHAR(255)  NULL,
  createdAt          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completedAt        DATETIME      NULL,
  PRIMARY KEY (refundId),
  UNIQUE KEY uq_refund_code (refundCode),
  KEY ix_refund_status (status, createdAt),
  KEY ix_refund_order (orderId),
  CONSTRAINT fk_rf_order    FOREIGN KEY (orderId)       REFERENCES Orders(orderId),
  CONSTRAINT fk_rf_txn      FOREIGN KEY (transactionId) REFERENCES PaymentTransaction(transactionId),
  CONSTRAINT fk_rf_return   FOREIGN KEY (returnId)      REFERENCES ReturnRequest(returnId),
  CONSTRAINT fk_rf_customer FOREIGN KEY (customerId)    REFERENCES Customer(customerId),
  CONSTRAINT fk_rf_approver FOREIGN KEY (approvedBy)    REFERENCES Staff(staffId),
  CONSTRAINT fk_rf_payer    FOREIGN KEY (transferredBy) REFERENCES Staff(staffId),
  CONSTRAINT ck_rf_amount CHECK (amount > 0),
  CONSTRAINT ck_rf_source CHECK (source IN ('CANCEL','RETURNED_TO_WAREHOUSE','RETURN','LATE_PAYMENT',
                                 'OVERPAID','UNDERPAID','DUPLICATE','STOCK_SHORTAGE')),
  CONSTRAINT ck_rf_method CHECK (method IN ('VNPAY_API','BANK_TRANSFER','BALANCE')),
  CONSTRAINT ck_rf_status CHECK (status IN ('AWAITING_ACCOUNT','AWAITING_APPROVAL','PROCESSING_BANK',
                                 'PAYOUT_CREATED','TRANSFERRED','FAILED','REFUNDED')),
  CONSTRAINT ck_rf_sod CHECK (approvedBy IS NULL OR transferredBy IS NULL OR approvedBy <> transferredBy)  -- người duyệt ≠ người chuyển
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. ĐÁNH GIÁ
-- ---------------------------------------------------------------------
CREATE TABLE Review (
  reviewId   CHAR(36)      NOT NULL,
  editionId  CHAR(36)      NOT NULL,
  customerId CHAR(36)      NOT NULL,
  orderId    CHAR(36)      NOT NULL,
  rating     TINYINT       NOT NULL,
  comment    VARCHAR(1000) NULL,
  status     VARCHAR(20)   NOT NULL DEFAULT 'VISIBLE',
  hiddenBy   VARCHAR(20)   NULL,                         -- [+] AUTO / ADMIN
  createdAt  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reviewId),
  UNIQUE KEY uq_review (customerId, editionId),
  KEY ix_review_edition (editionId, status),
  CONSTRAINT fk_rv_edition  FOREIGN KEY (editionId)  REFERENCES Edition(editionId),
  CONSTRAINT fk_rv_customer FOREIGN KEY (customerId) REFERENCES Customer(customerId),
  CONSTRAINT fk_rv_order    FOREIGN KEY (orderId)    REFERENCES Orders(orderId),
  CONSTRAINT ck_rv_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT ck_rv_status CHECK (status IN ('VISIBLE','HIDDEN'))
) ENGINE=InnoDB;

CREATE TABLE ReviewReport (                              -- [+] báo cáo đánh giá (>=3 tài khoản khác nhau => tự ẩn)
  reviewId   CHAR(36)     NOT NULL,
  reporterId CHAR(36)     NOT NULL,
  reason     VARCHAR(255) NULL,
  createdAt  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reviewId, reporterId),
  CONSTRAINT fk_rrp_review   FOREIGN KEY (reviewId)   REFERENCES Review(reviewId),
  CONSTRAINT fk_rrp_reporter FOREIGN KEY (reporterId) REFERENCES Customer(customerId)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 8. HỆ THỐNG: THAM SỐ, LỊCH SỬ, NGOẠI LỆ, THÔNG BÁO, TÍCH HỢP
-- ---------------------------------------------------------------------
CREATE TABLE SystemParameter (
  paramKey    VARCHAR(50)  NOT NULL,
  paramValue  VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  updatedBy   CHAR(36)     NULL,
  updatedAt   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (paramKey),
  CONSTRAINT fk_sp_staff FOREIGN KEY (updatedBy) REFERENCES Staff(staffId)
) ENGINE=InnoDB;

CREATE TABLE AuditLog (
  logId      CHAR(36)     NOT NULL,
  actorId    CHAR(36)     NULL,                          -- NULL = hệ thống
  action     VARCHAR(50)  NOT NULL,
  entityType VARCHAR(50)  NOT NULL,
  entityId   CHAR(36)     NULL,
  oldValue   JSON         NULL,
  newValue   JSON         NULL,
  reason     VARCHAR(255) NULL,
  createdAt  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (logId),
  KEY ix_audit_entity (entityType, entityId, createdAt),
  KEY ix_audit_actor (actorId, createdAt),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actorId) REFERENCES Account(accountId)
) ENGINE=InnoDB;

CREATE TABLE ExceptionItem (                             -- [+] danh sách ngoại lệ
  exceptionId  CHAR(36)     NOT NULL,
  type         VARCHAR(40)  NOT NULL,
  refType      VARCHAR(30)  NULL,
  refId        CHAR(36)     NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
  assignedTo   CHAR(36)     NULL,                        -- người đang mở xử lý (tránh sửa chồng)
  detail       VARCHAR(500) NULL,
  dueAt        DATETIME     NOT NULL,                     -- hạn xử lý 3 ngày
  autoCloseAt  DATETIME     NOT NULL,                     -- quá 30 ngày áp dụng xử lý mặc định
  resolution   VARCHAR(500) NULL,
  resolvedBy   CHAR(36)     NULL,
  resolvedAt   DATETIME     NULL,
  createdAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exceptionId),
  KEY ix_exc_status (status, dueAt),
  KEY ix_exc_ref (refType, refId),
  CONSTRAINT fk_exc_assignee FOREIGN KEY (assignedTo) REFERENCES Staff(staffId),
  CONSTRAINT fk_exc_resolver FOREIGN KEY (resolvedBy) REFERENCES Staff(staffId),
  CONSTRAINT ck_exc_type CHECK (type IN ('UNKNOWN_SEPAY_TXN','REFUND_PAYOUT_FAILED','REFUND_VNPAY_FAILED',
      'RETURN_MISMATCH','GHN_CLAIM_FAILED','GHN_RECONCILE_COD','GHN_RECONCILE_FEE')),
  CONSTRAINT ck_exc_status CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','AUTO_RESOLVED'))
) ENGINE=InnoDB;

CREATE TABLE EInvoice (                                  -- [+] hóa đơn điện tử
  invoiceId        CHAR(36)    NOT NULL,
  orderId          CHAR(36)    NOT NULL,
  invoiceType      VARCHAR(20) NOT NULL,                 -- ISSUE / ADJUST / CANCEL
  providerInvoiceNo VARCHAR(50) NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  attempts         INT         NOT NULL DEFAULT 0,
  lastError        VARCHAR(500) NULL,
  createdAt        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invoiceId),
  UNIQUE KEY uq_einvoice (orderId, invoiceType),         -- phát hành/điều chỉnh đúng một lần
  CONSTRAINT fk_ei_order FOREIGN KEY (orderId) REFERENCES Orders(orderId),
  CONSTRAINT ck_ei_type   CHECK (invoiceType IN ('ISSUE','ADJUST','CANCEL')),
  CONSTRAINT ck_ei_status CHECK (status IN ('PENDING','ISSUED','FAILED'))
) ENGINE=InnoDB;

CREATE TABLE EmailOutbox (                               -- [+] hàng đợi email: gửi sau commit, retry 1/5/15 phút, không gửi trùng
  emailId     CHAR(36)     NOT NULL,
  dedupeKey   VARCHAR(120) NOT NULL,
  toEmail     VARCHAR(100) NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body        MEDIUMTEXT   NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  attempts    INT          NOT NULL DEFAULT 0,
  nextAttemptAt DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastError   VARCHAR(500) NULL,
  sentAt      DATETIME     NULL,
  createdAt   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (emailId),
  UNIQUE KEY uq_email_dedupe (dedupeKey),
  KEY ix_email_pending (status, nextAttemptAt),
  CONSTRAINT ck_email_status CHECK (status IN ('PENDING','SENT','FAILED','BOUNCED'))
) ENGINE=InnoDB;

CREATE TABLE Notification (                              -- [+] trung tâm thông báo trong tài khoản
  notificationId CHAR(36)     NOT NULL,
  accountId      CHAR(36)     NOT NULL,
  title          VARCHAR(150) NOT NULL,
  content        VARCHAR(500) NOT NULL,
  linkUrl        VARCHAR(255) NULL,
  readAt         DATETIME     NULL,
  createdAt      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notificationId),
  KEY ix_noti_account (accountId, readAt, createdAt),
  CONSTRAINT fk_noti_account FOREIGN KEY (accountId) REFERENCES Account(accountId)
) ENGINE=InnoDB;

CREATE TABLE IntegrationLog (                            -- [+] nhật ký gọi GHN/SePay/VNPay/HĐĐT
  logId        CHAR(36)    NOT NULL,
  provider     VARCHAR(20) NOT NULL,
  direction    VARCHAR(10) NOT NULL,                     -- OUT (ta gọi) / IN (webhook)
  endpoint     VARCHAR(255) NULL,
  requestBody  MEDIUMTEXT  NULL,
  responseBody MEDIUMTEXT  NULL,
  httpStatus   INT         NULL,
  success      BOOLEAN     NULL,
  referenceId  CHAR(36)    NULL,
  createdAt    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (logId),
  KEY ix_il_provider (provider, createdAt),
  KEY ix_il_ref (referenceId)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- 9. TRIGGER: bảng chỉ-ghi (nhật ký tồn kho, lịch sử thao tác) không được sửa/xóa
-- ---------------------------------------------------------------------
DELIMITER $$
CREATE TRIGGER trg_stockmovement_no_update BEFORE UPDATE ON StockMovement
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'StockMovement is append-only'; END$$
CREATE TRIGGER trg_stockmovement_no_delete BEFORE DELETE ON StockMovement
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'StockMovement is append-only'; END$$
CREATE TRIGGER trg_auditlog_no_update BEFORE UPDATE ON AuditLog
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only'; END$$
CREATE TRIGGER trg_auditlog_no_delete BEFORE DELETE ON AuditLog
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only'; END$$

-- Phiếu nhập đã xác nhận không được sửa nội dung dòng hàng
CREATE TRIGGER trg_ivd_lock_update BEFORE UPDATE ON ImportVoucherDetail
FOR EACH ROW BEGIN
  IF (SELECT status FROM ImportVoucher WHERE voucherId = OLD.voucherId) = 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Confirmed import voucher is immutable';
  END IF;
END$$
CREATE TRIGGER trg_ivd_lock_delete BEFORE DELETE ON ImportVoucherDetail
FOR EACH ROW BEGIN
  IF (SELECT status FROM ImportVoucher WHERE voucherId = OLD.voucherId) = 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Confirmed import voucher is immutable';
  END IF;
END$$

-- Tối đa 10 địa chỉ mỗi khách (đọc từ SystemParameter.MAX_ADDRESSES)
CREATE TRIGGER trg_address_max BEFORE INSERT ON Address
FOR EACH ROW BEGIN
  DECLARE maxAddr INT DEFAULT 10;
  SELECT CAST(paramValue AS UNSIGNED) INTO maxAddr FROM SystemParameter WHERE paramKey = 'MAX_ADDRESSES';
  IF (SELECT COUNT(*) FROM Address WHERE customerId = NEW.customerId) >= maxAddr THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Address limit reached';
  END IF;
END$$
DELIMITER ;
