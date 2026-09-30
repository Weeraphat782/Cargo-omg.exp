import type { QuotationRow } from './core';
import { formatAwbDisplay, normalizeAwb } from './core';

const BKK = 'Asia/Bangkok';

function palletCount(pallets: unknown): number {
  if (!Array.isArray(pallets)) return 0;
  return pallets.reduce((sum, p) => {
    const row = p as { quantity?: number };
    return sum + Math.max(1, Number(row.quantity) || 1);
  }, 0);
}

function formatInTimeZone(iso: string, timeZone: string, withOffsetLabel: boolean): string {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const base = fmt.format(d);
    if (!withOffsetLabel) return base;
    return `${base} (${timeZone.replace('_', ' ')})`;
  } catch {
    return iso;
  }
}

/** Destination local: use offset embedded in ISO when present. */
function formatDestinationLocal(iso: string, offset: string | null): string | null {
  if (!offset || offset === '+00:00') {
    return null;
  }
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    return `${fmt.format(d)} (UTC${offset})`;
  } catch {
    return null;
  }
}

export function buildDeliveredEmailContent(opts: {
  quotation: QuotationRow;
  source_url: string;
  delivered_at: string;
  delivered_local_offset?: string | null;
}): { subject: string; html: string; text: string } {
  const q = opts.quotation;
  const omg = q.quotation_no || '—';
  const norm = q.awb_number ? normalizeAwb(q.awb_number) : null;
  const awb = norm ? formatAwbDisplay(norm) : q.awb_number || '—';
  const dest = q.destination || q.requested_destination || '—';
  const flight = q.booking_air_freight?.flight_no || '—';
  const pallets = palletCount(q.pallets);
  const chg = q.chargeable_weight != null ? `${q.chargeable_weight} kg` : '—';
  const bangkok = formatInTimeZone(opts.delivered_at, BKK, true);
  const destLocal = formatDestinationLocal(opts.delivered_at, opts.delivered_local_offset ?? null);
  const trackLink = opts.source_url?.trim() || '';

  const subject = `Delivered — ${omg} / AWB ${awb}`;

  const rows = [
    ['OMG number', omg],
    ['AWB', awb],
    ['Route', `BKK → ${dest}`],
    ['Flight', flight],
    ['Pallets', String(pallets || '—')],
    ['Chargeable weight', chg],
    ['Delivered (Bangkok)', bangkok],
    ...(destLocal ? [['Delivered (destination local)', destLocal] as const] : []),
  ];

  const textRows = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const text = `Your shipment has been delivered.\n\n${textRows}\n\n${trackLink ? `Track: ${trackLink}\n` : ''}— OMG Cargo`;

  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 12px;color:#64748b;font-size:14px;border-bottom:1px solid #e2e8f0;">${k}</td><td style="padding:8px 12px;font-size:14px;border-bottom:1px solid #e2e8f0;"><strong>${escapeHtml(String(v))}</strong></td></tr>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;">
<div style="max-width:560px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
<div style="background:#0f172a;color:#fff;padding:20px 24px;"><h1 style="margin:0;font-size:18px;font-weight:600;">OMG Cargo</h1></div>
<div style="padding:24px;">
<p style="margin:0 0 16px;font-size:16px;color:#0f172a;">Your shipment has been <strong>delivered</strong>.</p>
<table style="width:100%;border-collapse:collapse;">${tableRows}</table>
${trackLink ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(trackLink)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;">Track shipment</a></p>` : ''}
<p style="margin:24px 0 0;font-size:12px;color:#64748b;">Questions? Reply to this email or contact cargo@omgexp.com</p>
</div></div></body></html>`;

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
