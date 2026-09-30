-- AWB route from airline tracking (IATA origin/destination for delivered email)
-- Run in Supabase SQL editor

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS awb_origin text,
  ADD COLUMN IF NOT EXISTS awb_destination text;
