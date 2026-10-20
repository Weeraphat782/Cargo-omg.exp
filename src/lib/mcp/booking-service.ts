import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildBookingDocumentListUrl,
  mergeBookingDetailsFromQuotation,
  type EmailBookingData,
} from '@/lib/email-templates';
import { getBookingRecipients } from '@/lib/booking-recipients';
import {
  assembleBookingDraft,
  buildOpCardPayload,
  buildOpCardUpdatePayload,
  buildRouting,
  resolveApproveCompanyName,
  piecesLabel,
  productLabelFromCommodity,
  summarizePallets,
  type BookingEmailDraft,
  type PackagingType,
} from '@/lib/mcp/booking-draft';
import { resolveOpportunityOwnerId } from '@/lib/mcp/opportunity-owner';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export { resolveOpportunityOwnerId };
import { absoluteUrl } from '@/lib/site';
import { getFileUrl } from '@/lib/storage';
import type { DocumentSubmission, Pallet, Quotation } from '@/lib/db';
import {
  attachmentFromDocumentRow,
  listQuotationDocumentRows,
  replaceQuotationDocument,
} from '@/lib/mcp/replace-document';

export { replaceQuotationDocument };

export type { BookingEmailDraft } from '@/lib/mcp/booking-draft';
export { assembleBookingDraft, piecesLabel, productLabelFromCommodity, summarizePallets };

export type QuotationWithPort = Quotation & { destination_port?: string | null };

export interface BuildBookingEmailDraftRef {
  quotation_id?: string;
  omg_number?: string;
  net_weight_kg?: number;
  routing?: string;
  airline?: string;
  preferred_shipment_date?: string;
  mawb?: string;
  consignee?: string;
  number_of_pieces?: string;
  pallet_dimensions?: string;
  origin?: string;
  product?: string;
  destination?: string;
  packaging_type?: PackagingType;
  pieces?: number;
}

export interface UpdateQuotationNetWeightRef {
  quotation_id?: string;
  omg_number?: string;
  net_weight_kg: number;
  source: string;
  note?: string;
}

export interface CreateOpCardRef {
  quotation_id?: string;
  omg_number?: string;
  topic?: string;
  stage?: string;
  notes?: string;
  owner_email?: string;
  owner_id?: string;
}

export interface GetOpCardRef {
  quotation_id?: string;
  omg_number?: string;
  op_card_id?: string;
}

export interface UpdateOpCardRef {
  quotation_id?: string;
  omg_number?: string;
  op_card_id?: string;
  stage?: string;
  pickup_date?: string;
  notes?: string;
  payment_date?: string;
}

export interface ApproveQuotationRef {
  quotation_id?: string;
  omg_number?: string;
  company_name?: string;
}

export interface ExtractedBookingFields {
  quotation_id: string;
  omg_number: string | null;
  product: string;
  destination: string;
  net_weight_kg: number | null;
  net_weight_source: string;
  net_weight_confidence: 'low' | 'medium' | 'high';
  chargeable_weight: number | null;
  packaging_type: PackagingType;
  pieces: number;
  airline: string;
  shipper: string;
  consignee: string;
  pieces_summary: string;
  pallet_dimensions: string;
  routing: string;
  origin: string;
  verify_from_documents: Array<{
    document_type: string;
    file_name: string;
    download_url: string | null;
    note: string;
  }>;
}

const QUOTATION_SELECT = `
  *,
  company:companies(name, address, tax_id, contact_person, contact_email, contact_phone),
  destination_country:destinations(country, port),
  product:products(name)
`;

const WEIGHT_DOC_TYPES = new Set(['packing-list', 'commercial-invoice']);
const WEIGHT_DOC_ORDER = ['commercial-invoice', 'packing-list'];
// ponytail: Grok (vision LLM) reads these doc URLs and persists via update_quotation_net_weight.
const VERIFY_DOC_NOTE =
  'Read total net KG from Commercial Invoice first, then Export Packing List; then call update_quotation_net_weight. Never use chargeable weight.';

