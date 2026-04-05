-- Add audio_url column to store the Supabase Storage URL for TTS narration
ALTER TABLE public.financial_reports ADD COLUMN IF NOT EXISTS audio_url text DEFAULT null;

-- Create Storage bucket 'reports' (run via Supabase Dashboard > Storage if this doesn't work in SQL Editor)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('reports', 'reports', true) ON CONFLICT DO NOTHING;
