-- MCP create_quotation idempotency (client_ref). No change to quotation_no triggers.

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS client_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_client_ref_unique
  ON public.quotations (client_ref)
  WHERE client_ref IS NOT NULL;
