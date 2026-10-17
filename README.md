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

Mỗi thành viên có một nhánh riêng đã tạo sẵn. Hãy làm việc trên nhánh được ghi cạnh tên mình; không commit trực tiếp lên `main`.

| Thành viên | Nhánh |
|---|---|
| Phạm Minh Đức | `dev/pham-minh-duc` |
| Tô Thành Trung | `dev/to-thanh-trung` |
| Lưu Văn Thăng | `dev/luu-van-thang` |
| Nguyễn Tất Tuấn Kiệt | `dev/nguyen-tat-tuan-kiet` |
| Lê Đình Hiếu | `dev/le-dinh-hieu` |

### Lần đầu làm việc trên máy cá nhân

Sau khi clone dự án và vào thư mục `btl_ktpmud`, thành viên thay tên nhánh trong lệnh dưới đây bằng nhánh của mình:

```powershell
git fetch origin
git switch --track origin/dev/ten-nhanh-cua-ban
```

Ví dụ, Phạm Minh Đức chạy:

```powershell
git fetch origin
git switch --track origin/dev/pham-minh-duc
```

### Những lần làm việc tiếp theo

Trước khi sửa code, chuyển về nhánh của mình và lấy các thay đổi mới nhất của nhánh đó:

```powershell
git switch dev/ten-nhanh-cua-ban
git pull origin dev/ten-nhanh-cua-ban
```

Chỉnh sửa tệp bằng VS Code, sau đó kiểm tra thay đổi và lưu thành commit:

```powershell
git status
git add .
git commit -m "Mo ta ngan gon thay doi"
```

Đẩy commit lên đúng nhánh của mình:

```powershell
git push origin dev/ten-nhanh-cua-ban
```

Ví dụ, Phạm Minh Đức dùng:

```powershell
git push origin dev/pham-minh-duc
```

### Gửi thay đổi vào main

Trên GitHub, tạo **Pull Request** từ nhánh riêng của bạn vào `main`. Nhóm kiểm tra rồi mới merge Pull Request. Sau khi merge, cập nhật `main` trên máy:

```powershell
git switch main
git pull origin main
```

Khi bắt đầu phần việc mới, chuyển lại nhánh riêng và lấy các commit mới nhất của nhánh đó. Nếu GitHub báo xung đột hoặc cần cập nhật nhánh với `main`, hãy nhờ nhóm phối hợp xử lý trước khi merge Pull Request.

Mỗi thành viên cần được cấp quyền ghi (**Write**) vào repository để đẩy nhánh lên GitHub.

Không đưa `server/.env`, `node_modules` hoặc dữ liệu database cá nhân lên GitHub. Tệp `.env.example` là mẫu cấu hình dùng chung; mỗi người tạo `server/.env` riêng trên máy mình.

## Chức năng và quy tắc nghiệp vụ

- Phân quyền quản lý kho và nhân viên kho.
- Chỉ quản lý kho được duyệt phiếu.
- Tồn kho tăng khi phiếu nhập được duyệt và giảm khi phiếu xuất được duyệt.
- Phiếu xuất hỗ trợ FEFO, FIFO và LIFO.
- Không cho duyệt phiếu xuất nếu lượng tồn không đủ.
- Trường `minimum_stock` có trong database; giao diện và xử lý cảnh báo tồn kho chưa được phát triển.
