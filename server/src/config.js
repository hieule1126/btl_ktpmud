import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3001),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "development-secret-change-me",
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "warehouse_management",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || ""
  }
};

