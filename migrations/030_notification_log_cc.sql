-- Required for delivered email logging (To/CC/BCC). Run on Supabase production if inserts fail on missing "cc".
ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';
