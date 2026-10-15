import { randomUUID } from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const R2_BUCKET = process.env.R2_DOCS_BUCKET_NAME || 'documents';

export const REPLACE_DOC_TYPES = {
  packing_list: { slug: 'packing-list', name: 'Packing List' },
  commercial_invoice: { slug: 'commercial-invoice', name: 'Commercial Invoice' },
  phyto: { slug: 'phyto', name: 'Phytosanitary Certificate' },
  other: { slug: 'other', name: 'Other' },
} as const;

export type ReplaceDocTypeInput = keyof typeof REPLACE_DOC_TYPES;

export function parseReplaceDocType(raw: string): ReplaceDocTypeInput | null {
  const key = raw?.trim() as ReplaceDocTypeInput;
  return key && key in REPLACE_DOC_TYPES ? key : null;
}

function normalizeDocKey(type: string): string {
  return type.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Whether an existing row should be superseded for this replace target slug. */
export function docTypeMatchesReplaceTarget(targetSlug: string, storedType: string): boolean {
  const t = normalizeDocKey(targetSlug);
  const s = normalizeDocKey(storedType);
  if (t === s) return true;
  if (targetSlug === 'phyto' && (s === 'phyto' || s.includes('phytosanitary'))) return true;
  return false;
}

export function isCurrentDocumentRow(row: { superseded_at?: string | null }): boolean {
  return !row.superseded_at;
}

export interface ReplaceQuotationDocumentInput {
  quotation_id?: string;
  omg_number?: string;
  doc_type: string;
  file_base64?: string;
  file_url?: string;
  filename: string;
  actor?: string;
}

export interface ReplaceQuotationDocumentSuccess {
  ok: true;
  quotation_id: string;
  omg_number: string | null;
  doc_type: ReplaceDocTypeInput;
  new_document_id: string;
  new_url: string;
  old_document_id: string | null;
  suggestions?: {
    net_weight_kg: null;
    pallets: null;
    note: string;
  };
}

export type QuotationForReplace = {
  id: string;
  quotation_no: string | null;
  company_name: string | null;
  customer_name: string | null;
  opportunity_id: string | null;
  status: string;
  destination_id?: string | null;
  total_actual_weight?: number | null;
};

export type DocumentRow = {
  id: string;
  quotation_id: string;
  document_type: string;
  document_type_name?: string | null;
  file_name: string;
  original_file_name?: string | null;
  file_path?: string | null;
  file_url?: string | null;
  storage_provider?: string | null;
  superseded_at?: string | null;
  superseded_by?: string | null;
  replaced_by?: string | null;
  submitted_at?: string | null;
};

export type ReplaceDocumentDeps = {
  loadQuotation: (ref: {
    quotation_id?: string;
    omg_number?: string;
  }) => Promise<QuotationForReplace | null>;
  isOpportunityLost: (opportunityId: string) => Promise<boolean>;
  uploadBytes: (params: {
    quotationId: string;
    documentTypeSlug: string;
    filename: string;
    bytes: Uint8Array;
    contentType: string;
  }) => Promise<string>;
  insertDocument: (row: Record<string, unknown>) => Promise<{ id: string }>;
  listCurrentByQuotation: (quotationId: string) => Promise<DocumentRow[]>;
  supersedeRows: (ids: string[], newId: string, replacedBy: string) => Promise<void>;
  insertActivityLog: (entry: {
    quotation_id: string;
    event: string;
    actor: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
  resolvePublicUrl: (doc: Pick<DocumentRow, 'file_path' | 'file_url' | 'storage_provider'>) => Promise<string>;
  emitReplaced: (payload: {
    quotation_id: string;
    omg_number: string | null;
    doc_type: string;
    new_url: string;
  }) => Promise<void>;
};

function extensionFromFilename(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function guessContentType(filename: string): string {
  const ext = extensionFromFilename(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}

async function loadFileBytes(input: ReplaceQuotationDocumentInput): Promise<Uint8Array> {
  const hasB64 = Boolean(input.file_base64?.trim());
  const hasUrl = Boolean(input.file_url?.trim());
  if (hasB64 === hasUrl) {
    throw new Error('Provide exactly one of file_base64 or file_url.');
  }
  if (hasB64) {
    const buf = Buffer.from(input.file_base64!.trim(), 'base64');
    if (buf.length > MAX_FILE_BYTES) throw new Error('File exceeds 15 MB limit.');
    return new Uint8Array(buf);
  }
  const url = input.file_url!.trim();
  if (!url.startsWith('https://')) throw new Error('file_url must be a public https URL.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file_url: ${res.status}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  if (arr.length > MAX_FILE_BYTES) throw new Error('File exceeds 15 MB limit.');
  return arr;
}

export async function replaceQuotationDocumentCore(
  input: ReplaceQuotationDocumentInput,
  deps: ReplaceDocumentDeps
): Promise<ReplaceQuotationDocumentSuccess> {
  const docType = parseReplaceDocType(input.doc_type);
  if (!docType) throw new Error('Unknown doc_type. Use packing_list, commercial_invoice, phyto, or other.');

  const qid = input.quotation_id?.trim();
  const omg = input.omg_number?.trim();
  if (!qid && !omg) throw new Error('Provide quotation_id or omg_number.');

  const quotation = await deps.loadQuotation({ quotation_id: qid, omg_number: omg });
  if (!quotation) throw new Error('Quotation not found.');

  if (qid && omg && quotation.quotation_no !== omg) {
    throw new Error('OMG number does not match this quotation.');
  }

  if (quotation.opportunity_id && (await deps.isOpportunityLost(quotation.opportunity_id))) {
    throw new Error('Cannot replace documents on a Lose Case opportunity.');
  }

  if (!input.filename?.trim()) throw new Error('filename is required.');

  const meta = REPLACE_DOC_TYPES[docType];
  const bytes = await loadFileBytes(input);
  const contentType = guessContentType(input.filename);
  const filePath = await deps.uploadBytes({
    quotationId: quotation.id,
    documentTypeSlug: meta.slug,
    filename: input.filename.trim(),
    bytes,
    contentType,
  });

  const companyName = (quotation.company_name || quotation.customer_name || 'Unknown').trim();
  const newRow = await deps.insertDocument({
    quotation_id: quotation.id,
    document_type: meta.slug,
    document_type_name: meta.name,
    file_name: input.filename.trim(),
    original_file_name: input.filename.trim(),
    file_path: filePath,
    file_url: '',
    company_name: companyName,
    storage_provider: 'r2',
    status: 'submitted',
  });

  const existing = await deps.listCurrentByQuotation(quotation.id);
  const toSupersede = existing.filter(
    (d) => d.id !== newRow.id && docTypeMatchesReplaceTarget(meta.slug, d.document_type)
  );
  const oldLatest =
    toSupersede.sort(
      (a, b) =>
        new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime()
    )[0]?.id ?? null;

  if (toSupersede.length) {
    await deps.supersedeRows(
      toSupersede.map((d) => d.id),
      newRow.id,
      input.actor || 'mcp'
    );
  }

  const newDoc: DocumentRow = {
    id: newRow.id,
    quotation_id: quotation.id,
    document_type: meta.slug,
    file_name: input.filename.trim(),
    file_path: filePath,
    file_url: '',
    storage_provider: 'r2',
  };
  const new_url = await deps.resolvePublicUrl(newDoc);

  await deps.insertActivityLog({
    quotation_id: quotation.id,
    event: 'document_replaced',
    actor: input.actor || 'mcp',
    payload: {
      omg_number: quotation.quotation_no,
      doc_type: docType,
      document_type_slug: meta.slug,
      new_document_id: newRow.id,
      old_document_ids: toSupersede.map((d) => d.id),
      new_url,
    },
  });

  await deps.emitReplaced({
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no,
    doc_type: docType,
    new_url,
  });

  const result: ReplaceQuotationDocumentSuccess = {
    ok: true,
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no,
    doc_type: docType,
    new_document_id: newRow.id,
    new_url,
    old_document_id: oldLatest,
  };

  if (docType === 'packing_list') {
    result.suggestions = {
      net_weight_kg: null,
      pallets: null,
      note: `Read net weight and pallets from the new packing list at ${new_url}, then call update_quotation_net_weight if needed. This replace did not change quotation weights.`,
    };
  }

  return result;
}

function r2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || '',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true,
  });
}

async function uploadToDocsR2(
  quotationId: string,
  documentTypeSlug: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  const ext = extensionFromFilename(filename);
  const safeName = `${randomUUID()}${ext}`;
  const filePath = `documents/${quotationId}/${documentTypeSlug}/${safeName}`;
  await r2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: filePath,
      Body: bytes,
      ContentType: contentType,
    })
  );
  return filePath;
}

