'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  FileText,
  Loader2,
  PlayCircle,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  appendQcCoaPath,
  finalizeQcInvoice,
  getQcRequestById,
  removeQcCoaPath,
  updateQcRequest,
} from '@/lib/qc-db';
import { computeQcTotalsWithDiscount } from '@/lib/qc-invoice';
import { QcInvoiceContent } from '@/components/qc/qc-invoice-content';
import { getFileUrl } from '@/lib/storage';
import { browserAuthHeaders } from '@/lib/browser-auth';
import { toast } from 'sonner';
import { getQcCoaPaths, isQcPaymentSlipImage, QC_PAYMENT_STATUS_LABELS } from '@/lib/qc-types';
import type { QcRequest } from '@/lib/qc-types';

async function uploadQcFile(qcRequestId: string, file: File, documentType: string): Promise<string | null> {
  const generateUrlResponse = await fetch('/api/generate-upload-url', {
    method: 'POST',
    headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      qcRequestId,
      documentType,
    }),
  });
  if (!generateUrlResponse.ok) return null;
  const { signedUrl, path } = await generateUrlResponse.json();
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!putRes.ok) return null;
  return path as string;
}

function formatMoney(value: number) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LabQcRequestDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [request, setRequest] = useState<QcRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [labNotes, setLabNotes] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [estimatedCoaDate, setEstimatedCoaDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [coaUrls, setCoaUrls] = useState<{ path: string; url: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getQcRequestById(id);
    setRequest(data);
    if (data) {
      setLabNotes(data.lab_notes || '');
      setDiscountPercent(String(data.discount_percent ?? 0));
      setEstimatedCoaDate(data.estimated_coa_date?.slice(0, 10) || '');
      if (data.payment_slip_path) {
        setSlipUrl(await getFileUrl(data.payment_slip_path, 'r2'));
      } else {
        setSlipUrl(null);
      }
      const paths = getQcCoaPaths(data);
      const resolved = await Promise.all(
        paths.map(async (path) => ({ path, url: (await getFileUrl(path, 'r2')) || '' }))
      );
      setCoaUrls(resolved.filter((r) => r.url));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const previewTotals = useMemo(() => {
    if (!request) return null;
    return computeQcTotalsWithDiscount(
      request.selected_items ?? [],
      Number(discountPercent) || 0
    );
  }, [request, discountPercent]);

  const patch = async (patchData: Partial<QcRequest>) => {
    setBusy(true);
    const ok = await updateQcRequest(id, patchData);
    setBusy(false);
    if (ok) {
      toast.success('Updated');
      await load();
    } else {
      toast.error('Update failed');
    }
  };

  const verifyPayment = async () => {
    await patch({ payment_status: 'verified' });
  };

  const moveToProcessing = async () => {
    await patch({ status: 'processing' });
  };

  const markComplete = async () => {
    await patch({ status: 'complete', lab_notes: labNotes });
  };

  const saveEstimatedCoaDate = async () => {
    await patch({ estimated_coa_date: estimatedCoaDate || null });
  };

  const handleFinalize = async () => {
    setBusy(true);
    const updated = await finalizeQcInvoice(id, Number(discountPercent) || 0);
    setBusy(false);
    if (updated) {
      toast.success(`Invoice finalized: ${updated.invoice_no}`);
      await load();
    } else {
      toast.error('Failed to finalize invoice');
    }
  };

  const handleCoaUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let okCount = 0;
    for (const file of Array.from(files)) {
      const path = await uploadQcFile(id, file, 'qc-coa');
      if (path && (await appendQcCoaPath(id, path))) okCount++;
    }
    setBusy(false);
    if (okCount > 0) {
      toast.success(`Uploaded ${okCount} COA file(s)`);
      await load();
    } else {
      toast.error('Upload failed');
    }
  };

  const handleRemoveCoa = async (path: string) => {
    if (!window.confirm('Remove this COA file?')) return;
    setBusy(true);
    const ok = await removeQcCoaPath(id, path);
    setBusy(false);
    if (ok) {
      toast.success('COA removed');
      await load();
    } else {
      toast.error('Failed to remove COA');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!request) {
    return <p className="text-center py-8 text-red-500">Request not found</p>;
  }

  const paymentMeta = QC_PAYMENT_STATUS_LABELS[request.payment_status];
  const slipIsImage = isQcPaymentSlipImage(request.payment_slip_path);
  const finalized = Boolean(request.price_finalized);
  const hasSlip = Boolean(request.payment_slip_path);
  const paymentVerified = request.payment_status === 'verified';
  const canVerifyPayment = finalized && hasSlip && !paymentVerified;
  const canMoveToProcessing = finalized && paymentVerified;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 print:hidden">
        <Link href="/qc/requests">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Queue
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-mono">{request.qc_code}</h1>
          {request.invoice_no && (
            <p className="text-sm text-slate-500 font-mono">Invoice: {request.invoice_no}</p>
          )}
          <div className="flex gap-2 mt-1 flex-wrap">
            <Badge>{request.status}</Badge>
            <Badge className={paymentMeta.badgeClass}>{paymentMeta.label}</Badge>
            {finalized ? (
              <Badge className="bg-emerald-100 text-emerald-800">Price finalized</Badge>
            ) : (
              <Badge variant="outline" className="border-amber-300 text-amber-800">
                Awaiting finalize
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:block">
        <div className="lg:col-span-2 print:w-full">
          <QcInvoiceContent request={request} />
        </div>

        <Card className="lg:col-span-1 print:hidden lg:sticky lg:top-6 self-start">
          <CardHeader>
            <CardTitle>Lab Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Pricing / Finalize */}
            <div className="space-y-3 border-b pb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pricing</p>
              {!finalized ? (
                <>
                  <div>
                    <Label htmlFor="discount-percent">Discount (%)</Label>
                    <Input
                      id="discount-percent"
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  {previewTotals && (
                    <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span>{formatMoney(previewTotals.subtotal)}</span>
                      </div>
                      {previewTotals.discount_amount > 0 && (
                        <div className="flex justify-between text-emerald-700">
                          <span>Discount ({previewTotals.discount_percent}%)</span>
                          <span>−{formatMoney(previewTotals.discount_amount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>VAT 7%</span>
                        <span>{formatMoney(previewTotals.vat)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Grand Total</span>
                        <span>{formatMoney(previewTotals.grand_total)}</span>
                      </div>
                      <div className="flex justify-between text-amber-800">
                        <span>WHT 3%</span>
                        <span>−{formatMoney(previewTotals.wht_amount)}</span>
                      </div>
                      <div className="flex justify-between font-bold border-t pt-1 text-emerald-800">
                        <span>Net Payable</span>
                        <span>{formatMoney(previewTotals.net_payable)} THB</span>
                      </div>
                    </div>
                  )}
                  <Button
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    onClick={handleFinalize}
                    disabled={busy}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Finalize Invoice
                  </Button>
                  <p className="text-xs text-slate-500">
                    ลูกค้าจะเห็น QR ชำระเงินหลังกด Finalize และออกเลข Invoice
                  </p>
                </>
              ) : (
                <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
                  <p className="font-semibold">{request.invoice_no}</p>
                  <p className="mt-1">Net payable: {formatMoney(Number(request.net_payable))} THB</p>
                  {Number(request.discount_percent) > 0 && (
                    <p className="text-xs mt-1">Discount: {request.discount_percent}%</p>
                  )}
                </div>
              )}
            </div>

            {/* Status */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
              {request.status === 'new' && (
                <>
                  <Button
                    className="w-full"
                    onClick={moveToProcessing}
                    disabled={busy || !canMoveToProcessing}
                  >
                    <PlayCircle className="h-4 w-4 mr-1" />
                    Move to Processing
                  </Button>
                  {!canMoveToProcessing && (
                    <p className="text-xs text-amber-700">
                      {!finalized
                        ? 'ขั้นที่ 1: กด Finalize Invoice เพื่อยืนยันราคาและส่งให้ลูกค้าก่อน'
                        : !hasSlip
                          ? 'ขั้นที่ 2: รอลูกค้าอัปโหลดสลิปการชำระเงิน'
                          : 'ขั้นที่ 3: กด Confirm Payment ด้านล่างเพื่อยืนยันการชำระเงินก่อนเริ่มตรวจ'}
                    </p>
                  )}
                </>
              )}
              {request.status === 'processing' && (
                <p className="text-sm text-slate-500">Currently in processing.</p>
              )}
              {request.status === 'complete' && (
                <p className="text-sm text-emerald-600">Completed.</p>
              )}
            </div>

            {/* Payment */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Payment</p>
              <Badge className={paymentMeta.badgeClass}>{paymentMeta.label}</Badge>
              <p className="text-xs text-slate-500">{paymentMeta.helper}</p>
              {request.payment_slip_path ? (
                <>
                  {slipUrl && slipIsImage && (
                    <a href={slipUrl} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={slipUrl}
                        alt="Payment slip preview"
                        className="w-full rounded-md border border-slate-200 object-contain max-h-56 bg-slate-50"
                      />
                    </a>
                  )}
                  {slipUrl && !slipIsImage && (
                    <a href={slipUrl} target="_blank" rel="noreferrer">
                      <Button variant="outline" className="w-full">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View payment slip (PDF)
                      </Button>
                    </a>
                  )}
                  {!paymentVerified && (
                    <>
                      <Button
                        className="w-full bg-blue-600 hover:bg-blue-700"
                        onClick={verifyPayment}
                        disabled={busy || !canVerifyPayment}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Confirm Payment
                      </Button>
                      {!finalized && (
                        <p className="text-xs text-amber-700">
                          ต้อง Finalize Invoice ก่อนจึงจะยืนยันการชำระเงินได้
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-500">No payment slip uploaded yet. Waiting for customer payment.</p>
              )}
            </div>

            {/* Documents */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Documents</p>
              <Link href={`/qc/requests/${id}/invoice`} className="block">
                <Button variant="outline" className="w-full">
                  <FileText className="h-4 w-4 mr-1" />
                  View Invoice
                </Button>
              </Link>

              {coaUrls.length > 0 && (
                <ul className="space-y-2">
                  {coaUrls.map(({ path, url }, idx) => (
                    <li key={path} className="flex items-center gap-2">
                      <a href={url} target="_blank" rel="noreferrer" className="flex-1 min-w-0">
                        <Button variant="outline" size="sm" className="w-full truncate">
                          <ExternalLink className="h-4 w-4 mr-1 shrink-0" />
                          COA {idx + 1}
                        </Button>
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 shrink-0"
                        onClick={() => handleRemoveCoa(path)}
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <label className="block">
                <Button asChild variant="outline" className="w-full border-dashed">
                  <span className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1" />
                    Upload COA (multiple)
                  </span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  multiple
                  onChange={(e) => handleCoaUpload(e.target.files)}
                />
              </label>
            </div>

            {/* Estimated COA date */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Estimated COA Date
              </p>
              <Input
                type="date"
                value={estimatedCoaDate}
                onChange={(e) => setEstimatedCoaDate(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={saveEstimatedCoaDate}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save COA date
              </Button>
              <p className="text-xs text-slate-500">วันที่นี้จะแสดงให้ลูกค้าเห็นในพอร์ทัล</p>
            </div>

            {/* Lab notes */}
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lab Notes</p>
              <Textarea value={labNotes} onChange={(e) => setLabNotes(e.target.value)} rows={4} />
            </div>

            {request.status === 'processing' && (
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={markComplete} disabled={busy}>
                <CheckCircle className="h-4 w-4 mr-1" />
                Mark Complete
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
