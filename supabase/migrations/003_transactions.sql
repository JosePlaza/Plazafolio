-- ═══ Transactions table ═══
-- Stores buy/sell transactions per asset per user.
-- shares > 0 = buy, shares < 0 = sell
-- The asset's total shares and weighted avg entry price are derived from this table.

CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,                     -- matches assets.id (text-based IDs)
  ticker TEXT NOT NULL,                       -- denormalized for fast lookups
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  shares NUMERIC(14,4) NOT NULL,              -- positive = buy, negative = sell
  price_per_share NUMERIC(14,4) NOT NULL,     -- price at time of transaction
  currency TEXT NOT NULL DEFAULT 'USD',       -- currency of price_per_share ('USD' or 'EUR')
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_user_asset ON transactions(user_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_ticker ON transactions(user_id, ticker);

-- RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);
