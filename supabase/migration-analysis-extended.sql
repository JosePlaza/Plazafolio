-- Add cashFlow and fundamentals columns to the analyses table
ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS cash_flow jsonb DEFAULT null;
ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS fundamentals jsonb DEFAULT null;
