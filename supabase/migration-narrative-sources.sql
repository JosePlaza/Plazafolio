-- ============================================================================
-- Migration: Add narrative_sources column to financial_reports
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

-- Add column for grounding sources (array of {title, url} objects from Gemini)
alter table public.financial_reports
  add column if not exists narrative_sources jsonb default null;

-- Comment for documentation
comment on column public.financial_reports.narrative_sources
  is 'Array of {title, url} source references from Gemini Google Search grounding';