function mapQuotationRow(data: Record<string, unknown>): QuotationWithPort {
  const company = data.company as { name?: string } | null;
  const dest = data.destination_country as { country?: string; port?: string } | null;
  return {
    ...(data as unknown as Quotation),
    company_name: company?.name ?? (data.company_name as string | null),
    destination: dest
      ? `${dest.country || ''}${dest.port ? `, ${dest.port}` : ''}`.trim()
      : (data.destination as string | null),
    destination_port: dest?.port ?? null,
  };
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

async function quotationHasDocuments(
  supabase: SupabaseClient,
  quotationId: string,
  opportunityId?: string | null
): Promise<boolean> {
  const { count: qCount } = await supabase
    .from('document_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('quotation_id', quotationId);

  if ((qCount ?? 0) > 0) return true;
  if (!opportunityId) return false;

  const { count: oCount } = await supabase
    .from('document_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('opportunity_id', opportunityId);

  return (oCount ?? 0) > 0;
}

async function resolveOpCardId(
  supabase: SupabaseClient,
  ref: { quotation_id?: string; omg_number?: string; op_card_id?: string }
): Promise<string> {
  if (ref.op_card_id?.trim()) return ref.op_card_id.trim();

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) throw new Error('Quotation not found.');
  if (!quotation.opportunity_id) {
    throw new Error('No Op card linked to this quotation — call create_op_card first.');
  }
  return quotation.opportunity_id;
}

async function fetchQuotationByRef(
  supabase: SupabaseClient,
  ref: { quotation_id?: string; omg_number?: string }
): Promise<QuotationWithPort | null> {
  if (ref.quotation_id) {
    const { data, error } = await supabase
      .from('quotations')
      .select(QUOTATION_SELECT)
      .eq('id', ref.quotation_id)
      .maybeSingle();
    if (error || !data) return null;
    return mapQuotationRow(data as Record<string, unknown>);
  }
  if (ref.omg_number) {
    const { data, error } = await supabase
      .from('quotations')
      .select(QUOTATION_SELECT)
      .eq('quotation_no', ref.omg_number)
      .maybeSingle();
    if (error || !data) return null;
    return mapQuotationRow(data as Record<string, unknown>);
  }
  return null;
}

async function buildEmailDataForQuotation(
  supabase: SupabaseClient,
  quotation: QuotationWithPort
): Promise<EmailBookingData> {
  const saved = quotation.booking_details as EmailBookingData | null;
  const product = productLabelFromCommodity(quotation.commodity_type);
  const base = mergeBookingDetailsFromQuotation(quotation, saved);
  const token = await ensureBookingShareToken(supabase, quotation.id, quotation.booking_share_token);
  const documentListUrl = token ? buildBookingDocumentListUrl(absoluteUrl(''), token) : '';
  const destination = quotation.destination || quotation.requested_destination || base.destination || '';
  const origin = saved?.origin || 'BKK';
  const routing = saved?.routing || buildRouting(origin, quotation.destination_port);

  return {
    ...base,
    product: saved?.product || product,
    destination,
    origin,
    routing,
    consignee: saved?.consignee || quotation.consignee_name || '',
    airline: saved?.airline || 'TG',
    documentListUrl,
    recipientName: saved?.recipientName || getBookingRecipients().recipientName,
    senderName: saved?.senderName || getBookingRecipients().senderName,
  };
}

function applyDraftOverrides(
  emailData: EmailBookingData,
  ref: BuildBookingEmailDraftRef
): EmailBookingData {
  const out = { ...emailData };
  if (ref.net_weight_kg != null) out.netWeight = ref.net_weight_kg;
  if (ref.routing) out.routing = ref.routing;
  if (ref.airline) out.airline = ref.airline;
  if (ref.preferred_shipment_date) out.preferredShipmentDate = ref.preferred_shipment_date;
  if (ref.mawb) out.mawb = ref.mawb;
  if (ref.consignee) out.consignee = ref.consignee;
  if (ref.number_of_pieces) out.numberOfPieces = ref.number_of_pieces;
  if (ref.pallet_dimensions) out.palletDimensions = ref.pallet_dimensions;
  if (ref.origin) out.origin = ref.origin;
  if (ref.product) out.product = ref.product;
  if (ref.destination) out.destination = ref.destination;
  if (ref.packaging_type && ref.pieces != null && ref.pieces > 0) {
    out.numberOfPieces = piecesLabel(ref.pieces, ref.packaging_type);
  }
  return out;
}

export async function listNewQuotations(opts?: {
  status?: string;
  since?: string;
  exclude_drafted?: boolean;
  limit?: number;
}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const status = opts?.status || 'pending_approval';
  const limit = Math.min(opts?.limit ?? 50, 100);
  let query = supabase
    .from('quotations')
    .select(
      'id, quotation_no, status, created_at, company_name, consignee_name, destination, requested_destination, commodity_type, pallets, booking_email_drafted_at'
    )
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts?.since) query = query.gte('created_at', opts.since);
  if (opts?.exclude_drafted !== false) query = query.is('booking_email_drafted_at', null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getQuotationDetail(ref: {
  quotation_id?: string;
  omg_number?: string;
}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) return null;

  const docs = await listQuotationDocumentRows(supabase, quotation.id, false);

  return { quotation, documents: docs as DocumentSubmission[] };
}

export async function getQuotationDocuments(ref: {
  quotation_id?: string;
  omg_number?: string;
  include_superseded?: boolean;
}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) return null;

  const includeSuperseded = ref.include_superseded === true;
  const docs = await listQuotationDocumentRows(supabase, quotation.id, includeSuperseded);

  const attachments = await Promise.all(docs.map((doc) => attachmentFromDocumentRow(doc)));
  return {
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no,
    include_superseded: includeSuperseded,
    attachments,
  };
}

export async function extractBookingFields(ref: {
  quotation_id?: string;
  omg_number?: string;
}): Promise<ExtractedBookingFields | null> {
  const detail = await getQuotationDetail(ref);
  if (!detail) return null;

  const { quotation, documents } = detail;
  const pallets = (Array.isArray(quotation.pallets) ? quotation.pallets : []) as Pallet[];
  const packagingType: PackagingType = 'pallet';
  const { declaredNetWeightKg, netWeightSource, piecesSummary, palletDimensions, pieces } =
    summarizePallets(pallets, quotation.total_actual_weight, packagingType);
  const saved = quotation.booking_details as EmailBookingData | null;
  const origin = saved?.origin || 'BKK';
  const routing = saved?.routing || buildRouting(origin, quotation.destination_port);

  const weightDocs = documents
    .filter((d) => WEIGHT_DOC_TYPES.has(d.document_type))
    .sort(
      (a, b) =>
        WEIGHT_DOC_ORDER.indexOf(a.document_type) - WEIGHT_DOC_ORDER.indexOf(b.document_type)
    );

  const verifyDocs = await Promise.all(
    weightDocs.map(async (d) => ({
      document_type: d.document_type,
      file_name: d.original_file_name || d.file_name,
      download_url: d.file_path
        ? await getFileUrl(d.file_path, d.storage_provider || 'r2')
        : d.file_url || null,
      note: VERIFY_DOC_NOTE,
    }))
  );

  // Net from quotation only. If pallets are 0, Grok reads verify_from_documents and
  // persists via update_quotation_net_weight (confidence stays low until then).
  const confidence: ExtractedBookingFields['net_weight_confidence'] =
    declaredNetWeightKg != null ? 'high' : 'low';

  return {
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no || null,
    product: productLabelFromCommodity(quotation.commodity_type),
    destination: quotation.destination || quotation.requested_destination || '',
    net_weight_kg: declaredNetWeightKg,
    net_weight_source: netWeightSource,
    net_weight_confidence: confidence,
    chargeable_weight: quotation.chargeable_weight ?? null,
    packaging_type: packagingType,
    pieces,
    airline: saved?.airline || 'TG',
    shipper: quotation.company_name || '',
    consignee: quotation.consignee_name || saved?.consignee || '',
    pieces_summary: piecesSummary,
    pallet_dimensions: palletDimensions,
    routing,
    origin,
    verify_from_documents: verifyDocs,
  };
}

export async function buildBookingEmailDraft(
  ref: BuildBookingEmailDraftRef
): Promise<BookingEmailDraft | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) return null;

  // Net from quotation pallets / total_actual_weight or explicit override.
  // If still empty, Grok should pass net_weight_kg (read from CI) or call
  // update_quotation_net_weight first, else the draft shows [Weight] KG.
  const emailData = applyDraftOverrides(
    await buildEmailDataForQuotation(supabase, quotation),
    ref
  );
  const recipients = getBookingRecipients();
  const draftedAt = quotation.booking_email_drafted_at;

  return assembleBookingDraft(quotation, emailData, recipients, {
    alreadyDrafted: !!draftedAt,
  });
}

