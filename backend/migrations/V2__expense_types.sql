-- Add expense type: 'expense' (default), 'transfer', 'income'
ALTER TABLE expenses ADD COLUMN expense_type VARCHAR(20) NOT NULL DEFAULT 'expense';

-- For transfers: who receives the money
ALTER TABLE expenses ADD COLUMN transfer_to UUID REFERENCES members(id) ON DELETE CASCADE;
