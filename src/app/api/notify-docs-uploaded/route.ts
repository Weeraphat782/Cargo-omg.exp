import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { customerWithoutCompanyResponse } from '@/lib/api-auth';
import { BOOKING_WEIGHT_DOC_TYPES, emitQuotationDocsUploaded } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const quotationId =
      typeof body.quotationId === 'string' ? body.quotationId.trim() : '';
    const rawTypes = Array.isArray(body.docTypesAdded) ? body.docTypesAdded : [];
    const docTypesAdded = rawTypes.filter(
      (t: unknown): t is string => typeof t === 'string' && BOOKING_WEIGHT_DOC_TYPES.has(t)
    );

    if (!quotationId) {
      return NextResponse.json({ error: 'Missing quotationId.' }, { status: 400 });
    }
    if (docTypesAdded.length === 0) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const { data: quote, error } = await supabase
      .from('quotations')
      .select('id, customer_user_id')
      .eq('id', quotationId)
      .maybeSingle();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
    }

    if (quote.customer_user_id) {
      const companyBlock = await customerWithoutCompanyResponse(supabase, quote.customer_user_id);
      if (companyBlock) return companyBlock;
    }

    await emitQuotationDocsUploaded(supabase, quotationId, docTypesAdded);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[notify-docs-uploaded] Unexpected error:', err);
    return NextResponse.json({ ok: true });
  }
}
