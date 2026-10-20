import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { deleteFile, getFileUrl } from '@/lib/storage';
import {
  isQuotationColumnDocumentType,
  listMcpDocumentTypes,
  resolveDocumentTypeMeta,
} from '@/lib/mcp/document-catalog';
import {
  assertAllowedUploadFilename,
  guessContentTypeFromFilename,
  loadMcpDocumentBytes,
} from '@/lib/mcp/mcp-document-bytes';
import {
  buildReplaceDocumentDeps,
  type DocumentRow,
  type QuotationForReplace,
  uploadToDocsR2,
} from '@/lib/mcp/replace-document';

export { listMcpDocumentTypes };

export type UploadQuotationDocumentInput = {
  quotation_id?: string;
  omg_number?: string;
  document_type: string;
  file_name: string;
  file_base64?: string;
  file_url?: string;
  notes?: string;
  dry_run?: boolean;
  actor?: string;
};

export type DeleteQuotationDocumentInput = {
  document_id: string;
  quotation_id?: string;
  dry_run?: boolean;
  actor?: string;
};

async function loadQuotationRef(
  supabase: SupabaseClient,
  ref: { quotation_id?: string; omg_number?: string }
): Promise<QuotationForReplace | null> {
  return buildReplaceDocumentDeps(supabase).loadQuotation(ref);
}

function mcpActivityPayload(extra: Record<string, unknown>) {
  return { source: 'mcp', ...extra };
}

export async function uploadQuotationDocument(input: UploadQuotationDocumentInput) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');
  const deps = buildReplaceDocumentDeps(supabase);

  const meta = resolveDocumentTypeMeta(input.document_type);
  if (!meta) throw new Error(`Unknown document_type: ${input.document_type}`);

  if (!input.file_name?.trim()) throw new Error('file_name is required.');
  assertAllowedUploadFilename(input.file_name.trim());

  const quotation = await loadQuotationRef(supabase, {
    quotation_id: input.quotation_id,
    omg_number: input.omg_number,
  });
  if (!quotation) throw new Error('Quotation not found.');
  if (quotation.opportunity_id && (await deps.isOpportunityLost(quotation.opportunity_id))) {
    throw new Error('Cannot upload documents on a Lose Case opportunity.');
  }

  const bytes = await loadMcpDocumentBytes(input);
  const contentType = guessContentTypeFromFilename(input.file_name);

  if (input.dry_run) {
    return {
      ok: true,
      dry_run: true,
      quotation_id: quotation.id,
      omg_number: quotation.quotation_no,
      document_type: meta.slug,
      file_name: input.file_name.trim(),
      bytes: bytes.length,
    };
  }

  if (isQuotationColumnDocumentType(meta.slug)) {
    const filePath = await uploadToDocsR2(
      quotation.id,
      meta.slug,
      input.file_name.trim(),
      bytes,
      contentType
    );
    const patch: Record<string, string | null> = { storage_provider: 'r2' };
    if (meta.slug === 'awb') {
      patch.awb_file_url = filePath;
      patch.awb_file_name = input.file_name.trim();
      patch.awb_uploaded_at = new Date().toISOString();
    } else {
      patch.customs_declaration_file_url = filePath;
      patch.customs_declaration_file_name = input.file_name.trim();
      patch.customs_declaration_uploaded_at = new Date().toISOString();
    }
    const { error } = await supabase.from('quotations').update(patch).eq('id', quotation.id);
    if (error) throw new Error(error.message);
    const file_url = await getFileUrl(filePath, 'r2');
    await deps.insertActivityLog({
      quotation_id: quotation.id,
      event: 'document_uploaded',
      actor: input.actor || 'mcp',
      payload: mcpActivityPayload({
        document_type: meta.slug,
        file_name: input.file_name.trim(),
        file_path: filePath,
      }),
    });
    return {
      ok: true,
      quotation_id: quotation.id,
      omg_number: quotation.quotation_no,
      document_type: meta.slug,
      document_id: null,
      file_url,
    };
  }

  const filePath = await uploadToDocsR2(
    quotation.id,
    meta.slug,
    input.file_name.trim(),
    bytes,
    contentType
  );
  const companyName = (quotation.company_name || quotation.customer_name || 'Unknown').trim();
  const row = await deps.insertDocument({
    quotation_id: quotation.id,
    document_type: meta.slug,
    document_type_name: meta.name,
    file_name: input.file_name.trim(),
    original_file_name: input.file_name.trim(),
    file_path: filePath,
    file_url: '',
    company_name: companyName,
    storage_provider: 'r2',
    status: 'submitted',
    notes: input.notes?.trim() || null,
  });

  if (meta.slug === 'commercial-invoice' || meta.slug === 'packing-list') {
    const { emitQuotationDocsUploaded } = await import('@/lib/webhooks');
    await emitQuotationDocsUploaded(supabase, quotation.id, [meta.slug]);
  }

  const file_url = await getFileUrl(filePath, 'r2');

  await deps.insertActivityLog({
    quotation_id: quotation.id,
    event: 'document_uploaded',
    actor: input.actor || 'mcp',
    payload: mcpActivityPayload({
      document_id: row.id,
      document_type: meta.slug,
      file_name: input.file_name.trim(),
      file_url,
    }),
  });

  return {
    ok: true,
    quotation_id: quotation.id,
    omg_number: quotation.quotation_no,
    document_type: meta.slug,
    document_id: row.id,
    file_url,
  };
}

