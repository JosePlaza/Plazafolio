-- Migration: Earnings Call Briefs table
-- Caches AI-generated dividend-focused briefs from earnings calls (~90 day TTL)

CREATE TABLE IF NOT EXISTS earnings_call_briefs (
  id TEXT PRIMARY KEY,                    -- 'NKE_Q4_2025'
  ticker TEXT NOT NULL,
  call_date TEXT,                         -- Date of the earnings call
  fiscal_period TEXT NOT NULL,            -- 'Q4 2025'
  brief TEXT,                             -- AI-generated dividend-focused brief
  tone TEXT,                              -- 'Confiado', 'Cauteloso', 'Evasivo', etc.
  sources JSONB,                          -- [{title, url}] from Google Search grounding
  has_transcript BOOLEAN DEFAULT FALSE,   -- Whether FMP transcript was available
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ecb_ticker ON earnings_call_briefs(ticker);
CREATE INDEX IF NOT EXISTS idx_ecb_expires ON earnings_call_briefs(expires_at);

-- RLS
ALTER TABLE earnings_call_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON earnings_call_briefs
  FOR SELECT USING (true);

CREATE POLICY "Allow service role write" ON earnings_call_briefs
  FOR ALL USING (true) WITH CHECK (true);
