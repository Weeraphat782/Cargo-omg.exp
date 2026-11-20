-- Customer quote request: acknowledgment of 48-72h change / penalty policy before submit.

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS change_policy_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS change_policy_ack_by uuid,
  ADD COLUMN IF NOT EXISTS change_policy_version text;

COMMENT ON COLUMN public.quotations.change_policy_ack_at IS 'When customer accepted change/penalty policy on quote request';
COMMENT ON COLUMN public.quotations.change_policy_version IS 'Wording version id, e.g. 48-72h-v1';