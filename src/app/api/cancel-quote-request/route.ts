import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { readFileCaller } from '@/lib/file-access'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const gate = await readFileCaller(request);
  if (!gate.ok) return gate.response;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 })
  }

  if (!gate.caller.userId) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  try {
    const { quotationId } = await request.json()

    if (!quotationId) {
      return NextResponse.json({ error: 'Missing quotationId.' }, { status: 400 })
    }

    // Verify the quotation belongs to this signed-in user and is still pending_approval
    const { data: quotation, error: fetchError } = await supabase
      .from('quotations')
      .select('id, status, customer_user_id')
      .eq('id', quotationId)
      .single()

    if (fetchError || !quotation) {
      return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 })
    }

    if (!gate.caller.staff && quotation.customer_user_id !== gate.caller.userId) {
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
