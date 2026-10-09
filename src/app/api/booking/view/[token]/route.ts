import { NextRequest, NextResponse } from 'next/server';
import { buildBookingSheetPayload, lookupBookingByToken } from '@/lib/booking-sheet';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const trimmed = token?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const lookup = await lookupBookingByToken(trimmed, 'booking_view_token');
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }

    const payload = await buildBookingSheetPayload(lookup, { publicView: true });
    return NextResponse.json(payload);
  } catch (e) {
    console.error('booking view GET:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
