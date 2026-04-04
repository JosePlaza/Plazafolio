-- Add currency column to transactions table (if already created without it)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
