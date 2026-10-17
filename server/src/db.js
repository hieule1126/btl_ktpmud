import mysql from "mysql2/promise";
import { config } from "./config.js";

export const db = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

