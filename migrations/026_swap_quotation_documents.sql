-- Swap entire document_submissions sets between two OMG (quotations) for the same customer.
-- Booking / quotation_no / AWB stay on each quotation; staff verify weight & proforma after swap.

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS docs_swapped_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_swapped_with text,
  ADD COLUMN IF NOT EXISTS docs_swapped_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS docs_swap_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_swap_checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.quotations_same_customer(qa public.quotations, qb public.quotations)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN qa.id = qb.id THEN false
      WHEN qa.company_id IS NOT NULL AND qb.company_id IS NOT NULL AND qa.company_id = qb.company_id THEN true
      WHEN qa.customer_user_id IS NOT NULL
        AND qb.customer_user_id IS NOT NULL
        AND qa.customer_user_id = qb.customer_user_id THEN true
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.swap_quotation_documents(p_a uuid, p_b uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  qa public.quotations%ROWTYPE;
  qb public.quotations%ROWTYPE;
  cnt_a int;
  cnt_b int;
  has_opp_col boolean;
BEGIN
  IF p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN
    RAISE EXCEPTION 'Select two different quotations';
  END IF;

  SELECT * INTO qa FROM public.quotations WHERE id = p_a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found: %', p_a;
  END IF;

  SELECT * INTO qb FROM public.quotations WHERE id = p_b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found: %', p_b;
  END IF;

  IF NOT public.quotations_same_customer(qa, qb) THEN
    RAISE EXCEPTION 'Quotations must belong to the same customer';
  END IF;

  UPDATE public.document_submissions
  SET quotation_id = CASE WHEN quotation_id = p_a THEN p_b ELSE p_a END
  WHERE quotation_id IN (p_a, p_b);

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_submissions'
      AND column_name = 'opportunity_id'
  ) INTO has_opp_col;

  IF has_opp_col THEN
    UPDATE public.document_submissions ds
    SET opportunity_id = q.opportunity_id
    FROM public.quotations q
    WHERE ds.quotation_id = q.id
      AND ds.quotation_id IN (p_a, p_b);
  END IF;

  UPDATE public.quotations
  SET
    docs_swapped_at = now(),
    docs_swapped_with = qb.quotation_no,
    docs_swapped_by = p_actor,
    docs_swap_checked_at = NULL,
    docs_swap_checked_by = NULL
  WHERE id = p_a;

  UPDATE public.quotations
  SET
    docs_swapped_at = now(),
    docs_swapped_with = qa.quotation_no,
    docs_swapped_by = p_actor,
    docs_swap_checked_at = NULL,
    docs_swap_checked_by = NULL
  WHERE id = p_b;

  SELECT count(*)::int INTO cnt_a FROM public.document_submissions WHERE quotation_id = p_a;
  SELECT count(*)::int INTO cnt_b FROM public.document_submissions WHERE quotation_id = p_b;

  RETURN jsonb_build_object(
    'quotation_a_id', p_a,
    'quotation_b_id', p_b,
    'omg_a', qa.quotation_no,
    'omg_b', qb.quotation_no,
    'doc_count_a', cnt_a,
    'doc_count_b', cnt_b
  );
END;
$$;

-- Called only from /api/document-submissions/swap (service role after staff check).
REVOKE EXECUTE ON FUNCTION public.swap_quotation_documents(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_quotation_documents(uuid, uuid, uuid) TO service_role;

-- VERIFY (manual, dev/staging):
-- 1) Pick two quotations with same company_id; note doc counts n_a, n_b.
-- 2) SELECT public.swap_quotation_documents('<uuid_a>', '<uuid_b>', '<staff_user_uuid>');
-- 3) Expect doc_count_a = n_b, doc_count_b = n_a; both rows have docs_swapped_at set.
-- 4) Third quotation from another customer should raise "same customer".
