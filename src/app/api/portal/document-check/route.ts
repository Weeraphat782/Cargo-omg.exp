import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  downloadAndConvertToBase64,
  getMimeType,
} from '@/lib/document-comparison-utils';
import {
  computeRequiredDocStatus,
  isRequiredPrebookingType,
} from '@/lib/customer-check-rule';
import { getFileUrl } from '@/lib/storage';
import {
  mapPipelineError,
  runCustomerDocumentCheckPipeline,
  type DocumentCheckInput,
} from '@/lib/run-customer-document-check';
import { customerWithoutCompanyResponse } from '@/lib/api-auth';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const DAILY_CAP = 5;
const COOLDOWN_MS = 60_000;
const ENFORCE_DAILY_CAP = true;

export async function POST(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: userData, error: userError } = await anonClient.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) {
      return NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const quotationId = typeof body.quotation_id === 'string' ? body.quotation_id.trim() : '';
    if (!quotationId) {
      return NextResponse.json({ error: 'quotation_id is required.' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const companyBlock = await customerWithoutCompanyResponse(supabase, user.id);
    if (companyBlock) return companyBlock;

    const { data: quotation } = await supabase
      .from('quotations')
      .select('id, customer_user_id')
      .eq('id', quotationId)
      .eq('customer_user_id', user.id)
      .maybeSingle();

    if (!quotation) {
      return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRuns } = await supabase
      .from('document_analysis_history')
      .select('created_at')
      .eq('quotation_id', quotationId)
      .eq('created_by', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    const runsToday = recentRuns?.length || 0;
    if (ENFORCE_DAILY_CAP && runsToday >= DAILY_CAP) {
      return NextResponse.json(
        {
          error: `You have reached the daily limit of ${DAILY_CAP} checks for this shipment. Please try again tomorrow.`,
        },
        { status: 429 }
      );
    }
    if (recentRuns && recentRuns.length > 0) {
      const last = new Date(recentRuns[0].created_at).getTime();
      const elapsed = Date.now() - last;
      if (elapsed < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          { error: `Please wait ${wait}s before checking again.`, retryAfter: wait },
          { status: 429 }
        );
      }
    }

    const { data: docs } = await supabase
      .from('document_submissions')
      .select('id, file_name, document_type, file_path, file_url, storage_provider')
      .eq('quotation_id', quotationId);

    const documentList = docs ?? [];
    const requiredDocs = computeRequiredDocStatus(documentList.map((d) => d.document_type));
    const analyzeDocs = documentList.filter((d) => isRequiredPrebookingType(d.document_type));

    if (analyzeDocs.length === 0) {
      return NextResponse.json(
        { error: 'Upload the required pre-booking documents first.', requiredDocs },
        { status: 400 }
      );
    }
    if (analyzeDocs.length < 2) {
      return NextResponse.json(
        { error: 'Upload at least 2 of the required documents to run a check.', requiredDocs },
        { status: 400 }
      );
    }

    const pipelineInputs: DocumentCheckInput[] = [];
    for (const doc of analyzeDocs) {
      let effectiveUrl = doc.file_url;
      if (!effectiveUrl || !effectiveUrl.startsWith('http')) {
        effectiveUrl = await getFileUrl(
          doc.file_path || doc.file_url || '',
          doc.storage_provider || 'r2',
          'documents'
        );
      }
      if (!effectiveUrl) continue;
      const base64Data = await downloadAndConvertToBase64(effectiveUrl);
      pipelineInputs.push({
        id: doc.id,
        file_name: doc.file_name,
        document_type: doc.document_type,
        base64Data,
        mimeType: getMimeType(doc.file_name),
      });
    }

    if (pipelineInputs.length < 2) {
      return NextResponse.json(
        {
          error: 'We could not read enough of your documents. Please re-upload them and try again.',
          requiredDocs,
        },
        { status: 400 }
      );
    }

    const result = await runCustomerDocumentCheckPipeline(pipelineInputs);

    try {
      const { data: latest } = await supabase
        .from('document_analysis_history')
        .select('version')
        .eq('quotation_id', quotationId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (latest?.version || 0) + 1;
      const results = pipelineInputs.map((doc, index) => ({
        document_id: doc.id,
        document_name: doc.file_name,
        document_type: doc.document_type,
        ai_feedback: '',
        sequence_order: index + 1,
      }));
      await supabase.from('document_analysis_history').insert({
        quotation_id: quotationId,
        rule_id: null,
        version: nextVersion,
        results,
        critical_checks_results: result.checks.map((c) => ({
          check_name: c.name,
          status: c.status,
          details: c.details,
          issue: c.message,
        })),
        status: result.overallStatus,
        created_by: user.id,
      });
    } catch (e) {
      console.error('portal document-check history insert:', e);
    }

    return NextResponse.json({
      success: true,
      overallStatus: result.overallStatus,
      checks: result.checks,
      extractedByDocument: result.extractedByDocument,
      documents: result.documents,
      requiredDocs: result.requiredDocs,
      checksRemaining: Math.max(0, DAILY_CAP - (runsToday + 1)),
      checkedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error('portal document-check error:', error);
    const { message, status } = mapPipelineError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
