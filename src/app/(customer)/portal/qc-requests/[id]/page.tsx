'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, ExternalLink, Loader2, Package, Printer, QrCode, Trash2, Upload } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { canDeleteQcRequest, deleteQcRequest, getQcRequestById, updateQcRequest } from '@/lib/qc-db';
import { QcInvoiceContent } from '@/components/qc/qc-invoice-content';
import { QcInvoicePreview } from '@/components/qc/qc-invoice-preview';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getFileUrl } from '@/lib/storage';
import { browserAuthHeaders } from '@/lib/browser-auth';
import { toast } from 'sonner';
import {
  getQcCoaPaths,
  isQcPaymentSlipImage,
  QC_PAYMENT_QR_IMAGE,
  QC_PAYMENT_STATUS_LABELS,
  QC_REQUEST_FORM_FILE,
} from '@/lib/qc-types';
import type { QcRequest } from '@/lib/qc-types';

async function uploadQcFile(qcRequestId: string, file: File): Promise<string | null> {
  const generateUrlResponse = await fetch('/api/generate-upload-url', {
    method: 'POST',
    headers: await browserAuthHeaders(null, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      qcRequestId,
      documentType: 'qc-payment-slip',
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

function formatMoney(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PortalQcRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user } = useCustomerAuth();
  const [request, setRequest] = useState<QcRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [coaUrls, setCoaUrls] = useState<{ path: string; url: string }[]>([]);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [paymentQrOpen, setPaymentQrOpen] = useState(false);
  const sampleQrRef = useRef<HTMLDivElement>(null);

  const scanUrl =
    typeof window !== 'undefined' && request
      ? `${window.location.origin}/qc/scan/${request.qc_code}`
      : '';

  const priceFinalized = Boolean(request?.price_finalized);

  const paymentMeta = request ? QC_PAYMENT_STATUS_LABELS[request.payment_status] : null;
  const slipIsImage = isQcPaymentSlipImage(request?.payment_slip_path);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getQcRequestById(id);
    if (data && user && data.customer_user_id !== user.id) {
      setRequest(null);
      setSlipUrl(null);
      setCoaUrls([]);
    } else {
      setRequest(data);
      if (data?.payment_slip_path) {
        setSlipUrl(await getFileUrl(data.payment_slip_path, 'r2'));
      } else {
        setSlipUrl(null);
      }
      if (data) {
        const paths = getQcCoaPaths(data);
        const resolved = await Promise.all(
          paths.map(async (path) => ({ path, url: (await getFileUrl(path, 'r2')) || '' }))
        );
        setCoaUrls(resolved.filter((r) => r.url));
      } else {
        setCoaUrls([]);
      }
    }
    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const handleSlipUpload = async (file: File) => {
    setUploading(true);
    const path = await uploadQcFile(id, file);
    if (!path) {
      toast.error('Upload failed');
      setUploading(false);
      return;
    }
    const ok = await updateQcRequest(
      id,
      {
        payment_slip_path: path,
        payment_status: 'paid',
      },
      { asCustomer: true }
    );
    setUploading(false);
    if (ok) {
      toast.success('Payment slip uploaded');
      await load();
    } else {
      toast.error('Failed to save slip');
    }
  };

  const handleDelete = async () => {
    if (!request) return;
    if (!window.confirm(`Delete QC request ${request.qc_code}? This cannot be undone.`)) return;
    setDeleting(true);
    const ok = await deleteQcRequest(request.id);
    setDeleting(false);
    if (ok) {
      toast.success('QC request deleted');
      router.push('/portal/qc-requests');
    } else {
      toast.error('Failed to delete request');
    }
  };

  const downloadQr = (ref: React.RefObject<HTMLDivElement | null>, filename: string) => {
    const canvas = ref.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const downloadPaymentQr = async () => {
    if (!request) return;
    try {
      const res = await fetch(QC_PAYMENT_QR_IMAGE);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${request.qc_code}-payment-qr.jpg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('ดาวน์โหลด QR ไม่สำเร็จ');
    }
  };

  const openInvoicePrintPage = () => {
    window.open(`/portal/qc-requests/${id}/invoice`, '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!request) {
    return <p className="text-center py-8 text-red-500">Request not found</p>;
  }

  return (
    <div className="space-y-6">
      <Link href="/portal/qc-requests" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to QC Requests
      </Link>

      {/* Row 1 — QC code + badges (full width) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold font-mono leading-none">{request.qc_code}</h1>
            {request.invoice_no && (
              <p className="text-sm text-slate-500 font-mono leading-none">
                Invoice: {request.invoice_no}
              </p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{request.status}</Badge>
            {paymentMeta && <Badge className={paymentMeta.badgeClass}>{paymentMeta.label}</Badge>}
            {priceFinalized ? (
              <Badge className="bg-emerald-100 text-emerald-800">ยืนยันราคาแล้ว</Badge>
            ) : (
              <Badge variant="outline" className="border-amber-300 text-amber-800">
                รอยืนยันราคา
              </Badge>
            )}
          </div>
        </div>
        {canDeleteQcRequest(request) && (
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="shrink-0">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1 text-red-500" />}
            Delete
          </Button>
        )}
      </div>

      {/* Estimated COA date */}
      <p className="text-sm rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2">
        <span className="text-slate-600">วันที่คาดว่าจะได้รับ COA: </span>
        {request.estimated_coa_date ? (
          <span className="font-semibold text-emerald-700">
            {new Date(request.estimated_coa_date).toLocaleDateString('en-GB', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        ) : (
          <span className="font-medium text-amber-600">ห้องแล็บยังไม่ได้ระบุวันที่</span>
        )}
      </p>

      {/* Row A — invoice | payment QR | sample QR (full width) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
        <QcInvoicePreview request={request} onViewFull={() => setInvoiceOpen(true)} />

        {!priceFinalized ? (
          <Card className="h-full border-2 border-amber-300 bg-amber-50/60 shadow-sm">
            <CardContent className="p-3 h-full flex flex-col text-xs text-amber-800 space-y-1.5">
              <p className="text-sm font-semibold text-amber-900">ราคากำลังตรวจสอบ</p>
              <p>ห้องปฏิบัติการกำลังตรวจสอบและยืนยันราคา อาจมีการปรับส่วนลดตามปริมาณตัวอย่าง</p>
              <p className="font-medium">QR ชำระเงินจะแสดงหลังห้องแล็บ Finalize Invoice</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full border-2 border-amber-300 bg-amber-50/60 shadow-sm">
            <CardContent className="p-3 h-full flex flex-col space-y-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-amber-500 p-1.5 shrink-0">
                  <QrCode className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-900">ชำระเงิน</p>
                  <p className="text-[10px] text-amber-700">PromptPay / โอนบัญชี</p>
                </div>
              </div>
              <div className="rounded-md border border-amber-200 bg-white/80 px-3 py-2 text-center">
                <p className="text-[10px] text-amber-700">ยอดสุทธิชำระ</p>
                <p className="text-lg font-bold text-amber-900 tabular-nums">
                  {formatMoney(request.net_payable)} <span className="text-sm font-semibold">THB</span>
                </p>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                กดปุ่มด้านล่างเพื่อดู QR Code สำหรับชำระเงิน
              </p>
              <Button
                className="w-full mt-auto bg-amber-600 hover:bg-amber-700"
                onClick={() => setPaymentQrOpen(true)}
              >
                <QrCode className="h-4 w-4 mr-1" />
                คลิกเพื่อชำระเงิน
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="h-full border-2 border-emerald-300 bg-emerald-50/50 shadow-sm md:col-span-2 lg:col-span-1">
          <CardContent className="p-3 h-full flex flex-col space-y-3">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-emerald-600 p-1.5 shrink-0">
                <Package className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-900">Sample QR</p>
                <p className="text-[10px] text-emerald-700 font-mono truncate">{request.qc_code}</p>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center rounded-md border border-emerald-200 bg-white/80 p-3">
              <div ref={sampleQrRef} className="rounded border-2 border-emerald-300 p-2 bg-white shrink-0">
                <QRCodeCanvas value={scanUrl} size={88} level="M" fgColor="#047857" />
              </div>
            </div>

            <p className="text-xs text-emerald-800 leading-relaxed">
              ติด Lot No. + QR ทุกถุงก่อนส่งตัวอย่าง
            </p>

            <div className="flex gap-2 mt-auto">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                onClick={() => downloadQr(sampleQrRef, `${request.qc_code}-sample-qr.png`)}
              >
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
              <a href={scanUrl} target="_blank" rel="noreferrer">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                >
                  <QrCode className="h-4 w-4" />
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row B — form | payment slip | COA (full width) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">QC Request Form (FM-QC-019)</CardTitle>
            <p className="text-xs text-slate-500">
              ดาวน์โหลด พิมพ์ และติ๊กด้วยตนเอง แล้วแนบไปกับตัวอย่าง
            </p>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <a href={QC_REQUEST_FORM_FILE} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm" className="w-full">
                <Download className="h-4 w-4 mr-2" />
                ดาวน์โหลดฟอร์ม FM-QC-019
              </Button>
            </a>
            <ol className="text-xs text-slate-600 space-y-1 list-decimal list-inside">
              <li>ดาวน์โหลดและพิมพ์แบบฟอร์ม</li>
              <li>ติ๊กรายการทดสอบและกรอกข้อมูล</li>
              <li>แนบแบบฟอร์มมาพร้อมตัวอย่าง</li>
            </ol>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Payment Slip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {paymentMeta && (
              <div className="space-y-1">
                <Badge className={paymentMeta.badgeClass}>{paymentMeta.label}</Badge>
                <p className="text-xs text-slate-500">{paymentMeta.helper}</p>
              </div>
            )}

            {!priceFinalized ? (
              <p className="text-sm text-amber-700">
                กรุณารอห้องปฏิบัติการยืนยันราคาและออก Invoice ก่อน จึงจะอัปโหลดสลิปการชำระเงินได้
              </p>
            ) : request.payment_slip_path && slipUrl ? (
              <div className="space-y-3">
                {slipIsImage ? (
                  <a href={slipUrl} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={slipUrl}
                      alt="Payment slip preview"
                      className="w-full rounded-md border border-slate-200 object-contain max-h-48 bg-slate-50"
                    />
                  </a>
                ) : (
                  <a href={slipUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm">
                      <ExternalLink className="h-4 w-4 mr-1" />
                      View slip (PDF)
                    </Button>
                  </a>
                )}
                <label>
                  <Button asChild variant="ghost" size="sm" disabled={uploading}>
                    <span className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-1" />
                      Replace slip
                    </span>
                  </Button>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleSlipUpload(f);
                    }}
                  />
                </label>
              </div>
            ) : (
              <label className="block">
                <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={uploading}>
                  <span className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1" />
                    Upload payment slip
                  </span>
                </Button>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSlipUpload(f);
                  }}
                />
              </label>
            )}
            {uploading && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge>{request.status}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`h-full md:col-span-2 lg:col-span-1 ${
            coaUrls.length > 0
              ? 'border-2 border-emerald-300 bg-emerald-50/60'
              : 'border-2 border-amber-300 bg-amber-50/60'
          }`}
        >
          <CardHeader className="pb-2">
            <CardTitle
              className={`text-sm ${coaUrls.length > 0 ? 'text-emerald-900' : 'text-amber-900'}`}
            >
              Certificate of Analysis
            </CardTitle>
            <p className={`text-xs ${coaUrls.length > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {coaUrls.length > 0
                ? `${coaUrls.length} ไฟล์ พร้อมดาวน์โหลด`
                : 'ห้องปฏิบัติการยังไม่ได้แนบ COA'}
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            {coaUrls.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {coaUrls.map(({ url }, idx) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Download COA {coaUrls.length > 1 ? idx + 1 : ''}
                    </Button>
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-800">
                เมื่อห้องปฏิบัติการแนบ COA แล้ว ปุ่มดาวน์โหลดจะปรากฏที่นี่
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Invoice popup */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl lg:max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="flex flex-row items-center justify-between gap-4 pr-8">
            <DialogTitle>ใบแจ้งหนี้ (QC Invoice)</DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={openInvoicePrintPage}
            >
              <Printer className="h-4 w-4 mr-1" />
              พิมพ์ / Save as PDF
            </Button>
          </DialogHeader>
          <div className="bg-white">
            <QcInvoiceContent request={request} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment QR popup */}
      <Dialog open={paymentQrOpen} onOpenChange={setPaymentQrOpen}>
        <DialogContent className="w-[95vw] sm:max-w-sm max-h-[90vh] overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>ช่องทางการชำระเงิน</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={QC_PAYMENT_QR_IMAGE}
              alt="ช่องทางการชำระเงิน"
              className="w-full h-auto rounded-md border border-amber-200"
            />
            <p className="text-center text-sm font-semibold text-amber-900">
              ยอดสุทธิ {formatMoney(request.net_payable)} THB
            </p>
            <Button
              variant="outline"
              className="w-full border-amber-300 text-amber-900 hover:bg-amber-100"
              onClick={downloadPaymentQr}
            >
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
