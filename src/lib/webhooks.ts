import type { SupabaseClient } from '@supabase/supabase-js';
import { buildBookingDocumentListUrl } from '@/lib/email-templates';
import { absoluteUrl } from '@/lib/site';
import { getFileUrl } from '@/lib/storage';
import type { DocumentSubmission, Pallet, Quotation } from '@/lib/db';
import { productLabelFromCommodity, summarizePallets } from '@/lib/mcp/booking-draft';

export const BOOKING_WEIGHT_DOC_TYPES = new Set(['commercial-invoice', 'packing-list']);

export interface QuotationCreatedPayload {
  event: 'quotation.created';
  emitted_at: string;
  quotation_id: string;
  omg_number: string | null;
  status: string;
  created_at: string;
  shipper: string | null;
  consignee: string | null;
  product: string;
  commodity_type: string | null;
  destination: string | null;
  requested_destination: string | null;
  declared_net_weight_kg: number | null;
  chargeable_weight_kg: number | null;
  pieces_summary: string;
  pallet_dimensions: string;
  airline_preference: string | null;
  document_list_url: string | null;
  attachments: Array<{
    id: string;
    document_type: string;
    file_name: string;
    download_url: string | null;
  }>;
}

export interface QuotationDocsReplacedPayload {
  event: 'quotation.docs_replaced';
  emitted_at: string;
  quotation_id: string;
  omg_number: string | null;
  doc_type: string;
  new_url: string;
}

export interface QuotationDocsUploadedPayload {
  event: 'quotation.docs_uploaded';
  emitted_at: string;
  quotation_id: string;
  omg_number: string | null;
  quotation_no: string | null;
  status: string;
  updated_at: string;
  doc_types_added: string[];
  document_list_url: string | null;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

export interface WebhookDeliveryContext {
  omg?: string | null;
  quotationId?: string;
}

function webhookConfig(): { url: string; key: string } | null {
  const url = process.env.QUOTATION_WEBHOOK_URL?.trim();
  const key = process.env.WEBHOOK_SIGNING_SECRET?.trim();
  if (!url || !key) return null;
  return { url, key };
}

function webhookContextLabel(context?: WebhookDeliveryContext): string {
  if (!context?.omg && !context?.quotationId) return '';
  const parts: string[] = [];
  if (context.omg) parts.push(context.omg);
  if (context.quotationId) parts.push(`id=${context.quotationId}`);
  return ` ${parts.join(' ')}`;
}

/** POST to Grok routine webhook; logs status/body/latency (never secrets); retries once on 5xx/timeout. */
async function postWebhook(
  event: string,
  body: string,
  context?: WebhookDeliveryContext
): Promise<void> {
  const cfg = webhookConfig();
  if (!cfg) {
    console.warn(
      `[webhook] ${event}${webhookContextLabel(context)} skipped: QUOTATION_WEBHOOK_URL or WEBHOOK_SIGNING_SECRET unset`
    );
    return;
  }

  const ctxLabel = webhookContextLabel(context);

  const attempt = async (isRetry: boolean): Promise<boolean> => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const retryTag = isRetry ? ' (retry)' : '';
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.key}`,
          'X-OMG-Event': event,
        },
        body,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;
      const responseText = await res.text().catch(() => '');
      const preview = responseText.slice(0, 500);
      const suffix = preview ? `: ${preview}` : '';

      if (res.ok) {
        console.log(
          `[webhook] ${event}${ctxLabel}${retryTag} -> ${res.status} in ${latencyMs}ms${suffix}`
        );
        return true;
      }

      console.error(
        `[webhook] ${event}${ctxLabel}${retryTag} -> ${res.status} in ${latencyMs}ms${suffix}`
      );
      if (res.status >= 500) return false;
      return true;
    } catch (err) {
      const latencyMs = Date.now() - started;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[webhook] ${event}${ctxLabel}${retryTag} failed in ${latencyMs}ms: ${msg}`
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  const ok = await attempt(false);
  if (!ok) await attempt(true);
}

async function ensureBookingShareToken(
  supabase: SupabaseClient,
  quotationId: string,
  existing?: string | null
): Promise<string | null> {
  if (existing) return existing;
  const token = crypto.randomUUID();
  const { error } = await supabase
    .from('quotations')
    .update({ booking_share_token: token })
    .eq('id', quotationId);
  return error ? null : token;
}

async function attachmentUrls(
  docs: DocumentSubmission[]
): Promise<QuotationCreatedPayload['attachments']> {
  return Promise.all(
    docs.map(async (doc) => ({
      id: doc.id,
      document_type: doc.document_type,
      file_name: doc.original_file_name || doc.file_name,
      download_url: doc.file_path
        ? await getFileUrl(doc.file_path, doc.storage_provider || 'r2')
        : doc.file_url || null,
    }))
  );
}