export function buildReplaceDocumentDeps(supabase: SupabaseClient): ReplaceDocumentDeps {
  return {
    loadQuotation: async (ref) => {
      if (ref.quotation_id) {
        const { data, error } = await supabase
          .from('quotations')
          .select('id, quotation_no, company_name, customer_name, opportunity_id, status')
          .eq('id', ref.quotation_id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data as QuotationForReplace | null;
      }
      if (ref.omg_number) {
        const { data, error } = await supabase
          .from('quotations')
          .select('id, quotation_no, company_name, customer_name, opportunity_id, status')
          .eq('quotation_no', ref.omg_number)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data as QuotationForReplace | null;
      }
      return null;
    },
    isOpportunityLost: async (opportunityId) => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('closure_status')
        .eq('id', opportunityId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.closure_status === 'lost';
    },
    uploadBytes: async (p) =>
      uploadToDocsR2(p.quotationId, p.documentTypeSlug, p.filename, p.bytes, p.contentType),
    insertDocument: async (row) => {
      const { data, error } = await supabase
        .from('document_submissions')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id as string };
    },
    listCurrentByQuotation: async (quotationId) => {
      const { data, error } = await supabase
        .from('document_submissions')
        .select('*')
        .eq('quotation_id', quotationId)
        .is('superseded_at', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentRow[];
    },
    supersedeRows: async (ids, newId, replacedBy) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from('document_submissions')
        .update({
          superseded_at: new Date().toISOString(),
          superseded_by: newId,
          replaced_by: replacedBy,
        })
        .in('id', ids);
      if (error) throw new Error(error.message);
    },
    insertActivityLog: async (entry) => {
      const { error } = await supabase.from('quotation_activity_log').insert(entry);
      if (error) throw new Error(error.message);
    },
    resolvePublicUrl: async (doc) => {
      const { resolveDocumentFileUrl } = await import('@/lib/storage');
      return resolveDocumentFileUrl({
        file_path: doc.file_path,
        file_url: doc.file_url,
        storage_provider: (doc.storage_provider as 'r2') || 'r2',
      });
    },
    emitReplaced: async (payload) => {
      const { emitQuotationDocsReplaced } = await import('@/lib/webhooks');
      return emitQuotationDocsReplaced(supabase, payload);
    },
  };
}

export async function replaceQuotationDocument(input: ReplaceQuotationDocumentInput) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');
  return replaceQuotationDocumentCore(input, buildReplaceDocumentDeps(supabase));
}

export async function listQuotationDocumentRows(
  supabase: SupabaseClient,
  quotationId: string,
  includeSuperseded: boolean
): Promise<DocumentRow[]> {
  let query = supabase
    .from('document_submissions')
    .select('*')
    .eq('quotation_id', quotationId)
    .order('submitted_at', { ascending: false });
  if (!includeSuperseded) query = query.is('superseded_at', null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentRow[];
}

export async function attachmentFromDocumentRow(doc: DocumentRow) {
  const { getFileUrl } = await import('@/lib/storage');
  return {
    id: doc.id,
    document_type: doc.document_type,
    document_type_name: doc.document_type_name,
    file_name: doc.original_file_name || doc.file_name,
    download_url: doc.file_path
      ? await getFileUrl(
          doc.file_path,
          doc.storage_provider === 'supabase' ? 'supabase' : 'r2'
        )
      : doc.file_url || null,
    superseded_at: doc.superseded_at ?? null,
    is_current: !doc.superseded_at,
  };
}
