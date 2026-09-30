import { Resend } from 'resend';
import type { StoredAttribution } from '@/lib/contact-attribution';
import { formatAttributionLine } from '@/lib/contact-attribution';
import { buildDeliveredEmailContent } from '@/lib/awb-tracking/delivered-email';
import type { QuotationRow } from '@/lib/awb-tracking/core';

const resend = new Resend(process.env.RESEND_API_KEY);

const DEFAULT_ADMIN_EMAIL = 'cargo@omgexp.com';
const DEFAULT_SENDER = 'OMG Cargo <noreply@omgcargo.tech>';

function resolveSender() {
  return process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_SENDER;
}

function resolveRecipients() {
  return (process.env.CONTACT_NOTIFY_EMAIL || DEFAULT_ADMIN_EMAIL)
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

async function sendEmailToRecipients({
  to,
  bcc,
  subject,
  html,
  text,
}: {
  to: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
}) {
  const recipients = [...new Set(to.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (!process.env.RESEND_API_KEY) {
    console.warn('[mail] RESEND_API_KEY is missing. Email skipped.');
    return;
  }
  if (recipients.length === 0) {
    console.warn('[mail] No recipients. Email skipped.');
    return;
  }

  try {
    const bccList = [...new Set((bcc ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const { data, error } = await resend.emails.send({
      from: resolveSender(),
      to: recipients,
      ...(bccList.length ? { bcc: bccList } : {}),
      subject,
      html,
      text,
    });

    if (error) {
      console.error('[mail] Resend error:', error);
      throw error;
    }

    return data;
  } catch (err) {
    console.error('[mail] Failed to send email:', err);
    throw err;
  }
}

/**
 * Send an email to the administrator.
 */
export async function sendAdminNotification({
  subject,
  html,
  text,
}: {
  subject: string;
  html: string;
  text: string;
}) {
  try {
    return await sendEmailToRecipients({
      to: resolveRecipients(),
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error('[mail] Failed to send admin email:', err);
  }
}

/**
 * Specifically for Contact Form submissions.
 */
export async function sendContactNotification({
  name,
  email,
  company,
  inquiryType,
  message,
  attribution,
}: {
  name: string;
  email: string;
  company?: string | null;
  inquiryType?: string | null;
  message: string;
  attribution?: StoredAttribution | null;
}) {
  const attrLine = formatAttributionLine(attribution ?? null);
  const subject = `New Contact Inquiry from ${name}`;
  const html = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Company:</strong> ${company || 'N/A'}</p>
    <p><strong>Inquiry Type:</strong> ${inquiryType || 'N/A'}</p>
    ${attrLine ? `<p><strong>Attribution:</strong> ${attrLine.replace(/^\n📊 Attribution: /, '')}</p>` : ''}
    <hr />
    <p><strong>Message:</strong></p>
    <p style="white-space: pre-wrap;">${message}</p>
  `;
  const text = `New Contact Inquiry\n\nName: ${name}\nEmail: ${email}\nCompany: ${company || 'N/A'}\nInquiry: ${inquiryType || 'N/A'}${attrLine ? `\n${attrLine.trim()}` : ''}\n\nMessage:\n${message}`;

  return sendAdminNotification({ subject, html, text });
}

/**
 * Specifically for Document Uploads.
 */
export async function sendDocumentUploadNotification({
  customerName,
  quotationNo,
  documentTypes,
  fileCount,
  destination,
}: {
  customerName?: string | null;
  quotationNo?: string | null;
  documentTypes: string[];
  fileCount: number;
  destination?: string | null;
}) {
  const subject = `Documents Uploaded: ${customerName || 'Customer'} - ${quotationNo || 'Unknown Quote'}`;
  const html = `
    <h2>New Document Upload Update</h2>
    <p><strong>Customer:</strong> ${customerName || 'N/A'}</p>
    <p><strong>Quotation #:</strong> ${quotationNo || 'N/A'}</p>
    <p><strong>Destination:</strong> ${destination || 'N/A'}</p>
    <p><strong>Files Uploaded:</strong> ${fileCount}</p>
    <p><strong>Document Types:</strong> ${documentTypes.join(', ')}</p>
    <hr />
    <p>Please check the admin dashboard for details.</p>
  `;
  const text = `Documents Uploaded\n\nCustomer: ${customerName || 'N/A'}\nQuotation: ${quotationNo || 'N/A'}\nDestination: ${destination || 'N/A'}\nFiles: ${fileCount}\nTypes: ${documentTypes.join(', ')}`;

  return sendAdminNotification({ subject, html, text });
}

/**
 * Notify staff when a customer submits a new quote request (portal).
 */
export async function sendQuoteRequestNotification({
  quotationNo,
  customerName,
  companyName,
  requestedDestination,
  commodityType,
  phytoRequired,
  palletCount,
  notes,
  approveUrl,
}: {
  quotationNo?: string | null;
  customerName?: string | null;
  companyName?: string | null;
  requestedDestination?: string | null;
  commodityType?: string | null;
  phytoRequired?: boolean;
  palletCount?: number;
  notes?: string | null;
  approveUrl: string;
}) {
  const company = companyName?.trim() || 'N/A';
  const destination = requestedDestination?.trim() || 'N/A';
  const omgNo = quotationNo?.trim() || 'N/A';
  const subject = `New Quote Request: ${omgNo} — ${company} → ${destination}`;
  const notesBlock = notes?.trim()
    ? `<p><strong>Notes:</strong></p><p style="white-space: pre-wrap;">${notes.trim()}</p>`
    : '<p><strong>Notes:</strong> —</p>';

  const html = `
    <h2>New Customer Quote Request</h2>
    <p><strong>OMG No.:</strong> ${omgNo}</p>
    <p><strong>Customer:</strong> ${customerName || 'N/A'}</p>
    <p><strong>Company:</strong> ${company}</p>
    <p><strong>Requested destination:</strong> ${destination}</p>
    <p><strong>Commodity:</strong> ${commodityType || 'N/A'}</p>
    <p><strong>Phyto service:</strong> ${phytoRequired ? 'Yes' : 'No'}</p>
    <p><strong>Pallets:</strong> ${palletCount ?? 0}</p>
    ${notesBlock}
    <hr />
    <p><a href="${approveUrl}">Review &amp; approve in Shipping Calculator</a></p>
  `;
  const text = [
    'New Customer Quote Request',
    '',
    `OMG No.: ${omgNo}`,
    `Customer: ${customerName || 'N/A'}`,
    `Company: ${company}`,
    `Requested destination: ${destination}`,
    `Commodity: ${commodityType || 'N/A'}`,
    `Phyto service: ${phytoRequired ? 'Yes' : 'No'}`,
    `Pallets: ${palletCount ?? 0}`,
    '',
    notes?.trim() ? `Notes:\n${notes.trim()}` : 'Notes: —',
    '',
    `Review & approve: ${approveUrl}`,
  ].join('\n');

  return sendAdminNotification({ subject, html, text });
}

function formatMoney(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Notify assigned lab admins when a customer submits a new QC request.
 */
export async function sendQcRequestNotification({
  to,
  qcCode,
  requestId,
  contactName,
  companyName,
  sampleName,
  templateName,
  estimatedTotal,
  detailUrl,
}: {
  to: string[];
  qcCode: string;
  requestId: string;
  contactName?: string | null;
  companyName?: string | null;
  sampleName?: string | null;
  templateName?: string | null;
  estimatedTotal?: number | null;
  detailUrl: string;
}) {
  const customerLabel =
    companyName?.split('\n')[0]?.trim() ||
    contactName?.trim() ||
    'Customer';

  const subject = `QC Request ใหม่: ${qcCode}`;
  const html = `
    <h2>มี QC Request ใหม่เข้าระบบ</h2>
    <p><strong>QC Code:</strong> ${qcCode}</p>
    <p><strong>ลูกค้า:</strong> ${customerLabel}</p>
    <p><strong>ผู้ติดต่อ:</strong> ${contactName || '—'}</p>
    <p><strong>ตัวอย่าง:</strong> ${sampleName || '—'}</p>
    <p><strong>Template:</strong> ${templateName || '—'}</p>
    <p><strong>ราคาประมาณการ (Net):</strong> ${formatMoney(estimatedTotal)} THB</p>
    <hr />
    <p><a href="${detailUrl}">เปิดรายการในระบบ Lab</a></p>
    <p style="color:#64748b;font-size:12px;">Request ID: ${requestId}</p>
  `;
  const text = [
    'มี QC Request ใหม่เข้าระบบ',
    '',
    `QC Code: ${qcCode}`,
    `ลูกค้า: ${customerLabel}`,
    `ผู้ติดต่อ: ${contactName || '—'}`,
    `ตัวอย่าง: ${sampleName || '—'}`,
    `Template: ${templateName || '—'}`,
    `ราคาประมาณการ (Net): ${formatMoney(estimatedTotal)} THB`,
    '',
    `เปิดรายการ: ${detailUrl}`,
  ].join('\n');

  return sendEmailToRecipients({ to, subject, html, text });
}

const DELIVERED_BCC = 'cargo@omgexp.com';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Delivered notification with up to 3 attempts (1s, 3s backoff). */
export async function sendDeliveredNotification(opts: {
  quotation: QuotationRow;
  recipients: string[];
  source_url: string;
  delivered_at: string;
  delivered_local_offset?: string | null;
}) {
  const { subject, html, text } = buildDeliveredEmailContent({
    quotation: opts.quotation,
    source_url: opts.source_url,
    delivered_at: opts.delivered_at,
    delivered_local_offset: opts.delivered_local_offset,
  });

  const to = [...new Set(opts.recipients.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0) throw new Error('No recipients for delivered email.');

  const delays = [0, 1000, 3000];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt]);
    try {
      const data = await sendEmailToRecipients({
        to,
        bcc: [DELIVERED_BCC],
        subject,
        html,
        text,
      });
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Delivered email failed after 3 attempts.');
}
