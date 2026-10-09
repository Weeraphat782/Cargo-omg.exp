import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveDocumentFileUrl } from '@/lib/storage';

export const BOOKING_QUOTATION_SELECT = `
  id,
  quotation_no,
  company_name,
  customer_name,
  contact_person,
  destination,
  commodity_type,
  pallets,
  total_actual_weight,
  total_volume_weight,
  chargeable_weight,
  booking_details,
  awb_file_url,
  awb_file_name,
  awb_number,
  awb_number_source,
  customs_declaration_file_url,
  customs_declaration_file_name,
  storage_provider,
  docs_swapped_at,
  docs_swapped_with,
  docs_swap_checked_at
`;

export type BookingTokenColumn = 'booking_share_token' | 'booking_view_token';

export interface BookingQuotationRow {
  id: string;
  quotation_no?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  contact_person?: string | null;
  destination?: string | null;
  commodity_type?: string | null;
  pallets?: unknown;
  total_actual_weight?: number | null;
  total_volume_weight?: number | null;
  chargeable_weight?: number | null;
  booking_details?: unknown;
  awb_file_url?: string | null;
  awb_file_name?: string | null;
  awb_number?: string | null;
  awb_number_source?: string | null;
  customs_declaration_file_url?: string | null;
  customs_declaration_file_name?: string | null;
  storage_provider?: string | null;
  docs_swapped_at?: string | null;
  docs_swapped_with?: string | null;
  docs_swap_checked_at?: string | null;
}

type BookingLookupResult =
  | { ok: false; error: string; status: number }
  | {
      ok: true;
      row: BookingQuotationRow;
      supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>;
    };

async function resolveStaffFileUrl(
  fileUrl: string | null | undefined,
  storageProvider: string | null | undefined
): Promise<string | null> {
  if (!fileUrl?.trim()) return null;
  const path = fileUrl.includes('supabase')
    ? fileUrl.split('/public/')[1] || fileUrl
    : fileUrl;
  const url = await resolveDocumentFileUrl({
    file_path: path,
    file_url: fileUrl,
    storage_provider: (storageProvider as 'supabase' | 'r2') || 'supabase',
  });
  return url || null;
}

export async function lookupBookingByToken(
  token: string,
  column: BookingTokenColumn
): Promise<BookingLookupResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: 'Server configuration error', status: 500 };

  const { data: row, error } = await supabase
    .from('quotations')
    .select(BOOKING_QUOTATION_SELECT)
    .eq(column, token)
    .maybeSingle();

  if (error) {
    console.error('booking lookup:', error);
    return { ok: false, error: 'Could not load booking', status: 500 };
  }
  if (!row) {
    return { ok: false, error: 'Invalid or expired booking link', status: 404 };
  }
  return { ok: true, row: row as BookingQuotationRow, supabase };
}

/** Strip internal-only fields for customer / consignee view links. */
export function sanitizeBookingQuotationForPublicView(row: BookingQuotationRow) {
  const rest = { ...row };
  delete rest.awb_number_source;
  delete rest.docs_swapped_at;
  delete rest.docs_swapped_with;
  delete rest.docs_swap_checked_at;
  return rest;
}

export async function buildBookingSheetPayload(
  lookup: Extract<BookingLookupResult, { ok: true }>,
  options?: { publicView?: boolean }
) {
  const { row, supabase } = lookup;

  const { data: docs } = await supabase
    .from('document_submissions')
    .select(
      'id, file_name, original_file_name, document_type, document_type_name, file_path, file_url, mime_type, submitted_at, storage_provider'
    )
    .eq('quotation_id', row.id)
    .order('submitted_at', { ascending: false });

  const documents = await Promise.all(
    (docs ?? []).map(async (doc) => {
      const file_url = await resolveDocumentFileUrl({
        file_path: doc.file_path,
        file_url: doc.file_url,
        storage_provider: doc.storage_provider || 'r2',
      });
      return { ...doc, file_url };
    })
  );

  const [awb_url, customs_url] = await Promise.all([
    resolveStaffFileUrl(row.awb_file_url, row.storage_provider),
    resolveStaffFileUrl(row.customs_declaration_file_url, row.storage_provider),
  ]);

  const quotation = options?.publicView ? sanitizeBookingQuotationForPublicView(row) : row;

  return {
    quotation,
    documents,
    staff_files: {
      awb_url,
      awb_file_name: row.awb_file_name,
      customs_url,
      customs_file_name: row.customs_declaration_file_name,
    },
  };
}
