import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { downloadR2ObjectAsBase64 } from '@/lib/storage';
import {
  retryWithBackoff,
  getMimeType,
} from '@/lib/document-comparison-utils';
import { buildBookingSheetPayload, lookupBookingByToken } from '@/lib/booking-sheet';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function getVisionModel(): string {
  return process.env.GEMINI_VISION_MODEL || 'gemini-3.1-flash-lite-preview';
}

async function extractAwbNumber(filePath: string, fileName: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const base64Data = await downloadR2ObjectAsBase64(filePath);
  const mimeType = getMimeType(fileName);
  const ai = new GoogleGenAI({ apiKey });
  const model = getVisionModel();

  const prompt = `You are reading an Air Waybill (AWB) document for air freight.
Extract the primary AWB / HAWB / MAWB number shown on the document.
Return STRICT JSON only (no markdown, no prose) in this format:
{ "awb_number": "<the number as printed, e.g. 123-45678901>" }
If you cannot find a number, return { "awb_number": "" }.`;

  const response = await retryWithBackoff(
    () =>
      ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt },
        ],
        config: { responseMimeType: 'application/json' },
      }),
    3,
    2000
  );

  const text = (response as { text?: string })?.text ?? '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned) as { awb_number?: string };
  return (parsed.awb_number || '').trim();
}

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

    const lookup = await lookupBookingByToken(trimmed, 'booking_share_token');
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }

    const payload = await buildBookingSheetPayload(lookup);
    return NextResponse.json(payload);
  } catch (e) {
    console.error('booking GET:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const trimmed = token?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';

    const lookup = await lookupBookingByToken(trimmed, 'booking_share_token');
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }
    const { row, supabase } = lookup;

    if (action === 'extract') {
      const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : 'awb.pdf';
      if (!filePath) {
        return NextResponse.json({ error: 'filePath is required' }, { status: 400 });
      }

      let awbNumber = '';
      let geminiFailed = false;
      let geminiError = '';
      try {
        awbNumber = await extractAwbNumber(filePath, fileName);
      } catch (e) {
        geminiFailed = true;
        geminiError = e instanceof Error ? e.message : String(e);
        console.error('booking AWB extract:', e);
      }

      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('quotations')
        .update({
          awb_file_url: filePath,
          awb_file_name: fileName,
          awb_uploaded_at: now,
          awb_number: awbNumber || null,
          awb_number_source: awbNumber ? 'gemini' : null,
          storage_provider: 'r2',
          updated_at: now,
        })
        .eq('id', row.id);

      if (updateError) {
        console.error('booking extract save:', updateError);
        const hint = updateError.message?.includes('awb_number')
          ? ' Database migration 013 may not be applied yet.'
          : '';
        return NextResponse.json(
          { error: `Failed to save AWB file.${hint}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        awb_number: awbNumber,
        gemini_failed: geminiFailed,
        gemini_error: geminiFailed ? geminiError : undefined,
      });
    }

    if (action === 'save') {
      const awbNumber = typeof body.awbNumber === 'string' ? body.awbNumber.trim() : '';
      if (!awbNumber) {
        return NextResponse.json({ error: 'awbNumber is required' }, { status: 400 });
      }

      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('quotations')
        .update({
          awb_number: awbNumber,
          awb_number_source: 'airfreight',
          booking_status: 'confirmed',
          booking_confirmed_at: now,
          updated_at: now,
        })
        .eq('id', row.id);

      if (updateError) {
        console.error('booking save AWB:', updateError);
        return NextResponse.json({ error: 'Failed to save AWB number' }, { status: 500 });
      }

      return NextResponse.json({ success: true, awb_number: awbNumber });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    console.error('booking POST:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
