-- Non-destructive upgrade for existing databases. Safe to run again.
CREATE TABLE IF NOT EXISTS stock_issue_adjustments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  issue_id INT NOT NULL UNIQUE,
  reason VARCHAR(1000) NOT NULL,
  adjusted_by INT NOT NULL,
  adjusted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  suggested_allocations JSON NOT NULL,
  selected_allocations JSON NOT NULL,
  CONSTRAINT fk_adjustment_issue FOREIGN KEY (issue_id) REFERENCES stock_issues(id),
  CONSTRAINT fk_adjustment_user FOREIGN KEY (adjusted_by) REFERENCES users(id)
);

-- LIFO is supported again; preserve the policy of all existing documents.
