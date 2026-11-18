-- Shipment Change Control: SLOT (capacity) vs JOB (quotation / OMG#)

CREATE TABLE IF NOT EXISTS public.cc_month_counters (
  ym text PRIMARY KEY,
  n int NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_change_set_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text := to_char(now() AT TIME ZONE 'UTC', 'YYMM');
  next_n int;
BEGIN
  INSERT INTO public.cc_month_counters (ym, n)
  VALUES (prefix, 1)
  ON CONFLICT (ym) DO UPDATE SET n = public.cc_month_counters.n + 1
  RETURNING n INTO next_n;
  RETURN 'CS-' || prefix || '-' || lpad(next_n::text, 3, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  airline text NOT NULL DEFAULT '',
  flight_no text NOT NULL DEFAULT '',
  flight_date date,
  load_date date,
  awb_number text,
  booked_pallets int NOT NULL DEFAULT 1 CHECK (booked_pallets > 0),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'confirmed', 'loaded', 'departed', 'cancelled')),
  confirmed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slots_awb_unique
  ON public.slots (awb_number)
  WHERE awb_number IS NOT NULL AND awb_number <> '';

CREATE INDEX IF NOT EXISTS idx_slots_load_date ON public.slots (load_date);

CREATE TABLE IF NOT EXISTS public.change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'applied', 'cancelled')),
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.slot_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.slots(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_assignments_one_job_per_slot
  ON public.slot_assignments (slot_id)
  WHERE active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_assignments_one_slot_per_job
  ON public.slot_assignments (quotation_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_slot_assignments_quotation
  ON public.slot_assignments (quotation_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS public.change_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id uuid NOT NULL REFERENCES public.change_sets(id) ON DELETE CASCADE,
  seq int NOT NULL,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  from_slot_id uuid REFERENCES public.slots(id) ON DELETE SET NULL,
  to_slot_id uuid REFERENCES public.slots(id) ON DELETE SET NULL,
  move_type text NOT NULL
    CHECK (move_type IN ('replace', 'swap', 'move', 'park', 'new_booking')),
  new_slot jsonb,
  UNIQUE (change_set_id, seq)
);

CREATE TABLE IF NOT EXISTS public.slot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid REFERENCES public.slots(id) ON DELETE SET NULL,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL,
  event text NOT NULL,
  before jsonb NOT NULL DEFAULT '{}',
  after jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slot_events_quotation
  ON public.slot_events (quotation_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.change_sets_set_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := public.next_change_set_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_change_sets_code ON public.change_sets;
CREATE TRIGGER trg_change_sets_code
  BEFORE INSERT ON public.change_sets
  FOR EACH ROW
  EXECUTE FUNCTION public.change_sets_set_code();

CREATE OR REPLACE FUNCTION public.apply_change_set(p_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cs public.change_sets%ROWTYPE;
  mv public.change_moves%ROWTYPE;
  new_slot uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff_or_admin() THEN
    RAISE EXCEPTION 'Staff only';
  END IF;

  SELECT * INTO cs FROM public.change_sets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Change set not found';
  END IF;
  IF cs.status <> 'draft' THEN
    RAISE EXCEPTION 'Change set is not draft';
  END IF;

  FOR mv IN
    SELECT * FROM public.change_moves
    WHERE change_set_id = p_id
    ORDER BY seq
  LOOP
    IF mv.move_type = 'new_booking' AND mv.to_slot_id IS NULL AND mv.new_slot IS NOT NULL THEN
      INSERT INTO public.slots (
        airline, flight_no, flight_date, load_date, awb_number, booked_pallets, status
      )
      VALUES (
        COALESCE(mv.new_slot->>'airline', ''),
        COALESCE(mv.new_slot->>'flight_no', ''),
        NULLIF(mv.new_slot->>'flight_date', '')::date,
        NULLIF(mv.new_slot->>'load_date', '')::date,
        NULLIF(mv.new_slot->>'awb_number', ''),
        GREATEST(COALESCE((mv.new_slot->>'booked_pallets')::int, 1), 1),
        'requested'
      )
      RETURNING id INTO new_slot;
      UPDATE public.change_moves SET to_slot_id = new_slot WHERE id = mv.id;
      mv.to_slot_id := new_slot;
    END IF;

    UPDATE public.slot_assignments
    SET active = false, ended_at = now()
    WHERE quotation_id = mv.quotation_id AND active = true;

    IF mv.to_slot_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.slot_assignments
        WHERE slot_id = mv.to_slot_id AND active = true
      ) THEN
        RAISE EXCEPTION 'Slot % already has an active job', mv.to_slot_id;
      END IF;
      INSERT INTO public.slot_assignments (slot_id, quotation_id, active, change_set_id)
      VALUES (mv.to_slot_id, mv.quotation_id, true, p_id);
    END IF;

    INSERT INTO public.slot_events (
      slot_id, quotation_id, change_set_id, event, before, after
    )
    VALUES (
      COALESCE(mv.to_slot_id, mv.from_slot_id),
      mv.quotation_id,
      p_id,
      mv.move_type,
      jsonb_build_object('from_slot_id', mv.from_slot_id),
      jsonb_build_object('to_slot_id', mv.to_slot_id)
    );
  END LOOP;

  FOR mv IN
    SELECT DISTINCT quotation_id FROM public.change_moves WHERE change_set_id = p_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.slot_assignments
      WHERE quotation_id = mv.quotation_id AND active = true
    ) THEN
      RAISE EXCEPTION 'Job % left in parking without target', mv.quotation_id;
    END IF;
  END LOOP;

  UPDATE public.quotations q
  SET awb_number = s.awb_number,
      awb_number_source = COALESCE(q.awb_number_source, 'change_control')
  FROM public.slot_assignments sa
  JOIN public.slots s ON s.id = sa.slot_id
  WHERE sa.quotation_id = q.id
    AND sa.active = true
    AND s.awb_number IS NOT NULL
    AND q.id IN (SELECT quotation_id FROM public.change_moves WHERE change_set_id = p_id);

  UPDATE public.change_sets
  SET status = 'applied', applied_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'code', cs.code, 'actor', p_actor);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_change_set(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_change_set(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_slots ON public.slots;
CREATE POLICY staff_slots ON public.slots
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS staff_slot_assignments ON public.slot_assignments;
CREATE POLICY staff_slot_assignments ON public.slot_assignments
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS staff_change_sets ON public.change_sets;
CREATE POLICY staff_change_sets ON public.change_sets
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS staff_change_moves ON public.change_moves;
CREATE POLICY staff_change_moves ON public.change_moves
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

DROP POLICY IF EXISTS staff_slot_events ON public.slot_events;
CREATE POLICY staff_slot_events ON public.slot_events
  FOR ALL TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

-- Backfill one slot per distinct AWB; oldest quotation gets the active assignment
INSERT INTO public.slots (airline, flight_no, load_date, awb_number, booked_pallets, status, confirmed_at)
SELECT DISTINCT ON (q.awb_normalized)
  COALESCE(NULLIF(trim(q.carrier_code), ''), ''),
  '',
  q.created_at::date,
  NULLIF(trim(q.awb_number), ''),
  GREATEST(
    CASE
      WHEN q.pallets IS NULL THEN 1
      WHEN jsonb_typeof(q.pallets::jsonb) = 'array' THEN jsonb_array_length(q.pallets::jsonb)
      ELSE 1
    END,
    1
  ),
  'confirmed',
  now()
FROM public.quotations q
WHERE q.awb_normalized IS NOT NULL
  AND q.awb_number IS NOT NULL
  AND q.awb_number <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.slots s
    WHERE s.awb_number = NULLIF(trim(q.awb_number), '')
  )
ORDER BY q.awb_normalized, q.created_at ASC;

INSERT INTO public.slot_assignments (slot_id, quotation_id, active)
SELECT s.id, q.id, true
FROM public.quotations q
JOIN public.slots s ON s.awb_number = NULLIF(trim(q.awb_number), '')
WHERE q.awb_normalized IS NOT NULL
  AND q.awb_number IS NOT NULL
  AND q.awb_number <> ''
  AND q.id = (
    SELECT q2.id FROM public.quotations q2
    WHERE q2.awb_normalized = q.awb_normalized
    ORDER BY q2.created_at ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.slot_assignments sa
    WHERE sa.quotation_id = q.id AND sa.active = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.slot_assignments sa
    WHERE sa.slot_id = s.id AND sa.active = true
  );

-- VERIFY: AWBs with multiple OMG# (manual reconcile)
-- SELECT s.awb_number, count(DISTINCT q.id) FROM quotations q
-- JOIN slots s ON s.awb_number = trim(q.awb_number)
-- WHERE q.awb_normalized IS NOT NULL GROUP BY s.awb_number HAVING count(DISTINCT q.id) > 1;