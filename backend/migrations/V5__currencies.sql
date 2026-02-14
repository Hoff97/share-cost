-- Add currency support to groups and expenses
ALTER TABLE groups ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE expenses ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE expenses ADD COLUMN exchange_rate NUMERIC(12,6) NOT NULL DEFAULT 1.0;
