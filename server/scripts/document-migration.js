// Additive and restartable: existing documents retain NULL request keys.
export async function migrateDocuments(connection) {
  for (const [table, index] of [["stock_receipts", "uq_receipt_request"], ["stock_issues", "uq_issue_request"]]) {
    const [columns] = await connection.query(`SHOW COLUMNS FROM ${table}`);
    for (const [name, definition] of [["request_key", "CHAR(36) NULL"], ["request_hash", "CHAR(64) NULL"], ["rejection_reason", "VARCHAR(1000) NULL"]]) {
      if (!columns.some(column => column.Field === name)) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
    const [indexes] = await connection.query(`SHOW INDEX FROM ${table}`);
    if (!indexes.some(row => row.Key_name === index)) await connection.query(`ALTER TABLE ${table} ADD CONSTRAINT ${index} UNIQUE (created_by, request_key)`);
  }
  const [columns] = await connection.query("SHOW COLUMNS FROM stock_issues LIKE 'strategy'");
  if (!columns[0].Type.includes("'LIFO'")) await connection.query("ALTER TABLE stock_issues MODIFY strategy ENUM('FEFO', 'FIFO', 'LIFO') NOT NULL DEFAULT 'FEFO'");
}
