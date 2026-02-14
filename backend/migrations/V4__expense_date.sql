ALTER TABLE expenses ADD COLUMN expense_date DATE NOT NULL DEFAULT CURRENT_DATE;
-- Backfill existing expenses with their created_at date
UPDATE expenses SET expense_date = DATE(created_at);