export async function markBookingEmailDrafted(ref: {
  quotation_id?: string;
  omg_number?: string;
  drafted_by?: string;
}): Promise<{ ok: boolean; already_drafted: boolean; quotation_id?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) return { ok: false, already_drafted: false };

  if (quotation.booking_email_drafted_at) {
    return { ok: true, already_drafted: true, quotation_id: quotation.id };
  }

  const { error } = await supabase
    .from('quotations')
    .update({
      booking_email_drafted_at: new Date().toISOString(),
      booking_email_drafted_by: ref.drafted_by?.trim() || 'mcp',
    })
    .eq('id', quotation.id)
    .is('booking_email_drafted_at', null);

  if (error) throw new Error(error.message);
  return { ok: true, already_drafted: false, quotation_id: quotation.id };
}

export async function updateQuotationNetWeight(ref: UpdateQuotationNetWeightRef): Promise<{
  ok: boolean;
  quotation_id: string;
  omg_number: string | null;
  net_weight_kg: number;
  previous_net_weight_kg: number | null;
  source: string;
}> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) throw new Error('Quotation not found.');

  const forbiddenSources = ['chargeable', 'chargeable_weight', 'manual_chargeable_weight', 'volume'];
  const src = ref.source.trim().toLowerCase();
  if (forbiddenSources.some((f) => src.includes(f))) {
    throw new Error(
      'source must not be chargeable/volume — use commercial-invoice, packing-list, or quotation_pallets'
    );
  }

  const previous = quotation.total_actual_weight ?? null;
  const updatePayload: Record<string, unknown> = {
    total_actual_weight: ref.net_weight_kg,
    updated_at: new Date().toISOString(),
  };

  if (ref.note?.trim()) {
    const stamp = `[MCP net ${new Date().toISOString()}] ${ref.source}: ${ref.note.trim()}`;
    updatePayload.internal_remark = quotation.internal_remark
      ? `${quotation.internal_remark}\n${stamp}`
      : stamp;
  }

  const { error } = await supabase
    .from('quotations')
    .update(updatePayload)
    .eq('id', quotation.id);

  if (error) throw new Error(error.message);

  return {
    ok: true,
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no || null,
    net_weight_kg: ref.net_weight_kg,
    previous_net_weight_kg: previous,
    source: ref.source,
  };
}

