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
    return `${base} (${timeZone.replace(/_/g, ' ')})`;
  } catch {
    return iso;
  }
}

/** Parse ±HH:MM to minutes east of UTC. */
export function offsetToMinutes(offset: string): number {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/** Wall-clock at fixed offset from UTC (for destination local display). */
function formatWallClockAtOffset(iso: string, offset: string): string | null {
  const mins = offsetToMinutes(offset);
  if (!offset || offset === '+00:00') return null;
  try {
    const utcMs = new Date(iso).getTime();
    const wall = new Date(utcMs + mins * 60 * 1000);
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return `${fmt.format(wall)} (UTC${offset})`;
  } catch {
    return null;
  }
}

export function formatDeliveredTimes(
  iso: string,
  deliveredLocalOffset: string | null | undefined
): { bangkok: string; destinationLocal: string | null } {
  const bangkok = formatInTimeZone(iso, BKK, true);
  const offset = deliveredLocalOffset?.trim() || null;
  const destinationLocal = offset ? formatWallClockAtOffset(iso, offset) : null;
  return { bangkok, destinationLocal };
}

function formatFlightLine(q: QuotationRow): string | null {
  const af = q.booking_air_freight as {
    flight_no?: string;
    booked_date?: string;
  } | null;
  const flightNo = af?.flight_no?.trim();
  if (!flightNo) return null;
  const dateRaw = af?.booked_date?.trim();
  if (!dateRaw) return flightNo;
  try {
    const d = new Date(`${dateRaw}T12:00:00`);
    const dateLabel = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(d);
    return `${flightNo} · ${dateLabel}`;
  } catch {
    return flightNo;
  }
}

export function effectiveChargeableKg(q: QuotationRow): number | null {
  if (q.is_chargeable_weight_manual && q.manual_chargeable_weight != null && q.manual_chargeable_weight > 0) {
    return q.manual_chargeable_weight;
  }
  if (q.chargeable_weight != null && q.chargeable_weight > 0) return q.chargeable_weight;
  const af = q.booking_air_freight as { chargeable_weight_kg?: number } | null;
  const fromAir = af?.chargeable_weight_kg;
  if (fromAir != null && Number(fromAir) > 0) return Number(fromAir);
  return null;
}

export function buildDeliveredEmailContent(opts: {
  quotation: QuotationRow;
  source_url: string;
  delivered_at: string;
  delivered_local_offset?: string | null;
}): { subject: string; html: string; text: string } {
  const q = opts.quotation;
  const omg = q.quotation_no || '';
  const norm = q.awb_number ? normalizeAwb(q.awb_number) : null;
  const awb = norm ? formatAwbDisplay(norm) : q.awb_number || '';
  const dest = (q.destination || q.requested_destination || '').trim();
  const flight = formatFlightLine(q);
  const pallets = palletCount(q.pallets);
  const chgKg = effectiveChargeableKg(q);
  const { bangkok, destinationLocal } = formatDeliveredTimes(
    opts.delivered_at,
    opts.delivered_local_offset ?? q.delivered_local_offset
  );
  const trackLink = opts.source_url?.trim() || '';

  const subject = `Delivered — ${omg || 'Shipment'} / AWB ${awb || '—'}`;

  const rows: [string, string][] = [];
  if (omg) rows.push(['OMG number', omg]);
  if (awb) rows.push(['AWB', awb]);
  if (dest) rows.push(['Route', `BKK → ${dest}`]);
  if (flight) rows.push(['Flight', flight]);
  if (pallets > 0) rows.push(['Pallets', String(pallets)]);
  if (chgKg != null) rows.push(['Chargeable weight', `${chgKg} kg`]);
  rows.push(['Delivered (Bangkok)', bangkok]);
  if (destinationLocal) rows.push(['Delivered (destination local)', destinationLocal]);

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
