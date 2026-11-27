import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { customerWithoutCompanyResponse } from '@/lib/api-auth';
import { sendQuoteRequestNotification } from '@/lib/mail';
import { absoluteUrl } from '@/lib/site';
import { emitQuotationCreated } from '@/lib/webhooks';
import type { DocumentSubmission, Quotation } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const quotationId = typeof body.quotationId === 'string' ? body.quotationId.trim() : '';

    if (!quotationId) {
      return NextResponse.json({ error: 'Missing quotationId.' }, { status: 400 });
    }

    const { data: quote, error } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', quotationId)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
    }

    if (quote.status !== 'pending_approval') {
      return NextResponse.json({ error: 'Not a pending quote request.' }, { status: 400 });
    }

    if (quote.customer_user_id) {
      const companyBlock = await customerWithoutCompanyResponse(supabase, quote.customer_user_id);
      if (companyBlock) return companyBlock;
    }

    const pallets = Array.isArray(quote.pallets) ? quote.pallets : [];

    try {
      await sendQuoteRequestNotification({
        quotationNo: quote.quotation_no,
        customerName: quote.customer_name,
        companyName: quote.company_name,
        requestedDestination: quote.requested_destination,
        commodityType: quote.commodity_type,
        phytoRequired: !!quote.phyto_required,
        palletCount: pallets.length,
        notes: quote.notes,
        approveUrl: absoluteUrl(`/shipping-calculator/new?approve_from=${quote.id}`),
      });
    } catch (emailErr) {
      console.error('[notify-quote-request] Email notification failed:', emailErr);
    }

    const { data: docs } = await supabase
      .from('document_submissions')
      .select('*')
      .eq('quotation_id', quotationId)
      .order('submitted_at', { ascending: false });

    await emitQuotationCreated(
      supabase,
      quote as Quotation,
      (docs ?? []) as DocumentSubmission[]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[notify-quote-request] Unexpected error:', err);
    return NextResponse.json({ ok: true });
  }
}