export async function createOpCard(ref: CreateOpCardRef): Promise<{
  ok: boolean;
  quotation_id: string;
  omg_number: string | null;
  op_card_id: string;
  url: string;
  created: boolean;
  owner_id: string;
  repaired: boolean;
}> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) throw new Error('Quotation not found.');

  const ownerId = await resolveOpportunityOwnerId(supabase, ref);

  if (quotation.opportunity_id) {
    let repaired = false;
    const { data: existing, error: fetchError } = await supabase
      .from('opportunities')
      .select('id, owner_id')
      .eq('id', quotation.opportunity_id)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);

    if (existing && existing.owner_id !== ownerId) {
      const { error: repairError } = await supabase
        .from('opportunities')
        .update({ owner_id: ownerId })
        .eq('id', existing.id);

      if (repairError) throw new Error(repairError.message);
      repaired = true;
    }

    if (ref.stage != null || ref.notes != null) {
      const patch = buildOpCardUpdatePayload({ stage: ref.stage, notes: ref.notes });
      const { error: patchError } = await supabase
        .from('opportunities')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', quotation.opportunity_id);
      if (patchError) throw new Error(patchError.message);
    }

    return {
      ok: true,
      quotation_id: quotation.id,
      omg_number: quotation.quotation_no || null,
      op_card_id: quotation.opportunity_id,
      url: `/opportunities/${quotation.opportunity_id}`,
      created: false,
      owner_id: ownerId,
      repaired,
    };
  }

  const payload = buildOpCardPayload(
    quotation,
    ownerId,
    {
      topic: ref.topic,
      stage: ref.stage,
      notes: ref.notes,
    }
  );

  const { data, error } = await supabase
    .from('opportunities')
    .insert([payload])
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create opportunity.');

  const { error: linkError } = await supabase
    .from('quotations')
    .update({
      opportunity_id: data.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quotation.id);

  if (linkError) throw new Error(linkError.message);

  return {
    ok: true,
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no || null,
    op_card_id: data.id,
    url: `/opportunities/${data.id}`,
    created: true,
    owner_id: ownerId,
    repaired: false,
  };
}

