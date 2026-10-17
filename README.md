# Phần mềm quản lý kho hàng

Ứng dụng web MVP hỗ trợ quản lý sản phẩm, lô hàng, phiếu nhập/xuất, phê duyệt và xuất hàng theo FEFO/FIFO/LIFO.

## Yêu cầu

- Node.js 20+
- Docker Desktop (chỉ dùng để chạy MySQL, không cần MySQL Workbench)

## Chạy ứng dụng

1. Mở terminal tích hợp trong VS Code ở thư mục gốc, sau đó khởi chạy MySQL:

   ```powershell
   docker compose up -d
   ```

   Docker sẽ tự tạo database, bảng và dữ liệu mẫu từ `database/schema.sql` trong lần chạy đầu tiên.

2. Sao chép `server/.env.example` thành `server/.env`. Mật khẩu mặc định đã khớp với Docker là `kho123456`.

3. Mở hai terminal trong thư mục gốc dự án:

   ```powershell
   cd server
   npm install
   npm run dev
   ```

   ```powershell
   cd client
   npm install
   npm run dev
   ```

4. Truy cập địa chỉ Vite in ra, thường là `http://localhost:5173`.

Tài khoản mẫu: `quanly@kho.local` / `123456` hoặc `nhanvien@kho.local` / `123456`.

## Làm hoàn toàn trong VS Code

Sau khi cài Docker Desktop một lần, mọi thao tác được thực hiện từ terminal VS Code:

```powershell
# Kiểm tra database
docker compose ps

# Xem log MySQL khi cần
docker compose logs -f mysql

# Dừng database nhưng giữ dữ liệu
docker compose stop

# Khởi động lại database
docker compose start
```

Không cần MySQL Workbench. Để xem dữ liệu trực quan trong VS Code, cài hai extension `SQLTools` và `SQLTools MySQL/MariaDB`, sau đó kết nối `127.0.0.1`, cổng `3306`, người dùng `root`, mật khẩu `kho123456`, database `warehouse_management`.

## Quy tắc nghiệp vụ

- Chỉ quản lý kho có thể phê duyệt phiếu.
- Tồn kho chỉ tăng khi phiếu nhập được phê duyệt.
- Tồn kho chỉ giảm khi phiếu xuất được phê duyệt.
- Phiếu xuất mặc định dùng FEFO; người lập có thể chọn FIFO hoặc LIFO.
- Hệ thống từ chối duyệt phiếu xuất khi không đủ tồn kho.
- Cảnh báo tồn kho được để trong cấu trúc dữ liệu (`minimum_stock`) nhưng chưa phát triển giao diện/xử lý theo yêu cầu.

