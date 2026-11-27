import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireApiUser } from '@/lib/api-auth';
import { isStaffOrAdmin } from '@/lib/roles';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  anonymousMayReadTemplate,
  isSafeKey,
  isUuid,
  keyUnderCompanyRegistration,
  keyUnderCompanyUser,
  keyUnderQuotation,
  normalizeObjectKey,
  qcRequestIdFromKey,
  quotationIdFromKey,
} from '@/lib/file-access-rules';

export type FileCaller = {
  supabase: SupabaseClient;
  /** admin or staff — same file access the logged-in web app already had */
  staff: boolean;
  lab: boolean;
  userId: string | null;
  /** share_token or booking_share_token (write) or booking_view_token (read) */
  quotationToken: { id: string; write: boolean } | null;
  /** companies.onboarding_token — registration uploads for that company only */
  onboardingCompanyId: string | null;
};

type Gate =
  | { ok: true; caller: FileCaller }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function capabilityToken(request: Request): string {
  return (
    request.headers.get('x-capability-token') ||
    new URL(request.url).searchParams.get('token') ||
    ''
  ).trim();
}

async function quotationByToken(supabase: SupabaseClient, token: string) {
  if (!isUuid(token)) return null;
  const columns = 'id';
  for (const column of ['booking_share_token', 'share_token', 'booking_view_token'] as const) {
    const { data, error } = await supabase
      .from('quotations')
      .select(columns)
      .eq(column, token)
      .maybeSingle();
    if (error) {
      console.error('file-access token lookup:', error.message);
      return { error: true as const };
    }
    if (data?.id) {
      return { id: data.id as string, write: column !== 'booking_view_token' };
    }
  }
  return null;
}

async function companyByOnboardingToken(supabase: SupabaseClient, token: string) {
  if (!isUuid(token)) return null;
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (error) {
    console.error('file-access onboarding lookup:', error.message);
    return { error: true as const };
  }
  return data?.id ? { id: data.id as string } : null;
}

export async function readFileCaller(request: Request): Promise<Gate> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return { ok: false, response: deny(500, 'Server configuration error.') };
  }

  const header = request.headers.get('authorization') || '';
  const hasBearer = header.toLowerCase().startsWith('bearer ') && header.slice(7).trim().length > 0;

  let staff = false;
  let lab = false;
  let userId: string | null = null;

  if (hasBearer) {
    const auth = await requireApiUser(request);
    if (!auth.ok) return auth;
    userId = auth.user.id;
    staff = isStaffOrAdmin(auth.role);
    lab = auth.role === 'lab_admin';
  }

  const token = capabilityToken(request);
  let quotationToken: FileCaller['quotationToken'] = null;
  let onboardingCompanyId: string | null = null;

  if (token) {
    const quote = await quotationByToken(supabase, token);
    if (quote && 'error' in quote) {
      return { ok: false, response: deny(500, 'Could not verify link.') };
    }
    if (quote && 'id' in quote) quotationToken = quote;

    if (!quotationToken) {
      const company = await companyByOnboardingToken(supabase, token);
      if (company && 'error' in company) {
        return { ok: false, response: deny(500, 'Could not verify link.') };
      }
      if (company && 'id' in company) onboardingCompanyId = company.id;
    }
  }

  return {
    ok: true,
    caller: { supabase, staff, lab, userId, quotationToken, onboardingCompanyId },
  };
}

function identified(caller: FileCaller) {
  return caller.staff || caller.lab || !!caller.userId || !!caller.quotationToken || !!caller.onboardingCompanyId;
}

async function customerStoredKey(caller: FileCaller, key: string) {
  if (!caller.userId) return false;
  for (const column of ['awb_file_url', 'customs_declaration_file_url'] as const) {
    const { data } = await caller.supabase
      .from('quotations')
      .select('id')
      .eq('customer_user_id', caller.userId)
      .eq(column, key)
      .limit(1);
    if (data?.length) return true;
  }

  const { data: photos } = await caller.supabase
    .from('quotations')
    .select('id')
    .eq('customer_user_id', caller.userId)
    .contains('shipment_photo_url', [key])
    .limit(1);
  if (photos?.length) return true;

  for (const column of ['file_path', 'file_url'] as const) {
    const { data: docs } = await caller.supabase
      .from('document_submissions')
      .select('quotation_id')
      .eq(column, key)
      .limit(8);
    for (const doc of docs || []) {
      if (doc.quotation_id && (await customerOwnsQuotation(caller, doc.quotation_id))) return true;
    }
  }
  return false;
}

async function customerOwnsQuotation(caller: FileCaller, quotationId: string) {
  if (!caller.userId || !isUuid(quotationId)) return false;
  const { data, error } = await caller.supabase
    .from('quotations')
    .select('customer_user_id')
    .eq('id', quotationId)
    .maybeSingle();
  if (error) return false;
  return data?.customer_user_id === caller.userId;
}

async function customerOwnsQc(caller: FileCaller, qcRequestId: string) {
  if (!caller.userId || !isUuid(qcRequestId)) return false;
  const { data, error } = await caller.supabase
    .from('qc_requests')
    .select('customer_user_id')
    .eq('id', qcRequestId)
    .maybeSingle();
  if (error) return false;
  return data?.customer_user_id === caller.userId;
}