export async function updateOpCard(ref: UpdateOpCardRef): Promise<Record<string, unknown>> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const opCardId = await resolveOpCardId(supabase, ref);
  const payload = {
    ...buildOpCardUpdatePayload(ref),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('opportunities').update(payload).eq('id', opCardId);
  if (error) throw new Error(error.message);

  const card = await getOpCard({ op_card_id: opCardId });
  if (!card) throw new Error('Opportunity not found after update.');
  return card;
}

function approveQuotationResult(
  quotation: QuotationWithPort,
  opts: {
    already_approved: boolean;
    status_before: string;
    status_after: string;
    company_name: string;
  }
) {
  return {
    ok: true,
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no || null,
    already_approved: opts.already_approved,
    status_before: opts.status_before,
    status_after: opts.status_after,
    company_name: opts.company_name,
    destination_id: quotation.destination_id ?? null,
    destination_untouched: true,
  };
}

export async function approveQuotation(ref: ApproveQuotationRef): Promise<{
  ok: boolean;
  quotation_id: string;
  omg_number: string | null;
  already_approved: boolean;
  status_before: string;
  status_after: string;
  company_name: string;
  destination_id: string | null;
  destination_untouched: boolean;
}> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  const quotation = await fetchQuotationByRef(supabase, ref);
  if (!quotation) throw new Error('Quotation not found.');

  const statusBefore = quotation.status || 'unknown';

  if (statusBefore !== 'pending_approval') {
    let companyName = quotation.company_name?.trim() || quotation.customer_name?.trim() || '';
    if (ref.company_name?.trim()) {
      companyName = resolveApproveCompanyName(quotation, ref.company_name);
    } else if (!companyName) {
      try {
        companyName = resolveApproveCompanyName(quotation);
      } catch {
        companyName = '';
      }
    }
    return approveQuotationResult(quotation, {
      already_approved: true,
      status_before: statusBefore,
      status_after: statusBefore,
      company_name: companyName,
    });
  }

  const companyName = resolveApproveCompanyName(quotation, ref.company_name);
  const staffId = await resolveOpportunityOwnerId(supabase, {});
  const hasDocs = await quotationHasDocuments(
    supabase,
    quotation.id,
    quotation.opportunity_id
  );
  const statusAfter = hasDocs ? 'docs_uploaded' : 'draft';

  const { data: updated, error } = await supabase
    .from('quotations')
    .update({
      status: statusAfter,
      company_name: companyName,
      user_id: staffId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quotation.id)
    .eq('status', 'pending_approval')
    .select('status')
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!updated) {
    const refreshed = await fetchQuotationByRef(supabase, ref);
    if (!refreshed) throw new Error('Quotation not found after approve attempt.');
    return approveQuotationResult(refreshed, {
      already_approved: true,
      status_before: statusBefore,
      status_after: refreshed.status || statusBefore,
      company_name: companyName,
    });
  }

  return approveQuotationResult(quotation, {
    already_approved: false,
    status_before: statusBefore,
    status_after: statusAfter,
    company_name: companyName,
  });
}

export async function getOpCard(ref: GetOpCardRef): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  let opCardId = ref.op_card_id?.trim();
  let linkedQuotationId: string | null = null;
  let quotationNo: string | null = null;

  if (!opCardId) {
    const quotation = await fetchQuotationByRef(supabase, ref);
    if (!quotation) return null;
    linkedQuotationId = quotation.id;
    quotationNo = quotation.quotation_no || null;
    if (!quotation.opportunity_id) return null;
    opCardId = quotation.opportunity_id;
  }

  const { data: opp, error: oppError } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', opCardId)
    .maybeSingle();

  if (oppError) throw new Error(oppError.message);
  if (!opp) return null;

  if (!linkedQuotationId) {
    const { data: quotes, error: quoteError } = await supabase
      .from('quotations')
      .select('id, quotation_no')
      .eq('opportunity_id', opp.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (quoteError) {
      console.error('[getOpCard] reverse quotation lookup failed:', quoteError.message);
    }
    linkedQuotationId = quotes?.[0]?.id ?? null;
    quotationNo = quotes?.[0]?.quotation_no ?? null;
  }

  return {
    ...opp,
    op_card_id: opp.id,
    linked_quotation_id: linkedQuotationId,
    quotation_no: quotationNo,
    omg_number: quotationNo,
    url: `/opportunities/${opp.id}`,
  };
}
