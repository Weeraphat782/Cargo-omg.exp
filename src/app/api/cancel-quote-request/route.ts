import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { customerWithoutCompanyResponse } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 })
  }

  try {
    const { quotationId, userId } = await request.json()

    if (!quotationId || !userId) {
      return NextResponse.json({ error: 'Missing quotationId or userId.' }, { status: 400 })
    }

    const companyBlock = await customerWithoutCompanyResponse(supabase, userId)
    if (companyBlock) return companyBlock

    // Verify the quotation belongs to this user and is still pending_approval
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status, customer_user_id')
      .eq('id', quotationId)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 })
    }

    if (quotation.customer_user_id !== userId) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }

    if (quotation.status !== 'pending_approval') {
      return NextResponse.json({ error: 'Only pending requests can be cancelled.' }, { status: 400 })
    }

    const { error } = await supabase
      .from('quotations')
      .update({ status: 'cancelled' })
      .eq('id', quotationId)

    if (error) {
      // Fallback: if 'cancelled' isn't a valid enum, try deleting instead
      if (error.code === '23514' || error.message?.includes('check') || error.message?.includes('invalid')) {
        const { error: delError } = await supabase
          .from('quotations')
          .delete()
          .eq('id', quotationId)

        if (delError) {
          return NextResponse.json({ error: delError.message }, { status: 500 })
        }
        return NextResponse.json({ success: true, action: 'deleted' })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, action: 'cancelled' })
  } catch (err) {
    console.error('cancel-quote-request error:', err)
    return NextResponse.json({ error: 'Unexpected error.' }, { status: 500 })
  }
}
