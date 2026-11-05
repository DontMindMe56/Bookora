USE bookstore;
-- Đăng nhập Facebook: thêm cột Account.facebookId và cho phép tài khoản chỉ có facebookId (không mật khẩu, không Google).
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Account' AND COLUMN_NAME='facebookId');
SET @s = IF(@c = 0, 'ALTER TABLE Account ADD COLUMN facebookId VARCHAR(64) NULL, ADD UNIQUE KEY uq_account_facebookId (facebookId)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='ck_account_cred' AND CHECK_CLAUSE LIKE '%facebookId%');
SET @s = IF(@c = 0, 'ALTER TABLE Account DROP CHECK ck_account_cred', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF(@c = 0, 'ALTER TABLE Account ADD CONSTRAINT ck_account_cred CHECK (passwordHash IS NOT NULL OR googleId IS NOT NULL OR facebookId IS NOT NULL)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
