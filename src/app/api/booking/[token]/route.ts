import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { downloadR2ObjectAsBase64, resolveDocumentFileUrl } from '@/lib/storage';
import {
  retryWithBackoff,
  getMimeType,
} from '@/lib/document-comparison-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const QUOTATION_SELECT = `
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

function getVisionModel(): string {
  return process.env.GEMINI_VISION_MODEL || 'gemini-3.1-flash-lite-preview';
}

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

interface BookingQuotationRow {
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
}

type BookingLookupResult =
  | { ok: false; error: string; status: number }
  | { ok: true; row: BookingQuotationRow; supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>> };

async function lookupByToken(token: string): Promise<BookingLookupResult> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { ok: false, error: 'Server configuration error', status: 500 };

  const { data: row, error } = await supabase
    .from('quotations')
    .select(QUOTATION_SELECT)
    .eq('booking_share_token', token)
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

    const lookup = await lookupByToken(trimmed);
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.error }, { status: lookup.status });
    }
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

    return NextResponse.json({
      quotation: row,
      documents,
      staff_files: {
        awb_url,
        awb_file_name: row.awb_file_name,
        customs_url,
        customs_file_name: row.customs_declaration_file_name,
      },
    });
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

    const lookup = await lookupByToken(trimmed);
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