export async function deleteQuotationDocument(input: DeleteQuotationDocumentInput) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');
  const deps = buildReplaceDocumentDeps(supabase);

  const { data: doc, error } = await supabase
    .from('document_submissions')
    .select('*')
    .eq('id', input.document_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error('Document not found.');
  if (input.quotation_id && doc.quotation_id !== input.quotation_id) {
    throw new Error('document_id does not belong to this quotation_id.');
  }

  const quotation = await loadQuotationRef(supabase, { quotation_id: doc.quotation_id });
  if (quotation?.opportunity_id && (await deps.isOpportunityLost(quotation.opportunity_id))) {
    throw new Error('Cannot delete documents on a Lose Case opportunity.');
  }

  const fileName = (doc.original_file_name || doc.file_name) as string;
  const filePath = doc.file_path as string | null;

  if (input.dry_run) {
    return {
      ok: true,
      dry_run: true,
      document_id: doc.id,
      quotation_id: doc.quotation_id,
      file_name: fileName,
      file_path: filePath,
    };
  }

  if (filePath) {
    await deleteFile('documents', filePath, doc.storage_provider === 'supabase' ? 'supabase' : 'r2');
  }
  const { error: delErr } = await supabase.from('document_submissions').delete().eq('id', doc.id);
  if (delErr) throw new Error(delErr.message);

  await deps.insertActivityLog({
    quotation_id: doc.quotation_id as string,
    event: 'document_deleted',
    actor: input.actor || 'mcp',
    payload: mcpActivityPayload({
      document_id: doc.id,
      file_name: fileName,
      file_path: filePath,
    }),
  });

  return {
    ok: true,
    document_id: doc.id,
    quotation_id: doc.quotation_id,
    deleted_file_name: fileName,
  };
}

export async function attachmentWithMissingFlag(
  doc: DocumentRow,
  resolveUrl: (d: DocumentRow) => Promise<string | null>
): Promise<{
  id: string;
  document_type: string;
  document_type_name?: string | null;
  file_name: string;
  download_url: string | null;
  file_missing: boolean;
  superseded_at?: string | null;
  is_current: boolean;
}> {
  let file_missing = false;
  if (doc.file_path) {
    const { r2ObjectExists } = await import('@/lib/storage');
    file_missing = !(await r2ObjectExists(doc.file_path));
  }
  let download_url: string | null = null;
  if (!file_missing) {
    try {
      download_url = await resolveUrl(doc);
    } catch {
      file_missing = true;
    }
  }
  return {
    id: doc.id,
    document_type: doc.document_type,
    document_type_name: doc.document_type_name,
    file_name: doc.original_file_name || doc.file_name,
    download_url,
    file_missing,
    superseded_at: doc.superseded_at ?? null,
    is_current: !doc.superseded_at,
  };
}
