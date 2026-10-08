import { NextResponse } from 'next/server';
import { requireStaffApiUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function sameCustomerFilter(q: { company_id?: string | null; customer_user_id?: string | null }) {
  if (q.company_id) {
    return { column: 'company_id' as const, value: q.company_id };
  }
  if (q.customer_user_id) {
    return { column: 'customer_user_id' as const, value: q.customer_user_id };
  }
  return null;
}

export async function GET(request: Request) {
  const auth = await requireStaffApiUser(request);
  if (!auth.ok) return auth.response;

  const quotationId = new URL(request.url).searchParams.get('quotationId')?.trim();
  if (!quotationId) {
    return NextResponse.json({ error: 'quotationId is required' }, { status: 400 });
  }

  const { data: source, error: srcErr } = await auth.supabase
    .from('quotations')
    .select('id, company_id, customer_user_id, quotation_no')
    .eq('id', quotationId)
    .maybeSingle();

  if (srcErr || !source) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
  }

  const filter = sameCustomerFilter(source);
  if (!filter) {
    return NextResponse.json({ candidates: [], blockedReason: 'no_customer_link' });
  }

  let q = auth.supabase
    .from('quotations')
    .select('id, quotation_no, destination, company_id, customer_user_id')
    .neq('id', quotationId)
    .order('quotation_no', { ascending: false });

  q = q.eq(filter.column, filter.value);

  const { data: rows, error: listErr } = await q;
  if (listErr) {
    console.error('[swap GET]', listErr);
    return NextResponse.json({ error: 'Could not load quotations' }, { status: 500 });
  }

  const ids = (rows ?? []).map((r) => r.id);
  const allQuoteIds = [quotationId, ...ids];
  const docCountByQuote = new Map<string, number>();
  if (allQuoteIds.length) {
    const { data: docs } = await auth.supabase
      .from('document_submissions')
      .select('quotation_id')
      .in('quotation_id', allQuoteIds);
    for (const d of docs ?? []) {
      const qid = d.quotation_id as string;
      docCountByQuote.set(qid, (docCountByQuote.get(qid) ?? 0) + 1);
    }
  }

  const candidates = (rows ?? []).map((r) => ({
    id: r.id,
    quotation_no: r.quotation_no,
    destination: r.destination,
    doc_count: docCountByQuote.get(r.id) ?? 0,
  }));

  return NextResponse.json({
    quotation_no: source.quotation_no,
    doc_count: docCountByQuote.get(quotationId) ?? 0,
    candidates,
  });
}

export async function POST(request: Request) {
  const auth = await requireStaffApiUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const quotationId = typeof body?.quotationId === 'string' ? body.quotationId.trim() : '';
  const otherQuotationId =
    typeof body?.otherQuotationId === 'string' ? body.otherQuotationId.trim() : '';

  if (!quotationId || !otherQuotationId) {
    return NextResponse.json({ error: 'quotationId and otherQuotationId are required' }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc('swap_quotation_documents', {
    p_a: quotationId,
    p_b: otherQuotationId,
    p_actor: auth.user.id,
  });

  if (error) {
    const msg = error.message || 'Swap failed';
    const status = msg.includes('not found') || msg.includes('different') || msg.includes('same customer')
      ? 400
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  return NextResponse.json({ ok: true, result: data });
}

export async function PATCH(request: Request) {
  const auth = await requireStaffApiUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const quotationId = typeof body?.quotationId === 'string' ? body.quotationId.trim() : '';
  if (!quotationId) {
    return NextResponse.json({ error: 'quotationId is required' }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from('quotations')
    .update({
      docs_swap_checked_at: new Date().toISOString(),
      docs_swap_checked_by: auth.user.id,
    })
    .eq('id', quotationId)
    .not('docs_swapped_at', 'is', null)
    .select('id, docs_swap_checked_at')
    .maybeSingle();

  if (error) {
    console.error('[swap PATCH]', error);
    return NextResponse.json({ error: 'Could not mark as checked' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'No pending swap to confirm on this quotation' }, { status: 400 });
  }

  return NextResponse.json({ ok: true, docs_swap_checked_at: data.docs_swap_checked_at });
}
