SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS warehouse_management
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE warehouse_management;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS stock_issue_allocations;
DROP TABLE IF EXISTS stock_issue_items;
DROP TABLE IF EXISTS stock_issues;
DROP TABLE IF EXISTS stock_receipt_items;
DROP TABLE IF EXISTS stock_receipts;
DROP TABLE IF EXISTS batches;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER') NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sku VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  unit VARCHAR(30) NOT NULL DEFAULT 'cái',
  minimum_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE batches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  product_id INT NOT NULL,
  batch_code VARCHAR(80) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  expiry_date DATE NOT NULL,
  location VARCHAR(80) NOT NULL,
  received_at DATE NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_batch UNIQUE (product_id, batch_code),
  CONSTRAINT fk_batch_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT ck_batch_quantity CHECK (quantity >= 0)
);

CREATE TABLE stock_receipts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL UNIQUE,
  supplier VARCHAR(180),
  note TEXT,
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  created_by INT NOT NULL,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_receipt_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_receipt_approver FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE stock_receipt_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  receipt_id INT NOT NULL,
  product_id INT NOT NULL,
  batch_code VARCHAR(80) NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  expiry_date DATE NOT NULL,
  location VARCHAR(80) NOT NULL,
  CONSTRAINT fk_receipt_item_receipt FOREIGN KEY (receipt_id) REFERENCES stock_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_receipt_item_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT ck_receipt_quantity CHECK (quantity > 0)
);

CREATE TABLE stock_issues (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL UNIQUE,
  requested_by VARCHAR(180),
  note TEXT,
  strategy ENUM('FEFO', 'FIFO', 'LIFO') NOT NULL DEFAULT 'FEFO',
  status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  created_by INT NOT NULL,
  approved_by INT NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_issue_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_issue_approver FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE TABLE stock_issue_items (
  id INT PRIMARY KEY AUTO_INCREMENT,
  issue_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_issue_item_issue FOREIGN KEY (issue_id) REFERENCES stock_issues(id) ON DELETE CASCADE,
  CONSTRAINT fk_issue_item_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT ck_issue_quantity CHECK (quantity > 0)
);

CREATE TABLE stock_issue_allocations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  issue_item_id INT NOT NULL,
  batch_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_allocation_item FOREIGN KEY (issue_item_id) REFERENCES stock_issue_items(id),
  CONSTRAINT fk_allocation_batch FOREIGN KEY (batch_id) REFERENCES batches(id),
  CONSTRAINT ck_allocation_quantity CHECK (quantity > 0)
);

-- Mật khẩu của hai tài khoản mẫu: 123456
INSERT INTO users (full_name, email, password_hash, role) VALUES
('Nguyễn Minh Quản', 'quanly@kho.local', '$2a$10$wF80D9OqdY/b7Vfr8cRnBOMTISnArS9i/BL108/TrCtz/Pdeof5pu', 'WAREHOUSE_MANAGER'),
('Trần An Kho', 'nhanvien@kho.local', '$2a$10$wF80D9OqdY/b7Vfr8cRnBOMTISnArS9i/BL108/TrCtz/Pdeof5pu', 'WAREHOUSE_STAFF');

INSERT INTO products (sku, name, unit, minimum_stock) VALUES
('SP-001', 'Nước rửa tay khử khuẩn', 'chai', 40),
('SP-002', 'Khẩu trang y tế 4 lớp', 'hộp', 60),
('SP-003', 'Giấy in A4 80gsm', 'ram', 30),
('SP-004', 'Băng keo trong 48mm', 'cuộn', 25);

INSERT INTO batches (product_id, batch_code, quantity, expiry_date, location, received_at) VALUES
(1, 'NRT-2601', 120, '2027-01-15', 'A-01-01', '2026-08-12'),
(1, 'NRT-2602', 85, '2027-05-20', 'A-01-02', '2026-09-05'),
(2, 'KTY-2608', 240, '2028-08-30', 'B-02-01', '2026-08-20'),
(3, 'GIA-2609', 75, '2031-09-30', 'C-01-03', '2026-09-01'),
(4, 'BKT-2610', 44, '2029-10-10', 'C-03-02', '2026-09-18');

