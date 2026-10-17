# Hệ thống quản lý kho hàng

Ứng dụng web hỗ trợ quản lý sản phẩm và lô hàng, lập phiếu nhập/xuất, phân quyền nhân viên và quản lý kho, duyệt phiếu và xuất hàng theo FEFO, FIFO hoặc LIFO. Dự án được xây dựng bằng React, Node.js/Express và MySQL.

## Cách nhóm chạy dự án

Nhóm dùng Docker Desktop để chạy MySQL trong container, vì vậy mỗi thành viên **không cần cài MySQL trực tiếp trên máy**. Docker cung cấp cùng phiên bản MySQL và tự khởi tạo database cùng dữ liệu mẫu. Backend và frontend hiện chạy bằng Node.js trên máy thành viên.

## Yêu cầu

- Git
- Docker Desktop đang chạy
- Node.js 20 trở lên
- pnpm 9 trở lên
- Visual Studio Code (khuyến nghị)

## Tải dự án lần đầu

Mở PowerShell hoặc terminal trong VS Code, chạy:

```powershell
git clone https://github.com/hieule1126/btl_ktpmud.git
cd btl_ktpmud
```

Nếu đã có bản sao dự án, cập nhật mã mới nhất:

```powershell
git pull origin main
```

Mở thư mục dự án trong VS Code nếu muốn chỉnh sửa:

```powershell
code .
```

## Khởi chạy dự án

Các lệnh dưới đây chạy từ thư mục gốc `btl_ktpmud`.

### 1. Khởi động database bằng Docker

Đảm bảo Docker Desktop đã mở, sau đó chạy:

```powershell
docker compose up -d
```

Lần đầu, Docker tải MySQL 8.4 và tạo database `warehouse_management` từ `database/schema.sql`. Lệnh khởi tạo chỉ chạy khi volume database được tạo lần đầu.

Kiểm tra MySQL đã chạy:

```powershell
docker compose ps
```

Nếu cổng `3306` đang được một dịch vụ MySQL khác sử dụng, hãy dừng dịch vụ đó rồi chạy lại lệnh trên.

### 2. Cấu hình và chạy backend

Tạo tệp cấu hình riêng trên máy của bạn. Trong PowerShell tại thư mục gốc, chạy:

```powershell
Copy-Item server/.env.example server/.env
```

Mở một terminal mới:

```powershell
cd server
pnpm install
pnpm dev
```

Backend chạy tại `http://localhost:3001`.

### 3. Chạy frontend

Mở terminal thứ hai từ thư mục gốc:

```powershell
cd client
pnpm install
pnpm dev
```

Mở địa chỉ Vite hiển thị trong terminal, thường là `http://localhost:5173`.

### Tài khoản demo

- Quản lý kho: `quanly@kho.local` / `123456`
- Nhân viên kho: `nhanvien@kho.local` / `123456`

## Dừng và khởi động lại

Dừng các container sau khi dùng:

```powershell
docker compose down
```

Lệnh này giữ dữ liệu database. Để chạy lại, dùng `docker compose up -d`.

Nếu cần xóa database và tạo lại dữ liệu mẫu từ đầu, chạy:

```powershell
docker compose down -v
docker compose up -d
```

**Lưu ý:** `down -v` xóa toàn bộ dữ liệu đã lưu trong database Docker của máy bạn.

## Cách chỉnh sửa và gửi thay đổi lên GitHub

Mỗi thành viên tạo nhánh riêng cho phần việc của mình, rồi gửi pull request để nhóm xem xét trước khi nhập vào `main`.

1. Cập nhật `main` trước khi bắt đầu:

   ```powershell
   git switch main
   git pull origin main
   ```

2. Tạo nhánh mới, thay tên nhánh mẫu bằng nội dung công việc của bạn:

   ```powershell
   git switch -c feature/ten-chuc-nang
   ```

3. Chỉnh sửa các tệp bằng VS Code. Trước khi gửi, xem các tệp đã đổi:

   ```powershell
   git status
   ```

4. Lưu thay đổi thành commit:

   ```powershell
   git add .
   git commit -m "Mo ta ngan gon thay doi"
   ```

5. Đẩy nhánh lên GitHub:

   ```powershell
   git push -u origin feature/ten-chuc-nang
   ```

6. Trên GitHub, tạo pull request từ nhánh của bạn vào `main`. Sau khi nhóm xem và merge, cập nhật máy của bạn:

   ```powershell
   git switch main
   git pull origin main
   ```

Không đưa `server/.env`, `node_modules` hoặc dữ liệu database cá nhân lên GitHub. Tệp `.env.example` là mẫu cấu hình dùng chung; mỗi người tạo `server/.env` riêng trên máy mình.

## Chức năng và quy tắc nghiệp vụ

- Phân quyền quản lý kho và nhân viên kho.
- Chỉ quản lý kho được duyệt phiếu.
- Tồn kho tăng khi phiếu nhập được duyệt và giảm khi phiếu xuất được duyệt.
- Phiếu xuất hỗ trợ FEFO, FIFO và LIFO.
- Không cho duyệt phiếu xuất nếu lượng tồn không đủ.
- Trường `minimum_stock` có trong database; giao diện và xử lý cảnh báo tồn kho chưa được phát triển.