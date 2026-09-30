/** Pure AWB tracking logic (no Supabase) — importable from verify script. */

export const TRACKING_STATUSES = [
  'not_tracked',
  'booked',
  'departed',
  'in_transit',
  'arrived',
  'delivered',
  'exception',
] as const;

export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

const AWB_PREFIX_CARRIER: Record<string, string> = {
  '217': 'TG',
  '157': 'QR',
};

export const STAGES_PICKED_UP_OR_LATER = ['picked_up', 'delivered', 'payment_received'] as const;

export const STAGE_ORDER = [
  'inquiry',
  'quoting',
  'pending_docs',
  'pending_booking',
  'booking_requested',
  'awb_received',
  'waiting_for_pickup',
  'picked_up',
  'delivered',
  'payment_received',
] as const;

export function normalizeAwb(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return digits;
}

export function formatAwbDisplay(normalized: string): string {
  if (normalized.length !== 11) return normalized;
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 7)} ${normalized.slice(7)}`;
}

export function carrierFromAwb(normalized: string): string | null {
  return AWB_PREFIX_CARRIER[normalized.slice(0, 3)] ?? null;
}

export function resolveDeliveredRecipients(opts: {
  notifyEmails: string[];
  requesterEmail: string | null | undefined;
  companyEmail?: string | null;
}): string[] {
  const requester = (opts.requesterEmail || opts.companyEmail || '').trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!e || !e.includes('@') || seen.has(e)) return;
    seen.add(e);
    out.push(e);
  };

  for (const e of opts.notifyEmails ?? []) add(e);
  if (requester) add(requester);
  return out;
}

export function stageIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return i === -1 ? -1 : i;
}

export function nextStageAfterDelivery(currentStage: string): string {
  if (currentStage === 'payment_received') return 'payment_received';
  const idx = stageIndex(currentStage);
  const pickedIdx = stageIndex('picked_up');
  const deliveredIdx = stageIndex('delivered');
  if (idx >= deliveredIdx) return currentStage;
  if (idx >= pickedIdx) return 'delivered';
  return currentStage;
}

export function isStagePickedUpOrLater(stage: string): boolean {
  return (STAGES_PICKED_UP_OR_LATER as readonly string[]).includes(stage);
}

export type QuotationRow = {
  id: string;
  quotation_no: string | null;
  awb_number: string | null;
  opportunity_id: string | null;
  carrier_code: string | null;
  carrier_code_manual: boolean;
  tracking_status: TrackingStatus;
  delivered_at: string | null;
  delivery_notify_emails: string[] | null;
  customer_user_id: string | null;
  destination: string | null;
  requested_destination: string | null;
  customer_name: string | null;
  company_name: string | null;
  chargeable_weight: number | null;
  pallets: unknown;
  booking_air_freight: { flight_no?: string } | null;
};

export type ApplyTrackingInput = {
  awb_number: string;
  status: TrackingStatus;
  raw_text: string;
  source_url: string;
  delivered_at?: string;
  created_by?: string;
};

export type ApplyTrackingResult = {
  quotation_id: string;
  omg_number: string | null;
  tracking_status: TrackingStatus;
  already_delivered: boolean;
  email: 'sent' | 'skipped' | 'failed' | 'claimed_by_other';
  stage_updated: boolean;
};

export type TrackingDeps = {
  findQuotationByAwb: (normalized: string) => Promise<QuotationRow | null>;
  insertHistory: (row: {
    quotation_id: string;
    awb_number: string;
    status: TrackingStatus;
    raw_text: string;
    source_url: string;
    checked_at: string;
    created_by: string;
  }) => Promise<void>;
  updateStatus: (
    quotationId: string,
    patch: {
      tracking_status: TrackingStatus;
      tracking_status_raw: string;
      tracking_checked_at: string;
      carrier_code?: string | null;
      delivered_local_offset?: string | null;
    }
  ) => Promise<void>;
  claimDelivered: (
    quotationId: string,
    deliveredAt: string,
    deliveredLocalOffset: string | null
  ) => Promise<boolean>;
  getOpStage: (opportunityId: string) => Promise<string | null>;
  listQuotationsForOp: (opportunityId: string) => Promise<{ id: string; awb_number: string | null; delivered_at: string | null }[]>;
  setOpStage: (opportunityId: string, stage: string) => Promise<void>;
  resolveRequesterEmail: (quotation: QuotationRow) => Promise<string | null>;
  tryClaimAutoEmail: (quotationId: string) => Promise<'claimed' | 'already'>;
  sendDelivered: (opts: {
    quotation: QuotationRow;
    recipients: string[];
    source_url: string;
    delivered_at: string;
    trigger: 'auto' | 'manual';
    logId?: string;
  }) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
  finalizeAutoLog: (
    quotationId: string,
    patch: { status: 'sent' | 'failed'; resend_message_id?: string; attempts: number; error?: string; sent_at?: string }
  ) => Promise<void>;
  insertManualLog: (quotationId: string, recipients: string[]) => Promise<string>;
  updateManualLog: (
    logId: string,
    patch: { status: 'sent' | 'failed'; resend_message_id?: string; attempts: number; error?: string; sent_at?: string }
  ) => Promise<void>;
};

function extractOffset(iso: string): string | null {
  const m = iso.match(/([+-]\d{2}:\d{2}|Z)$/);
  if (!m) return null;
  return m[1] === 'Z' ? '+00:00' : m[1];
}

async function maybeAdvanceOpStage(
  deps: TrackingDeps,
  opportunityId: string
): Promise<boolean> {
  const opStage = (await deps.getOpStage(opportunityId)) || 'inquiry';
  const allOnOp = await deps.listQuotationsForOp(opportunityId);
  const withAwb = allOnOp.filter((q) => q.awb_number?.trim());
  if (withAwb.length === 0) return false;
  const allDelivered = withAwb.every((q) => Boolean(q.delivered_at));
  if (!allDelivered) return false;
  const next = nextStageAfterDelivery(opStage);
  if (next === opStage) return false;
  await deps.setOpStage(opportunityId, next);
  return true;
}

export async function applyTrackingUpdate(
  deps: TrackingDeps,
  input: ApplyTrackingInput
): Promise<ApplyTrackingResult> {
  const normalized = normalizeAwb(input.awb_number);
  if (!normalized) throw new Error('Invalid AWB: must be 11 digits.');

  const quotation = await deps.findQuotationByAwb(normalized);
  if (!quotation) throw new Error('Quotation not found for AWB.');

  const hadDeliveredAt = Boolean(quotation.delivered_at);
  const checkedAt = new Date().toISOString();
  const createdBy = input.created_by || 'mcp';

  await deps.insertHistory({
    quotation_id: quotation.id,
    awb_number: quotation.awb_number || formatAwbDisplay(normalized),
    status: input.status,
    raw_text: input.raw_text,
    source_url: input.source_url,
    checked_at: checkedAt,
    created_by: createdBy,
  });

  const carrier =
    quotation.carrier_code_manual && quotation.carrier_code
      ? quotation.carrier_code
      : carrierFromAwb(normalized) ?? quotation.carrier_code;

  const deliveredAtIso = input.delivered_at || checkedAt;
  const localOffset = input.delivered_at ? extractOffset(input.delivered_at) : null;

  await deps.updateStatus(quotation.id, {
    tracking_status: input.status,
    tracking_status_raw: input.raw_text,
    tracking_checked_at: checkedAt,
    carrier_code: carrier,
    ...(input.status === 'delivered' ? { delivered_local_offset: localOffset } : {}),
  });

  let email: ApplyTrackingResult['email'] = 'skipped';
  let stageUpdated = false;
  let firstTimeDelivered = false;

  if (input.status === 'delivered') {
    firstTimeDelivered = await deps.claimDelivered(quotation.id, deliveredAtIso, localOffset);

    if (quotation.opportunity_id) {
      stageUpdated = await maybeAdvanceOpStage(deps, quotation.opportunity_id);
    }

    if (firstTimeDelivered) {
      const claimResult = await deps.tryClaimAutoEmail(quotation.id);
      if (claimResult === 'already') {
        email = 'claimed_by_other';
      } else {
        const requesterEmail = await deps.resolveRequesterEmail(quotation);
        const recipients = resolveDeliveredRecipients({
          notifyEmails: quotation.delivery_notify_emails ?? [],
          requesterEmail,
        });
        const sendResult = await deps.sendDelivered({
          quotation,
          recipients,
          source_url: input.source_url,
          delivered_at: deliveredAtIso,
          trigger: 'auto',
        });
        if (sendResult.ok) {
          email = 'sent';
          await deps.finalizeAutoLog(quotation.id, {
            status: 'sent',
            resend_message_id: sendResult.messageId,
            attempts: sendResult.messageId ? 1 : 0,
            sent_at: new Date().toISOString(),
          });
        } else {
          email = 'failed';
          await deps.finalizeAutoLog(quotation.id, {
            status: 'failed',
            attempts: 3,
            error: sendResult.error,
          });
        }
      }
    }
  }

  return {
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no,
    tracking_status: input.status,
    already_delivered: hadDeliveredAt && !firstTimeDelivered,
    email: hadDeliveredAt && input.status === 'delivered' ? 'skipped' : email,
    stage_updated: stageUpdated,
  };
}

/** Manual resend (always sends, new log row). */
export async function resendDeliveredEmail(
  deps: TrackingDeps,
  quotation: QuotationRow,
  sourceUrl: string,
  deliveredAt: string
): Promise<{ ok: boolean; logId: string; error?: string }> {
  const requesterEmail = await deps.resolveRequesterEmail(quotation);
  const recipients = resolveDeliveredRecipients({
    notifyEmails: quotation.delivery_notify_emails ?? [],
    requesterEmail,
  });
  const logId = await deps.insertManualLog(quotation.id, recipients);
  const sendResult = await deps.sendDelivered({
    quotation,
    recipients,
    source_url: sourceUrl,
    delivered_at: deliveredAt,
    trigger: 'manual',
    logId,
  });
  await deps.updateManualLog(logId, {
    status: sendResult.ok ? 'sent' : 'failed',
    resend_message_id: sendResult.messageId,
    attempts: sendResult.ok ? 1 : 3,
    error: sendResult.error,
    sent_at: sendResult.ok ? new Date().toISOString() : undefined,
  });
  return { ok: sendResult.ok, logId, error: sendResult.error };
}
