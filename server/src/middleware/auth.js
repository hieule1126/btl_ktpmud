import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Bạn chưa đăng nhập." });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." });
  }
}

export function requireManager(req, res, next) {
  if (req.user?.role !== "WAREHOUSE_MANAGER") {
    return res.status(403).json({ message: "Chỉ quản lý kho được thực hiện thao tác này." });
  }
  next();
}

