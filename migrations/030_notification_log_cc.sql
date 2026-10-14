ALTER TABLE public.notification_log
  ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';
