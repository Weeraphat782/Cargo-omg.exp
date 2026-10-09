-- Read-only booking sheet link for customers (portal share to overseas consignee).
-- Separate from booking_share_token which allows air freight AWB upload via POST.

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS booking_view_token text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_quotations_booking_view_token
  ON public.quotations (booking_view_token)
  WHERE booking_view_token IS NOT NULL;
