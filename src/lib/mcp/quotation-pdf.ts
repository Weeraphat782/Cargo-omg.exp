import { jsPDF } from 'jspdf';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getQuotationVatBreakdownFromQuote,
  getQuotationVatRowsFromQuote,
  type Quotation,
} from '@/lib/db';
import { getFileUrl } from '@/lib/storage';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { uploadToDocsR2 } from '@/lib/mcp/replace-document';

function safeCompanySlug(name: string | null | undefined): string {
  const s = (name || 'Client').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 40);
  return s || 'Client';
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildQuotationPdfBytes(q: Quotation): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 48;
  const line = (text: string, size = 10, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, 500);
    for (const ln of lines) {
      if (y > 780) {
        doc.addPage();
        y = 48;
      }
      doc.text(ln, 48, y);
      y += size + 4;
    }
  };

  line('QUOTATION', 18, true);
  line(`Ref: ${q.quotation_no || q.id}`, 11);
  line('OMG Experience', 14, true);
  y += 8;
  line('CLIENT INFORMATION', 11, true);
  line(`Company: ${q.company_name || 'N/A'}`);
  line(`Contact: ${q.contact_person || 'N/A'}`);
  line(`Contract: ${q.contract_no || '—'}`);
  y += 6;
  line('SHIPPING DETAILS', 11, true);
  line(`Destination: ${q.destination || 'N/A'}`);
  if (q.created_at) line(`Date: ${new Date(q.created_at).toLocaleDateString()}`);
  y += 6;
  line('PALLET INFORMATION', 11, true);
  const pallets = Array.isArray(q.pallets) ? q.pallets : [];
  pallets.forEach((p, i) => {
    line(
      `#${i + 1}  ${p.length}×${p.width}×${p.height} cm  ${p.weight} kg`
    );
  });
  const chargeable =
    q.is_chargeable_weight_manual && q.manual_chargeable_weight
      ? Number(q.manual_chargeable_weight)
      : Number(q.chargeable_weight) || 0;
  line(`Chargeable weight: ${Math.ceil(chargeable)} kg`, 10, true);
  y += 6;
  line('SERVICES & CHARGES', 11, true);
  const quoteLike = q as Quotation;
  for (const row of getQuotationVatRowsFromQuote(quoteLike)) {
    line(`${row.label}  NON-VAT ${formatMoney(row.nonVatPart)}  VAT ${formatMoney(row.vatPart)}`);
  }
  const vb = getQuotationVatBreakdownFromQuote(quoteLike);
  line(`VAT 7%: ${formatMoney(vb.vat_amount)}`);
  if (vb.wht_amount > 0) line(`WHT 3%: (${formatMoney(vb.wht_amount)})`);
  line(`NET TO PAY: ${formatMoney(vb.net_payable)} THB`, 12, true);
  y += 8;
  if (q.notes) {
    line('NOTES', 11, true);
    line(String(q.notes));
  }
  line('PAYMENT INFORMATION', 11, true);
  line('Bank: KASIKORN BANK');
  line('Account: OMG Experience Co., Ltd. — 051-2-51692-0');

  const buf = doc.output('arraybuffer');
  return new Uint8Array(buf);
}

export async function getQuotationPdf(input: {
  quotation_id?: string;
  omg_number?: string;
  include_base64?: boolean;
  dry_run?: boolean;
}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error('Server configuration error.');

  let q: Quotation | null = null;
  if (input.quotation_id) {
    const { data, error } = await supabase.from('quotations').select('*').eq('id', input.quotation_id).maybeSingle();
    if (error) throw new Error(error.message);
    q = data as Quotation | null;
  } else if (input.omg_number) {
    const { data, error } = await supabase
      .from('quotations')
      .select('*')
      .eq('quotation_no', input.omg_number.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    q = data as Quotation | null;
  }
  if (!q) throw new Error('Quotation not found.');

  const fileName = `Quotation_${q.quotation_no || q.id}_${safeCompanySlug(q.company_name)}.pdf`;
  const bytes = buildQuotationPdfBytes(q);

  if (input.dry_run) {
    return {
      ok: true,
      dry_run: true,
      quotation_id: q.id,
      omg_number: q.quotation_no,
      file_name: fileName,
      bytes: bytes.length,
    };
  }

  const path = await uploadToDocsR2(q.id, 'quotation-pdf', fileName, bytes, 'application/pdf');
  const download_url = await getFileUrl(path, 'r2');
  await logQuotationPdfActivity(supabase, q.id, { file_name: fileName, download_url });
  const out: Record<string, unknown> = {
    ok: true,
    quotation_id: q.id,
    omg_number: q.quotation_no,
    file_name: fileName,
    download_url,
    file_path: path,
  };
  if (input.include_base64) {
    out.file_base64 = Buffer.from(bytes).toString('base64');
  }
  return out;
}

export async function logQuotationPdfActivity(
  supabase: SupabaseClient,
  quotationId: string,
  payload: Record<string, unknown>
) {
  await supabase.from('quotation_activity_log').insert({
    quotation_id: quotationId,
    event: 'quotation_pdf_generated',
    actor: 'mcp',
    payload: { source: 'mcp', ...payload },
  });
}
