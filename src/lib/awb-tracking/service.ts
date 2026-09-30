import { getSupabaseServerClient } from '@/lib/supabase/server';
import { DELIVERED_BCC, sendDeliveredNotification } from '@/lib/mail';
import {
  applyTrackingUpdate,
  carrierFromAwb,
  formatAwbDisplay,
  isStagePickedUpOrLater,
  mergeBookingAirFreightHints,
  normalizeAwb,
  resendDeliveredEmail,
  type ApplyTrackingInput,
  type BookingAirFreightJson,
  type QuotationRow,
  type TrackingDeps,
  type TrackingStatus,
} from './core';

const QUOTATION_TRACKING_SELECT =
  'id, quotation_no, awb_number, opportunity_id, carrier_code, carrier_code_manual, tracking_status, delivered_at, delivered_local_offset, delivery_notify_emails, customer_user_id, destination, requested_destination, customer_name, company_name, chargeable_weight, is_chargeable_weight_manual, manual_chargeable_weight, pallets, booking_air_freight, awb_origin, awb_destination, created_at';

function mapQuotationRow(data: Record<string, unknown>): QuotationRow {
  return {
    id: String(data.id),
    quotation_no: (data.quotation_no as string) ?? null,
    awb_number: (data.awb_number as string) ?? null,
    opportunity_id: (data.opportunity_id as string) ?? null,
    carrier_code: (data.carrier_code as string) ?? null,
    carrier_code_manual: Boolean(data.carrier_code_manual),
    tracking_status: (data.tracking_status as TrackingStatus) || 'not_tracked',
    delivered_at: (data.delivered_at as string) ?? null,
    delivered_local_offset: (data.delivered_local_offset as string) ?? null,
    delivery_notify_emails: (data.delivery_notify_emails as string[]) ?? [],
    customer_user_id: (data.customer_user_id as string) ?? null,
    destination: (data.destination as string) ?? null,
    requested_destination: (data.requested_destination as string) ?? null,
    customer_name: (data.customer_name as string) ?? null,
    company_name: (data.company_name as string) ?? null,
    chargeable_weight: data.chargeable_weight != null ? Number(data.chargeable_weight) : null,
    is_chargeable_weight_manual: Boolean(data.is_chargeable_weight_manual),
    manual_chargeable_weight:
      data.manual_chargeable_weight != null ? Number(data.manual_chargeable_weight) : null,
    pallets: data.pallets,
    booking_air_freight: (data.booking_air_freight as BookingAirFreightJson) ?? null,
    awb_origin: (data.awb_origin as string) ?? null,
    awb_destination: (data.awb_destination as string) ?? null,
  };
}

function referenceDateForList(row: {
  created_at?: string | null;
  opportunities?: { pickup_date?: string | null } | { pickup_date?: string | null }[] | null;
}): string | null {
  const opp = row.opportunities;
  const oppRow = Array.isArray(opp) ? opp[0] : opp;
  const pickup = oppRow?.pickup_date?.trim();
  if (pickup) return pickup.slice(0, 10);
  const created = row.created_at?.trim();
  return created ? created.slice(0, 10) : null;
}

