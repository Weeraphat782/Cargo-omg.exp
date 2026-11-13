-- Staff can read/update all quotation documents (matches quotations_staff_admin_policy on quotations).
-- Removes the pending_approval-only SELECT/UPDATE workaround that hid docs after approve
-- and allowed any authenticated user to read pending docs.

DROP POLICY IF EXISTS "staff_can_view_pending_approval_documents"
  ON public.document_submissions;

DROP POLICY IF EXISTS "staff_can_update_pending_approval_documents"
  ON public.document_submissions;

CREATE POLICY "staff_read_all_document_submissions"
  ON public.document_submissions
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

CREATE POLICY "staff_update_all_document_submissions"
  ON public.document_submissions
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- VERIFY (Supabase SQL Editor after Run):
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'document_submissions'
-- ORDER BY policyname;
-- Expect staff_read_all_document_submissions + staff_update_all_document_submissions;
-- no staff_can_view_pending_approval_documents.
