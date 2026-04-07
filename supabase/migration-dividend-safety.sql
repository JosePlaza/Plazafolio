-- Migration: Dividend Safety Radar table
-- Creates a cache table for dividend safety scores with 24h TTL

CREATE TABLE IF NOT EXISTS dividend_safety (
  ticker TEXT PRIMARY KEY,
  score NUMERIC(3,1) NOT NULL,           -- 1.0-10.0
  level TEXT NOT NULL,                    -- 'Seguro', 'Moderado', 'Alto Riesgo'
  color TEXT NOT NULL,                    -- 'green', 'yellow', 'red'
  summary TEXT,                           -- One-liner summary
  is_reit BOOLEAN DEFAULT FALSE,
  factors JSONB,                          -- Array of factor objects
  analysis TEXT,                          -- Gemini-generated analysis
  sources JSONB,                          -- [{title, url}] from Google Search grounding
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

-- Index for expiration checks
CREATE INDEX IF NOT EXISTS idx_dividend_safety_expires ON dividend_safety(expires_at);

-- Allow public read access (no RLS needed for cache)
ALTER TABLE dividend_safety ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON dividend_safety
  FOR SELECT USING (true);

CREATE POLICY "Allow service role write" ON dividend_safety
  FOR ALL USING (true) WITH CHECK (true);
