import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "../src/config.js";
import { migrateDocuments } from "./document-migration.js";

const connection = await mysql.createConnection({ ...config.db, multipleStatements: true });
try {
  const sql = await readFile(new URL("../../database/migrations/001_issue_adjustments.sql", import.meta.url), "utf8");
  await connection.query(sql);
  await migrateDocuments(connection);
  console.log("Đã cập nhật database: FEFO/FIFO/LIFO, chống trùng phiếu và lý do từ chối. Dữ liệu hiện có được giữ lại.");
} finally {
  await connection.end();
}