function buildDeps(): TrackingDeps {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  return {
    findQuotationByAwb: async (normalized) => {
      const { data, error } = await supabase
        .from('quotations')
        .select(QUOTATION_TRACKING_SELECT)
        .eq('awb_normalized', normalized)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const row = data?.[0];
      return row ? mapQuotationRow(row as Record<string, unknown>) : null;
    },
    insertHistory: async (row) => {
      const { error } = await supabase.from('tracking_history').insert({
        quotation_id: row.quotation_id,
        awb_number: row.awb_number,
        status: row.status,
        raw_text: row.raw_text,
        source_url: row.source_url,
        checked_at: row.checked_at,
        created_by: row.created_by,
      });
      if (error) throw new Error(error.message);
    },
    mergeTrackingHints: async (quotationId, existing, hints) => {
      const merged = mergeBookingAirFreightHints(existing, hints);
      if (!merged) return;
      const { error } = await supabase
        .from('quotations')
        .update({ booking_air_freight: merged, updated_at: new Date().toISOString() })
        .eq('id', quotationId);
      if (error) throw new Error(error.message);
    },
    updateStatus: async (quotationId, patch) => {
      const { error } = await supabase
        .from('quotations')
        .update({
          tracking_status: patch.tracking_status,
          tracking_status_raw: patch.tracking_status_raw,
          tracking_checked_at: patch.tracking_checked_at,
          ...(patch.carrier_code !== undefined ? { carrier_code: patch.carrier_code } : {}),
          ...(patch.delivered_local_offset !== undefined
            ? { delivered_local_offset: patch.delivered_local_offset }
            : {}),
          ...(patch.awb_origin !== undefined ? { awb_origin: patch.awb_origin } : {}),
          ...(patch.awb_destination !== undefined ? { awb_destination: patch.awb_destination } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', quotationId);
      if (error) throw new Error(error.message);
    },
    claimDelivered: async (quotationId, deliveredAt, deliveredLocalOffset) => {
      const { data, error } = await supabase
        .from('quotations')
        .update({
          delivered_at: deliveredAt,
          tracking_status: 'delivered',
          ...(deliveredLocalOffset != null ? { delivered_local_offset: deliveredLocalOffset } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', quotationId)
        .is('delivered_at', null)
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data?.id);
    },
    getOpStage: async (opportunityId) => {
      const { data } = await supabase.from('opportunities').select('stage').eq('id', opportunityId).maybeSingle();
      return (data?.stage as string) ?? null;
    },
    listQuotationsForOp: async (opportunityId) => {
      const { data, error } = await supabase
        .from('quotations')
        .select('id, awb_number, delivered_at')
        .eq('opportunity_id', opportunityId);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; awb_number: string | null; delivered_at: string | null }[];
    },
    setOpStage: async (opportunityId, stage) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ stage, updated_at: new Date().toISOString() })
        .eq('id', opportunityId);
      if (error) throw new Error(error.message);
    },
    resolveRequesterEmail: async (quotation) => {
      if (quotation.customer_user_id) {
        const { data: profile, error: profileErr } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', quotation.customer_user_id)
          .maybeSingle();
        if (profileErr) throw new Error(profileErr.message);
        if (profile?.email) return profile.email as string;
      }
      const { data: qRow, error: qErr } = await supabase
        .from('quotations')
        .select('company_id')
        .eq('id', quotation.id)
        .maybeSingle();
      if (qErr) throw new Error(qErr.message);
      const companyId = qRow?.company_id as string | undefined;
      if (companyId) {
        const { data: company, error: coErr } = await supabase
          .from('companies')
          .select('contact_email')
          .eq('id', companyId)
          .maybeSingle();
        if (coErr) throw new Error(coErr.message);
        const contact = (company?.contact_email as string | undefined)?.trim();
        if (contact) return contact;
      }
      return null;
    },
    tryClaimAutoEmail: async (quotationId, recipients, bcc) => {
      const bccList = bcc.length ? bcc : [DELIVERED_BCC];
      const { error } = await supabase.from('notification_log').insert({
        quotation_id: quotationId,
        event: 'delivered',
        send_trigger: 'auto',
        status: 'sending',
        recipients,
        bcc: bccList,
        attempts: 0,
      });
      if (error) {
        if (error.code === '23505') return 'already';
        throw new Error(error.message);
      }
      return 'claimed';
    },
    sendDelivered: async (opts) => {
      const qRow = opts.quotation;
      const { data: full } = await supabase
        .from('quotations')
        .select(QUOTATION_TRACKING_SELECT)
        .eq('id', qRow.id)
        .maybeSingle();
      const quotation = full ? mapQuotationRow(full as Record<string, unknown>) : qRow;
      try {
        const result = await sendDeliveredNotification({
          quotation,
          recipients: opts.recipients,
          source_url: opts.source_url,
          delivered_at: opts.delivered_at,
          delivered_local_offset: quotation.delivered_local_offset ?? null,
        });
        return { ok: true, messageId: result?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
      }
    },
    finalizeAutoLog: async (quotationId, patch) => {
      const { error } = await supabase
        .from('notification_log')
        .update({
          status: patch.status,
          resend_message_id: patch.resend_message_id ?? null,
          attempts: patch.attempts,
          error: patch.error ?? null,
          sent_at: patch.sent_at ?? null,
        })
        .eq('quotation_id', quotationId)
        .eq('event', 'delivered')
        .eq('send_trigger', 'auto');
      if (error) throw new Error(error.message);
    },
    insertManualLog: async (quotationId, recipients, bcc) => {
      const bccList = bcc.length ? bcc : [DELIVERED_BCC];
      const { data, error } = await supabase
        .from('notification_log')
        .insert({
          quotation_id: quotationId,
          event: 'delivered',
          send_trigger: 'manual',
          status: 'sending',
          recipients,
          bcc: bccList,
          attempts: 0,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data.id as string;
    },
    updateManualLog: async (logId, patch) => {
      const { error } = await supabase
        .from('notification_log')
        .update({
          status: patch.status,
          resend_message_id: patch.resend_message_id ?? null,
          attempts: patch.attempts,
          error: patch.error ?? null,
          sent_at: patch.sent_at ?? null,
        })
        .eq('id', logId);
      if (error) throw new Error(error.message);
    },
  };
}

export async function updateAwbTracking(input: ApplyTrackingInput) {
  return applyTrackingUpdate(buildDeps(), input);
}

export async function listAwbsToTrack(opts?: { days?: number }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const days = opts?.days ?? 30;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffYmd = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('quotations')
    .select(
      `quotation_no, awb_number, carrier_code, carrier_code_manual, tracking_status, tracking_checked_at,
       destination, requested_destination, customer_name, company_name, opportunity_id, delivered_at, created_at,
       opportunities(stage, pickup_date)`
    )
    .not('awb_number', 'is', null)
    .neq('awb_number', '')
    .is('delivered_at', null);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const opp = row.opportunities as { stage?: string; pickup_date?: string | null } | null;
    const stage = opp?.stage || '';
    if (!isStagePickedUpOrLater(stage)) continue;

    const refYmd = referenceDateForList(row as { created_at?: string; opportunities?: typeof opp });
    if (refYmd && refYmd < cutoffYmd) continue;

    const norm = normalizeAwb(String(row.awb_number));
    const derived = norm ? carrierFromAwb(norm) : null;
    const manual = Boolean(row.carrier_code_manual);
    const stored = (row.carrier_code as string) || null;
    const carrier_code = manual && stored ? stored : stored || derived;

    out.push({
      omg_number: row.quotation_no,
      awb_number: row.awb_number,
      carrier_code,
      destination: row.destination || row.requested_destination,
      customer: row.customer_name || row.company_name,
      tracking_status: row.tracking_status || 'not_tracked',
      tracking_checked_at: row.tracking_checked_at,
    });
  }

  return out;
}

export async function resolveQuotation(ref: {
  awb_number?: string;
  omg_number?: string;
  quotation_id?: string;
}): Promise<QuotationRow | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotationId = ref.quotation_id?.trim();
  if (quotationId) {
    const { data, error } = await supabase
      .from('quotations')
      .select(QUOTATION_TRACKING_SELECT)
      .eq('id', quotationId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = data?.[0];
    return row ? mapQuotationRow(row as Record<string, unknown>) : null;
  }

  const omg = ref.omg_number?.trim().toUpperCase();
  if (omg) {
    const { data, error } = await supabase
      .from('quotations')
      .select(QUOTATION_TRACKING_SELECT)
      .eq('quotation_no', omg)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = data?.[0];
    return row ? mapQuotationRow(row as Record<string, unknown>) : null;
  }

  const awbRaw = ref.awb_number?.trim();
  if (awbRaw) {
    const normalized = normalizeAwb(awbRaw);
    if (!normalized) throw new Error('Invalid AWB.');
    const { data, error } = await supabase
      .from('quotations')
      .select(QUOTATION_TRACKING_SELECT)
      .eq('awb_normalized', normalized)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = data?.[0];
    return row ? mapQuotationRow(row as Record<string, unknown>) : null;
  }

  return null;
}

export async function getAwbTracking(ref: {
  awb_number?: string;
  omg_number?: string;
  quotation_id?: string;
}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await resolveQuotation(ref);
  if (!quotation) return null;

  const [{ data: history }, { data: notifications }] = await Promise.all([
    supabase
      .from('tracking_history')
      .select('*')
      .eq('quotation_id', quotation.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('notification_log')
      .select('*')
      .eq('quotation_id', quotation.id)
      .order('created_at', { ascending: false }),
  ]);

  return {
    quotation: {
      ...quotation,
      awb_display: quotation.awb_number
        ? formatAwbDisplay(normalizeAwb(quotation.awb_number) || quotation.awb_number.replace(/\D/g, ''))
        : null,
    },
    history: history ?? [],
    notifications: notifications ?? [],
  };
}

export async function manualMarkDelivered(
  ref: { awb_number?: string; omg_number?: string; quotation_id?: string },
  opts?: { send_email?: boolean }
) {
  const quotation = await resolveQuotation(ref);
  if (!quotation) throw new Error('Quotation not found.');
  const awb = quotation.awb_number?.trim();
  if (!awb) throw new Error('AWB not found on quotation.');

  return updateAwbTracking({
    awb_number: awb,
    status: 'delivered',
    raw_text: opts?.send_email === false ? 'Marked delivered (no email)' : 'Marked delivered (manual)',
    source_url: '',
    created_by: 'staff',
    send_email: opts?.send_email !== false,
  });
}

export async function manualResendDelivered(ref: { awb_number?: string; omg_number?: string; quotation_id?: string }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await resolveQuotation(ref);
  if (!quotation) throw new Error('Quotation not found.');
  if (!quotation.delivered_at) throw new Error('Shipment is not marked delivered yet.');

  const lastHistory = await supabase
    .from('tracking_history')
    .select('source_url')
    .eq('quotation_id', quotation.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return resendDeliveredEmail(
    buildDeps(),
    quotation,
    (lastHistory.data?.source_url as string) || '',
    quotation.delivered_at,
    [DELIVERED_BCC]
  );
}

export async function updateAwbNumber(input: { omg_number: string; awb_number: string; created_by?: string }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const normalized = normalizeAwb(input.awb_number);
  if (!normalized) throw new Error('Invalid AWB: must be 11 digits.');
  const display = formatAwbDisplay(normalized);

  const quotation = await resolveQuotation({ omg_number: input.omg_number });
  if (!quotation) throw new Error('Quotation not found.');

  const currentNorm = quotation.awb_number ? normalizeAwb(quotation.awb_number) : null;
  if (currentNorm === normalized) {
    return {
      changed: false,
      quotation_id: quotation.id,
      omg_number: quotation.quotation_no,
      awb_number: quotation.awb_number,
    };
  }

  const { data: dupRows, error: dupErr } = await supabase
    .from('quotations')
    .select('id, quotation_no')
    .eq('awb_normalized', normalized)
    .neq('id', quotation.id)
    .limit(1);
  if (dupErr) throw new Error(dupErr.message);
  const dup = dupRows?.[0] as { quotation_no?: string } | undefined;
  if (dup) {
    throw new Error(`AWB already used by ${dup.quotation_no || 'another quotation'}.`);
  }

  const oldAwb = quotation.awb_number;
  const hadDelivered = Boolean(quotation.delivered_at);
  const carrier =
    quotation.carrier_code_manual && quotation.carrier_code
      ? quotation.carrier_code
      : carrierFromAwb(normalized);

  const { error: updErr } = await supabase
    .from('quotations')
    .update({
      awb_number: display,
      tracking_status: 'not_tracked',
      tracking_status_raw: null,
      tracking_checked_at: null,
      delivered_at: null,
      delivered_local_offset: null,
      awb_origin: null,
      awb_destination: null,
      carrier_code: carrier,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quotation.id);
  if (updErr) throw new Error(updErr.message);

  const checkedAt = new Date().toISOString();
  const { error: histErr } = await supabase.from('tracking_history').insert({
    quotation_id: quotation.id,
    awb_number: display,
    status: 'not_tracked',
    raw_text: `AWB changed from ${oldAwb || '(none)'} to ${display}`,
    source_url: '',
    checked_at: checkedAt,
    created_by: input.created_by || 'mcp',
  });
  if (histErr) throw new Error(histErr.message);

  return {
    changed: true,
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no,
    old_awb: oldAwb,
    new_awb: display,
    carrier_code: carrier,
    delivered_reset: hadDelivered,
  };
}
