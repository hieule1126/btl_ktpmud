import express from "express";
import cors from "cors";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import catalogRoutes from "./routes/catalog.js";
import warehouseRoutes from "./routes/warehouse.js";

const app = express();
const allowedOrigins = [config.clientUrl, "http://localhost:5173", "http://localhost:5174"];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use((error, _req, res, _next) => {
  console.error(error);
  const duplicate = error.code === "ER_DUP_ENTRY";
  res.status(duplicate ? 409 : 400).json({ message: duplicate ? "Dữ liệu đã tồn tại." : error.message || "Đã xảy ra lỗi máy chủ." });
});
app.listen(config.port, () => console.log(`API chạy tại http://localhost:${config.port}`));

