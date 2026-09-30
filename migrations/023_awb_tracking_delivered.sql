-- AWB airline tracking, delivered notifications, notify recipient lists
-- Run in Supabase SQL editor

-- =====================
-- quotations: tracking + notify list
-- =====================
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS carrier_code text,
  ADD COLUMN IF NOT EXISTS carrier_code_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracking_status text NOT NULL DEFAULT 'not_tracked',
  ADD COLUMN IF NOT EXISTS tracking_status_raw text,
  ADD COLUMN IF NOT EXISTS tracking_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_local_offset text,
  ADD COLUMN IF NOT EXISTS delivery_notify_emails text[] NOT NULL DEFAULT '{}';

ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_tracking_status_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_tracking_status_check
  CHECK (tracking_status IN (
    'not_tracked', 'booked', 'departed', 'in_transit', 'arrived', 'delivered', 'exception'
  ));

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS awb_normalized text
  GENERATED ALWAYS AS (NULLIF(regexp_replace(COALESCE(awb_number, ''), '\D', '', 'g'), '')) STORED;

CREATE INDEX IF NOT EXISTS idx_quotations_awb_normalized ON quotations (awb_normalized)
  WHERE awb_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotations_delivered_at ON quotations (delivered_at)
  WHERE delivered_at IS NULL AND awb_number IS NOT NULL AND awb_number <> '';

-- =====================
-- tracking_history (append-only audit)
-- =====================
CREATE TABLE IF NOT EXISTS public.tracking_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  awb_number text NOT NULL,
  status text NOT NULL,
  raw_text text,
  source_url text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_history_quotation_id ON public.tracking_history (quotation_id, created_at DESC);

ALTER TABLE public.tracking_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read tracking_history" ON public.tracking_history;
CREATE POLICY "Staff read tracking_history" ON public.tracking_history
  FOR SELECT TO authenticated
  USING (public.is_staff_or_admin());

DROP POLICY IF EXISTS "Customers read own tracking_history" ON public.tracking_history;
CREATE POLICY "Customers read own tracking_history" ON public.tracking_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quotations q
      WHERE q.id = tracking_history.quotation_id
        AND q.customer_user_id = auth.uid()
    )
  );

-- Inserts via service role only (no INSERT policy for authenticated)

-- =====================
-- notification_log
-- =====================
CREATE TABLE IF NOT EXISTS public.notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  event text NOT NULL DEFAULT 'delivered',
  send_trigger text NOT NULL CHECK (send_trigger IN ('auto', 'manual')),
  recipients text[] NOT NULL DEFAULT '{}',
  bcc text[] NOT NULL DEFAULT '{}',
  resend_message_id text,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_log_auto_delivered_unique
  ON public.notification_log (quotation_id, event)
  WHERE send_trigger = 'auto';

CREATE INDEX IF NOT EXISTS idx_notification_log_quotation_id ON public.notification_log (quotation_id, created_at DESC);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read notification_log" ON public.notification_log;
CREATE POLICY "Staff read notification_log" ON public.notification_log
  FOR SELECT TO authenticated
  USING (public.is_staff_or_admin());

-- =====================
-- saved_notify_recipients (customer portal)
-- =====================
CREATE TABLE IF NOT EXISTS public.saved_notify_recipients (
  customer_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  emails text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.saved_notify_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Customers manage own saved_notify_recipients" ON public.saved_notify_recipients;
CREATE POLICY "Customers manage own saved_notify_recipients" ON public.saved_notify_recipients
  FOR ALL TO authenticated
  USING (customer_user_id = auth.uid())
  WITH CHECK (customer_user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read saved_notify_recipients" ON public.saved_notify_recipients;
CREATE POLICY "Staff read saved_notify_recipients" ON public.saved_notify_recipients
  FOR SELECT TO authenticated
  USING (public.is_staff_or_admin());
