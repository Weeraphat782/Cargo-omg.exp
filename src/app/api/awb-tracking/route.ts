import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  getAwbTracking,
  manualMarkDelivered,
  manualResendDelivered,
  updateAwbTracking,
} from '@/lib/awb-tracking/service';

export const dynamic = 'force-dynamic';

async function requireStaff(request: NextRequest) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!token) return { error: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }) };

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return { error: NextResponse.json({ error: 'Session expired.' }, { status: 401 }) };
  }

  const service = getSupabaseServerClient();
  if (!service) {
    return { error: NextResponse.json({ error: 'Server configuration error.' }, { status: 500 }) };
  }
  const { data: profile } = await service.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role as string | undefined;
  if (!role || !['admin', 'staff'].includes(role)) {
    return { error: NextResponse.json({ error: 'Forbidden.' }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if ('error' in auth && auth.error) return auth.error;

  const awb = request.nextUrl.searchParams.get('awb_number') || undefined;
  const omg = request.nextUrl.searchParams.get('omg_number') || undefined;
  const quotationId = request.nextUrl.searchParams.get('quotation_id') || undefined;

  try {
    if (quotationId) {
      const supabase = getSupabaseServerClient();
      const { data } = await supabase!
        .from('quotations')
        .select('quotation_no, awb_number')
        .eq('id', quotationId)
        .maybeSingle();
      if (!data?.awb_number && !data?.quotation_no) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      }
      const tracking = await getAwbTracking(
        data.awb_number ? { awb_number: data.awb_number } : { omg_number: data.quotation_no as string }
      );
      return NextResponse.json(tracking ?? { error: 'Not found.' }, { status: tracking ? 200 : 404 });
    }
    const tracking = await getAwbTracking({ awb_number: awb, omg_number: omg });
    if (!tracking) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json(tracking);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if ('error' in auth && auth.error) return auth.error;

  try {
    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case 'mark_delivered': {
        const result = await manualMarkDelivered(
          {
            awb_number: body.awb_number,
            omg_number: body.omg_number,
            quotation_id: body.quotation_id,
          },
          { send_email: body.send_email !== false }
        );
        return NextResponse.json(result);
      }
      case 'mark_delivered_no_email': {
        const result = await manualMarkDelivered(
          {
            awb_number: body.awb_number,
            omg_number: body.omg_number,
            quotation_id: body.quotation_id,
          },
          { send_email: false }
        );
        return NextResponse.json(result);
      }
      case 'resend_delivered_email': {
        const result = await manualResendDelivered({
          awb_number: body.awb_number,
          omg_number: body.omg_number,
          quotation_id: body.quotation_id,
        });
        return NextResponse.json(result);
      }
      case 'update_notify_list': {
        const supabase = getSupabaseServerClient();
        if (!supabase || !body.quotation_id) {
          return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
        }
        const emails = Array.isArray(body.emails)
          ? body.emails.map((e: string) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 10)
          : [];
        const { error } = await supabase
          .from('quotations')
          .update({ delivery_notify_emails: emails, updated_at: new Date().toISOString() })
          .eq('id', body.quotation_id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, emails });
      }
      case 'set_carrier': {
        const supabase = getSupabaseServerClient();
        if (!supabase || !body.quotation_id) {
          return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
        }
        const { error } = await supabase
          .from('quotations')
          .update({
            carrier_code: body.carrier_code || null,
            carrier_code_manual: Boolean(body.carrier_code_manual ?? true),
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.quotation_id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true });
      }
      case 'update_tracking': {
        const result = await updateAwbTracking({
          awb_number: body.awb_number,
          status: body.status,
          raw_text: body.raw_text || '',
          source_url: body.source_url || '',
          delivered_at: body.delivered_at,
          send_email: body.send_email,
          flight_no: body.flight_no,
          flight_date: body.flight_date,
          chargeable_weight_kg: body.chargeable_weight_kg,
          created_by: 'staff',
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed.' },
      { status: 500 }
    );
  }
}
