import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_OPPORTUNITY_OWNER_EMAIL = 'vieww.weeraphat@gmail.com';

export async function resolveOpportunityOwnerId(
  supabase: SupabaseClient,
  ref: { owner_id?: string; owner_email?: string }
): Promise<string> {
  if (ref.owner_id?.trim()) return ref.owner_id.trim();

  const email =
    ref.owner_email?.trim() ||
    process.env.OPPORTUNITY_OWNER_EMAIL?.trim() ||
    DEFAULT_OPPORTUNITY_OWNER_EMAIL;

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.id) return data.id;

  throw new Error(
    'Set OPPORTUNITY_OWNER_EMAIL (or pass owner_email/owner_id) to a staff profile so the Op card shows in the Opportunities UI'
  );
}
