-- Document replace (MCP): keep superseded rows for audit; activity log for replaces.

ALTER TABLE public.document_submissions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.document_submissions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by text;

CREATE INDEX IF NOT EXISTS idx_document_submissions_current
  ON public.document_submissions (quotation_id, document_type)
  WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS public.quotation_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_activity_log_quotation
  ON public.quotation_activity_log (quotation_id, created_at DESC);

ALTER TABLE public.quotation_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read quotation_activity_log" ON public.quotation_activity_log;
CREATE POLICY "Staff read quotation_activity_log" ON public.quotation_activity_log
  FOR SELECT TO authenticated
  USING (public.is_staff_or_admin());