/** Build webhook payload from a quotation row + linked docs. */
export async function buildQuotationCreatedPayload(
  supabase: SupabaseClient,
  quote: Quotation,
  docs: DocumentSubmission[] = []
): Promise<QuotationCreatedPayload> {
  const pallets = (Array.isArray(quote.pallets) ? quote.pallets : []) as Pallet[];
  const { declaredNetWeightKg, piecesSummary, palletDimensions } = summarizePallets(
    pallets,
    quote.total_actual_weight
  );
  const bookingDetails =
    quote.booking_details && typeof quote.booking_details === 'object'
      ? (quote.booking_details as Record<string, unknown>)
      : null;
  const token = await ensureBookingShareToken(supabase, quote.id, quote.booking_share_token);
  const documentListUrl = token ? buildBookingDocumentListUrl(absoluteUrl(''), token) : null;

  return {
    event: 'quotation.created',
    emitted_at: new Date().toISOString(),
    quotation_id: quote.id,
    omg_number: quote.quotation_no || null,
    status: quote.status,
    created_at: quote.created_at,
    shipper: quote.company_name || null,
    consignee: quote.consignee_name || null,
    product: productLabelFromCommodity(quote.commodity_type),
    commodity_type: quote.commodity_type || null,
    destination: quote.destination || quote.requested_destination || null,
    requested_destination: quote.requested_destination || null,
    declared_net_weight_kg: declaredNetWeightKg,
    chargeable_weight_kg: quote.chargeable_weight ?? null,
    pieces_summary: piecesSummary,
    pallet_dimensions: palletDimensions,
    airline_preference:
      (typeof bookingDetails?.airline === 'string' ? bookingDetails.airline : null) || 'TG',
    document_list_url: documentListUrl,
    attachments: await attachmentUrls(docs),
  };
}

export async function buildQuotationDocsUploadedPayload(
  supabase: SupabaseClient,
  quote: Quotation,
  docTypesAdded: string[]
): Promise<QuotationDocsUploadedPayload> {
  const token = await ensureBookingShareToken(supabase, quote.id, quote.booking_share_token);
  const documentListUrl = token ? buildBookingDocumentListUrl(absoluteUrl(''), token) : null;

  return {
    event: 'quotation.docs_uploaded',
    emitted_at: new Date().toISOString(),
    quotation_id: quote.id,
    omg_number: quote.quotation_no || null,
    quotation_no: quote.quotation_no || null,
    status: quote.status,
    updated_at: quote.updated_at || new Date().toISOString(),
    doc_types_added: docTypesAdded,
    document_list_url: documentListUrl,
  };
}

/** Outbound quotation.created webhook; never throws to caller. Await in request path on Vercel. */
export async function emitQuotationCreated(
  supabase: SupabaseClient,
  quote: Quotation,
  docs: DocumentSubmission[] = []
): Promise<void> {
  try {
    const payload = await buildQuotationCreatedPayload(supabase, quote, docs);
    await postWebhook('quotation.created', JSON.stringify(payload), {
      omg: payload.omg_number,
      quotationId: payload.quotation_id,
    });
  } catch (err) {
    console.error(
      `[webhook] quotation.created ${quote.quotation_no || quote.id} build failed:`,
      err
    );
  }
}

/** Document replaced via MCP — separate from docs_uploaded so booking draft automation does not re-fire. */
export async function emitQuotationDocsReplaced(
  _supabase: SupabaseClient,
  params: {
    quotation_id: string;
    omg_number: string | null;
    doc_type: string;
    new_url: string;
  }
): Promise<void> {
  try {
    const payload: QuotationDocsReplacedPayload = {
      event: 'quotation.docs_replaced',
      emitted_at: new Date().toISOString(),
      quotation_id: params.quotation_id,
      omg_number: params.omg_number,
      doc_type: params.doc_type,
      new_url: params.new_url,
    };
    await postWebhook('quotation.docs_replaced', JSON.stringify(payload), {
      omg: params.omg_number,
      quotationId: params.quotation_id,
    });
  } catch (err) {
    console.error('[webhook] quotation.docs_replaced failed:', err);
  }
}

/** Notify Grok when booking-relevant docs (CI / packing list) are uploaded later. */
export async function emitQuotationDocsUploaded(
  supabase: SupabaseClient,
  quotationId: string,
  docTypesAdded: string[]
): Promise<void> {
  const types = [...new Set(docTypesAdded.filter((t) => BOOKING_WEIGHT_DOC_TYPES.has(t)))];
  if (types.length === 0) return;

  try {
    const { data: quote, error } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', quotationId)
      .maybeSingle();

    if (error || !quote) {
      console.error('[webhook] quotation.docs_uploaded: quote not found', quotationId);
      return;
    }

    const payload = await buildQuotationDocsUploadedPayload(
      supabase,
      quote as Quotation,
      types
    );
    await postWebhook('quotation.docs_uploaded', JSON.stringify(payload), {
      omg: payload.omg_number,
      quotationId: payload.quotation_id,
    });
  } catch (err) {
    console.error('[webhook] quotation.docs_uploaded failed:', err);
  }
}
