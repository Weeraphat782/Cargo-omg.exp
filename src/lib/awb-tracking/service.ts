import { getSupabaseServerClient } from '@/lib/supabase/server';
import { sendDeliveredNotification } from '@/lib/mail';
import {
  applyTrackingUpdate,
  formatAwbDisplay,
  isStagePickedUpOrLater,
  normalizeAwb,
  resendDeliveredEmail,
  type ApplyTrackingInput,
  type QuotationRow,
  type TrackingDeps,
  type TrackingStatus,
} from './core';

const QUOTATION_TRACKING_SELECT =
  'id, quotation_no, awb_number, opportunity_id, carrier_code, carrier_code_manual, tracking_status, delivered_at, delivery_notify_emails, customer_user_id, destination, requested_destination, customer_name, company_name, chargeable_weight, pallets, booking_air_freight, delivered_local_offset';

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
    delivery_notify_emails: (data.delivery_notify_emails as string[]) ?? [],
    customer_user_id: (data.customer_user_id as string) ?? null,
    destination: (data.destination as string) ?? null,
    requested_destination: (data.requested_destination as string) ?? null,
    customer_name: (data.customer_name as string) ?? null,
    company_name: (data.company_name as string) ?? null,
    chargeable_weight: data.chargeable_weight != null ? Number(data.chargeable_weight) : null,
    pallets: data.pallets,
    booking_air_freight: (data.booking_air_freight as QuotationRow['booking_air_freight']) ?? null,
  };
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
        .maybeSingle();
      if (error || !data) return null;
      return mapQuotationRow(data as Record<string, unknown>);
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
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', quotation.customer_user_id)
          .maybeSingle();
        if (profile?.email) return profile.email as string;
      }
      return null;
    },
    tryClaimAutoEmail: async (quotationId) => {
      const { error } = await supabase.from('notification_log').insert({
        quotation_id: quotationId,
        event: 'delivered',
        send_trigger: 'auto',
        status: 'sending',
        recipients: [],
        bcc: ['cargo@omgexp.com'],
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
      const offsetRow = full as { delivered_local_offset?: string | null } | null;
      try {
        const result = await sendDeliveredNotification({
          quotation,
          recipients: opts.recipients,
          source_url: opts.source_url,
          delivered_at: opts.delivered_at,
          delivered_local_offset: offsetRow?.delivered_local_offset ?? null,
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
    insertManualLog: async (quotationId, recipients) => {
      const { data, error } = await supabase
        .from('notification_log')
        .insert({
          quotation_id: quotationId,
          event: 'delivered',
          send_trigger: 'manual',
          status: 'sending',
          recipients,
          bcc: ['cargo@omgexp.com'],
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

export async function listAwbsToTrack() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const { data, error } = await supabase
    .from('quotations')
    .select(
      `quotation_no, awb_number, carrier_code, tracking_status, tracking_checked_at,
       destination, requested_destination, customer_name, company_name, opportunity_id, delivered_at`
    )
    .not('awb_number', 'is', null)
    .neq('awb_number', '')
    .is('delivered_at', null);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const oppId = row.opportunity_id as string | null;
    if (!oppId) continue;
    const { data: opp } = await supabase.from('opportunities').select('stage').eq('id', oppId).maybeSingle();
    const stage = (opp?.stage as string) || '';
    if (!isStagePickedUpOrLater(stage)) continue;

    out.push({
      omg_number: row.quotation_no,
      awb_number: row.awb_number,
      carrier_code: row.carrier_code,
      destination: row.destination || row.requested_destination,
      customer: row.customer_name || row.company_name,
      tracking_status: row.tracking_status || 'not_tracked',
      tracking_checked_at: row.tracking_checked_at,
    });
  }

  return out;
}

async function fetchQuotationByRef(ref: { awb_number?: string; omg_number?: string }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  if (ref.awb_number) {
    const normalized = normalizeAwb(ref.awb_number);
    if (!normalized) throw new Error('Invalid AWB.');
    const { data } = await supabase
      .from('quotations')
      .select(QUOTATION_TRACKING_SELECT)
      .eq('awb_normalized', normalized)
      .maybeSingle();
    return data ? mapQuotationRow(data as Record<string, unknown>) : null;
  }
  if (ref.omg_number) {
    const { data } = await supabase
      .from('quotations')
      .select(QUOTATION_TRACKING_SELECT)
      .eq('quotation_no', ref.omg_number)
      .maybeSingle();
    return data ? mapQuotationRow(data as Record<string, unknown>) : null;
  }
  return null;
}

export async function getAwbTracking(ref: { awb_number?: string; omg_number?: string }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(ref);
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

export async function manualMarkDelivered(ref: { awb_number?: string; omg_number?: string; quotation_id?: string }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  let awb = ref.awb_number;
  if (!awb && ref.omg_number) {
    const q = await fetchQuotationByRef({ omg_number: ref.omg_number });
    awb = q?.awb_number ?? undefined;
  }
  if (!awb && ref.quotation_id) {
    const { data } = await supabase.from('quotations').select('awb_number').eq('id', ref.quotation_id).maybeSingle();
    awb = (data?.awb_number as string) ?? undefined;
  }
  if (!awb) throw new Error('AWB not found.');

  return updateAwbTracking({
    awb_number: awb,
    status: 'delivered',
    raw_text: 'Marked delivered (manual)',
    source_url: '',
    created_by: 'staff',
  });
}

export async function manualResendDelivered(ref: { awb_number?: string; omg_number?: string; quotation_id?: string }) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  let quotation: QuotationRow | null = null;
  if (ref.awb_number) quotation = await fetchQuotationByRef({ awb_number: ref.awb_number });
  else if (ref.omg_number) quotation = await fetchQuotationByRef({ omg_number: ref.omg_number });
  else if (ref.quotation_id) {
    const { data } = await supabase
      .from('quotations')
      .select(QUOTATION_TRACKING_SELECT)
      .eq('id', ref.quotation_id)
      .maybeSingle();
    quotation = data ? mapQuotationRow(data as Record<string, unknown>) : null;
  }
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
    quotation.delivered_at
  );
}
