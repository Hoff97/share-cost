-- Add split_type to expenses (equal, percentage, exact)
ALTER TABLE expenses ADD COLUMN split_type VARCHAR(20) NOT NULL DEFAULT 'equal';

-- Add share column to expense_splits for percentage/exact amounts
-- For 'equal': NULL (computed as amount / count)
-- For 'percentage': stores the percentage (0-100) for this member
-- For 'exact': stores the absolute amount in expense currency
ALTER TABLE expense_splits ADD COLUMN share DECIMAL(12, 4) DEFAULT NULL;