async function keyStoredOnQuotation(caller: FileCaller, quotationId: string, key: string) {
  const { data: quote } = await caller.supabase
    .from('quotations')
    .select('awb_file_url, customs_declaration_file_url, shipment_photo_url')
    .eq('id', quotationId)
    .maybeSingle();

  const stored = [
    quote?.awb_file_url,
    quote?.customs_declaration_file_url,
    ...(Array.isArray(quote?.shipment_photo_url) ? quote.shipment_photo_url : []),
  ];
  if (stored.some((value) => typeof value === 'string' && normalizeObjectKey(value) === key)) {
    return true;
  }

  for (const column of ['file_path', 'file_url'] as const) {
    const { data: docs } = await caller.supabase
      .from('document_submissions')
      .select('id')
      .eq('quotation_id', quotationId)
      .eq(column, key)
      .limit(1);
    if (docs?.length) return true;
  }
  return false;
}

export type UploadIntent =
  | { kind: 'template' }
  | { kind: 'qc'; qcRequestId: string }
  | { kind: 'company-doc'; userId: string }
  | { kind: 'company-registration'; companyId: string }
  | { kind: 'quotation'; quotationId: string };

/** null means the upload may proceed. */
export async function authorizeUpload(caller: FileCaller, intent: UploadIntent): Promise<NextResponse | null> {
  if (intent.kind === 'template') {
    if (caller.staff) return null;
    return deny(caller.userId || caller.lab ? 403 : 401, caller.userId || caller.lab ? 'Staff access required.' : 'Not authenticated.');
  }

  if (intent.kind === 'qc') {
    if (!isUuid(intent.qcRequestId)) return deny(400, 'Invalid QC request.');
    if (caller.staff || caller.lab) return null;
    if (await customerOwnsQc(caller, intent.qcRequestId)) return null;
    return deny(identified(caller) ? 403 : 401, identified(caller) ? 'You do not have access to this request.' : 'Not authenticated.');
  }

  if (intent.kind === 'company-doc') {
    if (!isUuid(intent.userId)) return deny(400, 'Invalid user.');
    if (caller.staff) return null;
    if (caller.userId && caller.userId === intent.userId) return null;
    return deny(identified(caller) ? 403 : 401, identified(caller) ? 'You can only update your own company documents.' : 'Not authenticated.');
  }

  if (intent.kind === 'company-registration') {
    if (!isUuid(intent.companyId)) return deny(400, 'Invalid company.');
    if (caller.staff) return null;
    if (caller.onboardingCompanyId === intent.companyId) return null;
    return deny(identified(caller) ? 403 : 401, identified(caller) ? 'This onboarding link does not match the company.' : 'Not authenticated.');
  }

  if (!isUuid(intent.quotationId)) return deny(400, 'Invalid quotation.');
  if (caller.staff) return null;
  if (caller.quotationToken?.id === intent.quotationId && caller.quotationToken.write) return null;
  if (await customerOwnsQuotation(caller, intent.quotationId)) return null;
  return deny(identified(caller) ? 403 : 401, identified(caller) ? 'You do not have access to this shipment.' : 'Not authenticated.');
}

/** null means this key may be read or deleted. */
export async function authorizeObject(
  caller: FileCaller,
  rawKey: string,
  bucketParam: string | null,
  mode: 'read' | 'delete'
): Promise<NextResponse | null> {
  const key = normalizeObjectKey(rawKey);
  if (!isSafeKey(key)) return deny(400, 'Invalid file path.');

  if (caller.staff) return null;

  if (bucketParam && bucketParam !== 'documents' && bucketParam !== 'templates') {
    return deny(403, 'You do not have access to this file.');
  }

  const templateRead = mode === 'read' && anonymousMayReadTemplate(key, bucketParam);

  if (!identified(caller)) {
    if (templateRead) return null;
    return deny(401, 'Not authenticated.');
  }

  if (templateRead) return null;

  if (caller.lab && key.startsWith('qc/')) return null;

  if (caller.userId && keyUnderCompanyUser(key, caller.userId)) return null;

  if (caller.onboardingCompanyId && keyUnderCompanyRegistration(key, caller.onboardingCompanyId)) {
    return null;
  }

  const quotationId = quotationIdFromKey(key);
  if (quotationId) {
    const tokenOk =
      caller.quotationToken?.id === quotationId &&
      (mode === 'read' || caller.quotationToken.write);
    if (tokenOk) return null;
    if (await customerOwnsQuotation(caller, quotationId)) return null;
  }

  const qcId = qcRequestIdFromKey(key);
  if (qcId && (caller.lab || (await customerOwnsQc(caller, qcId)))) return null;

  if (caller.quotationToken && (mode === 'read' || caller.quotationToken.write)) {
    if (keyUnderQuotation(key, caller.quotationToken.id)) return null;
    if (await keyStoredOnQuotation(caller, caller.quotationToken.id, key)) return null;
  }

  if (caller.userId && (await customerStoredKey(caller, key))) return null;

  return deny(403, 'You do not have access to this file.');
}

export async function authorizeQuotationWrite(caller: FileCaller, quotationId: string) {
  return authorizeUpload(caller, { kind: 'quotation', quotationId });
}
