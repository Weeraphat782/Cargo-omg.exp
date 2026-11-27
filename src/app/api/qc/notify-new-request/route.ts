import { NextResponse } from 'next/server';
import { customerWithoutCompanyResponse, requireApiUser } from '@/lib/api-auth';
import { sendQcRequestToLineGroup } from '@/lib/line-admin-notify';
import { getQcPayableTotal } from '@/lib/qc-invoice';
import { absoluteUrl } from '@/lib/site';
import { ROLES } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;

  if (auth.role !== ROLES.CUSTOMER) {
    return NextResponse.json({ error: 'Customer access required.' }, { status: 403 });
  }

  const companyBlock = await customerWithoutCompanyResponse(auth.supabase, auth.user.id);
  if (companyBlock) return companyBlock;

  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
  if (!requestId) {
    return NextResponse.json({ error: 'Missing requestId.' }, { status: 400 });
  }

  const { data: qcRequest, error: requestError } = await auth.supabase
    .from('qc_requests')
    .select('id, qc_code, customer_user_id, contact_name, company_name_address, sample_name, net_payable, grand_total, wht_amount, qc_templates(name)')
    .eq('id', requestId)
    .maybeSingle();

  if (requestError) {
    console.error('[qc notify-new-request] load request failed:', requestError);
    return NextResponse.json({ error: 'Could not load QC request.' }, { status: 500 });
  }

  if (!qcRequest) {
    return NextResponse.json({ error: 'QC request not found.' }, { status: 404 });
  }

  if (qcRequest.customer_user_id !== auth.user.id) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const templateName =
    qcRequest.qc_templates &&
    typeof qcRequest.qc_templates === 'object' &&
    'name' in qcRequest.qc_templates &&
    typeof qcRequest.qc_templates.name === 'string'
      ? qcRequest.qc_templates.name
      : null;

  const lineResult = await sendQcRequestToLineGroup({
    qcCode: qcRequest.qc_code,
    requestId: qcRequest.id,
    contactName: qcRequest.contact_name,
    companyName: qcRequest.company_name_address,
    sampleName: qcRequest.sample_name,
    templateName,
    estimatedTotal: getQcPayableTotal(qcRequest),
    detailUrl: absoluteUrl(`/qc/requests/${qcRequest.id}`),
  });

  if (!lineResult.ok) {
    if (lineResult.reason === 'not_configured') {
      console.warn('[qc notify-new-request] LINE not configured');
      return NextResponse.json({ ok: true, sent: 0, reason: 'line_not_configured' });
    }

    console.error('[qc notify-new-request] LINE push failed:', lineResult.detail);
    return NextResponse.json({
      ok: true,
      sent: 0,
      reason: 'line_send_failed',
      detail: lineResult.detail,
    });
  }

  return NextResponse.json({ ok: true, sent: 1, transport: 'line_group' });
}
