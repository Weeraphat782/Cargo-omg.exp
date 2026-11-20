-- Snapshot stage + quotation statuses before Lose Case / Complete (MCP reopen_case).

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS closure_snapshot jsonb;

COMMENT ON COLUMN public.opportunities.closure_snapshot IS
  'JSON before close: {stage, quotations:[{id,status}], closed_at, closure_status}';