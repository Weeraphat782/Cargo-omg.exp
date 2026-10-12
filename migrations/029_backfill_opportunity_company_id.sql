-- Op cards created without company_id: copy it from the linked quotation.
UPDATE public.opportunities o
SET company_id = q.company_id
FROM (
  SELECT DISTINCT ON (opportunity_id) opportunity_id, company_id
  FROM public.quotations
  WHERE opportunity_id IS NOT NULL AND company_id IS NOT NULL
  ORDER BY opportunity_id, created_at
) q
WHERE o.id = q.opportunity_id
  AND o.company_id IS NULL;
