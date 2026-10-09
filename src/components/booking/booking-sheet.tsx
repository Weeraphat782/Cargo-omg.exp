'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plane,
  Package,
  MapPin,
  Loader2,
  FileText,
  Download,
  AlertTriangle,
  ChevronDown,
  Calendar,
  User,
  Route,
  ExternalLink,
  Upload,
  CheckCircle2,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { EmailBookingData } from '@/lib/email-templates';
import type { Pallet } from '@/lib/db';
import JSZip from 'jszip';
import { toast } from 'sonner';

interface BookingDocument {
  id: string;
  file_name: string;
  original_file_name?: string;
  document_type?: string;
  document_type_name?: string;
  file_url: string;
  mime_type?: string;
  submitted_at?: string;
}

interface BookingQuotation {
  id: string;
  quotation_no?: string | null;
  company_name?: string | null;
  customer_name?: string | null;
  contact_person?: string | null;
  destination?: string | null;
  commodity_type?: string | null;
  pallets?: Pallet[];
  total_actual_weight?: number | null;
  total_volume_weight?: number | null;
  chargeable_weight?: number | null;
  booking_details?: EmailBookingData | Record<string, unknown> | null;
  awb_number?: string | null;
  awb_number_source?: string | null;
  docs_swapped_at?: string | null;
  docs_swapped_with?: string | null;
  docs_swap_checked_at?: string | null;
}

interface BookingPayload {
  quotation: BookingQuotation;
  documents: BookingDocument[];
  staff_files: {
    awb_url?: string | null;
    awb_file_name?: string | null;
    customs_url?: string | null;
    customs_file_name?: string | null;
  };
}

function commodityLabel(t?: string | null) {
  if (!t) return 'General';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function displayVal(value?: string | number | null) {
  if (value == null || String(value).trim() === '') return '—';
  return String(value);
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function DefItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value?: string | number | null;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
      {Icon && (
        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-slate-600" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{displayVal(value)}</p>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
  action,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const titleContent = (
    <>
      <Icon className="w-4 h-4 text-[#215497] shrink-0" />
      <span>{title}</span>
      {collapsible && (
        <ChevronDown
          className={`w-4 h-4 text-slate-500 ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
        />
      )}
    </>
  );

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 bg-slate-50/80">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex flex-1 items-center gap-2 text-sm font-bold text-slate-800 text-left min-w-0"
            aria-expanded={open}
          >
            {titleContent}
          </button>
        ) : (
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2 min-w-0">
            {titleContent}
          </h2>
        )}
        {action}
      </div>
      {(!collapsible || open) && <div className="p-5">{children}</div>}
    </section>
  );
}

export function BookingSheet({ token, readOnly }: { token: string; readOnly: boolean }) {
  const apiBase = readOnly
    ? `/api/booking/view/${encodeURIComponent(token)}`
    : `/api/booking/${encodeURIComponent(token)}`;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [payload, setPayload] = useState<BookingPayload | null>(null);
  const [zipLoading, setZipLoading] = useState(false);
  const [awbNumberInput, setAwbNumberInput] = useState('');
  const [extractingAwb, setExtractingAwb] = useState(false);
  const [submittingAwb, setSubmittingAwb] = useState(false);
  const [awbSubmitted, setAwbSubmitted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(apiBase);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setPayload((await res.json()) as BookingPayload);
    } catch (err) {
      console.error(err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (payload?.quotation?.awb_number) {
      setAwbNumberInput(payload.quotation.awb_number);
      if (payload.quotation.awb_number_source === 'airfreight') {
        setAwbSubmitted(true);
      }
    }
  }, [payload?.quotation?.awb_number, payload?.quotation?.awb_number_source]);

  const q = payload?.quotation;
  const details = (q?.booking_details || {}) as EmailBookingData;

  const palletRows = useMemo(() => {
    const pallets = q?.pallets || [];
    return pallets.map((p, i) => ({
      index: i + 1,
      dims: `${p.length} × ${p.width} × ${p.height}`,
      weight: Number(p.weight) || 0,
      qty: Number(p.quantity) || 1,
    }));
  }, [q?.pallets]);

  const documentRows = useMemo(() => {
    if (!payload) return [];
    const rows: { id: string; typeLabel: string; fileName: string; url: string }[] = [];
    for (const doc of payload.documents) {
      if (!doc.file_url) continue;
      rows.push({
        id: doc.id,
        typeLabel: doc.document_type_name || doc.document_type || 'Document',
        fileName: doc.original_file_name || doc.file_name || doc.id,
        url: doc.file_url,
      });
    }
    if (payload.staff_files.awb_url) {
      rows.push({
        id: 'staff-awb',
        typeLabel: 'Air Waybill (AWB)',
        fileName: payload.staff_files.awb_file_name || 'awb.pdf',
        url: payload.staff_files.awb_url,
      });
    }
    if (payload.staff_files.customs_url) {
      rows.push({
        id: 'staff-customs',
        typeLabel: 'Customs Declaration',
        fileName: payload.staff_files.customs_file_name || 'customs.pdf',
        url: payload.staff_files.customs_url,
      });
    }
    return rows;
  }, [payload]);

  const handleViewDocument = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleAwbFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !q?.id || readOnly) return;

    setExtractingAwb(true);
    setAwbSubmitted(false);
    try {
      const urlRes = await fetch('/api/generate-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || 'application/pdf',
          quotationId: q.id,
          documentType: 'awb',
        }),
      });
      if (!urlRes.ok) throw new Error('Upload URL failed');
      const { signedUrl, path } = await urlRes.json();

      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/pdf' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload failed');

      const extractRes = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'extract', filePath: path, fileName: file.name }),
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) {
        throw new Error(extractData.error || 'Could not save AWB file');
      }

      setAwbNumberInput(extractData.awb_number || '');
      if (extractData.gemini_failed || !extractData.awb_number) {
        toast.warning('AWB file saved — please enter the AWB number manually', {
          description: extractData.gemini_failed
            ? 'AI could not read the number from this file.'
            : 'No AWB number was detected in the document.',
        });
      } else {
        toast.success('AWB number detected — please verify before submitting');
      }
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'AWB upload failed');
    } finally {
      setExtractingAwb(false);
    }
  };

  const handleSubmitAwb = async () => {
    if (readOnly) return;
    const trimmed = awbNumberInput.trim();
    if (!trimmed) {
      toast.error('Enter the AWB number before submitting');
      return;
    }
    setSubmittingAwb(true);
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', awbNumber: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submit failed');
      setAwbSubmitted(true);
      toast.success('AWB submitted successfully');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Could not submit AWB');
    } finally {
      setSubmittingAwb(false);
    }
  };

  const handleDownloadAll = async () => {
    const docs = payload?.documents?.filter((d) => d.file_url) || [];
    const extras: { name: string; url: string }[] = [];
    if (payload?.staff_files.awb_url) {
      extras.push({
        name: payload.staff_files.awb_file_name || 'awb.pdf',
        url: payload.staff_files.awb_url,
      });
    }
    if (payload?.staff_files.customs_url) {
      extras.push({
        name: payload.staff_files.customs_file_name || 'customs.pdf',
        url: payload.staff_files.customs_url,
      });
    }
    const all = [
      ...docs.map((d) => ({
        name: d.original_file_name || d.file_name || `doc-${d.id}`,
        url: d.file_url,
      })),
      ...extras,
    ];
    if (all.length === 0) {
      toast.error('No documents to download');
      return;
    }
    setZipLoading(true);
    try {
      const zip = new JSZip();
      await Promise.all(
        all.map(async (item, i) => {
          try {
            const res = await fetch(item.url);
            if (!res.ok) return;
            const blob = await res.blob();
            const safeName = item.name.replace(/[/\\?%*:|"<>]/g, '_') || `file-${i}`;
            zip.file(safeName, blob);
          } catch {
            /* skip */
          }
        })
      );
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `booking_${q?.quotation_no || token.slice(0, 8)}_documents.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('ZIP downloaded');
    } catch {
      toast.error('Failed to create ZIP');
    } finally {
      setZipLoading(false);
    }
  };

  const netWeight =
    details.netWeight != null
      ? `${details.netWeight} kg`
      : q?.total_actual_weight
        ? `${q.total_actual_weight} kg`
        : '—';

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 flex flex-col items-center justify-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white shadow-md flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-[#215497]" />
        </div>
        <p className="text-sm font-medium text-slate-600">Loading booking sheet…</p>
      </div>
    );
  }

  if (notFound || !payload || !q) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full rounded-2xl bg-white border border-slate-200 shadow-lg p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Booking link not found</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            This link is invalid or has expired. Contact the sender for a new link.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white">
      <header
        className="sticky top-0 z-20 shadow-md"
        style={{ background: 'linear-gradient(135deg, #215497 0%, #2c6bb8 100%)' }}
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 sm:py-6">
          <div className="min-w-0 text-white">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-white/15 text-[10px] font-bold uppercase tracking-widest mb-3">
              <Plane className="w-3.5 h-3.5" />
              {readOnly ? 'Shipment documents' : 'Air Freight Booking'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {q.quotation_no || q.id.slice(0, 8)}
            </h1>
            <p className="text-blue-100/90 font-medium mt-1 truncate">{q.company_name}</p>
            {q.destination && (
              <span className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full bg-white/15 text-sm font-medium">
                <MapPin className="w-3.5 h-3.5" />
                {q.destination}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6 pb-12">
        {!readOnly && q.docs_swapped_at && (
          <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="text-sm leading-relaxed">
              <p className="font-bold">Documents swapped</p>
              <p>
                Document set was exchanged with{' '}
                <strong>{q.docs_swapped_with || 'another OMG'}</strong> on{' '}
                {new Date(q.docs_swapped_at).toLocaleString('en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                . Please use the documents below for this booking.
              </p>
              <p className="mt-1 text-xs font-semibold">
                {q.docs_swap_checked_at
                  ? `Verified by OMG team on ${new Date(q.docs_swap_checked_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : 'Pending verification by OMG team'}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="Net weight" value={netWeight} />
          <StatTile
            label="Chargeable"
            value={q.chargeable_weight ? `${q.chargeable_weight} kg` : '—'}
          />
          <StatTile
            label="Volume weight"
            value={
              q.total_volume_weight ? `${Math.ceil(Number(q.total_volume_weight))} kg` : '—'
            }
          />
          <StatTile
            label="Commodity"
            value={commodityLabel(q.commodity_type)}
            sub={details.numberOfPieces || undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-6">
            <SectionCard title="Shipment" icon={MapPin}>
              <DefItem label="Shipper" value={q.company_name} icon={User} />
              <DefItem label="Contact" value={q.contact_person || q.customer_name} icon={User} />
              <DefItem label="Destination" value={q.destination} icon={MapPin} />
            </SectionCard>

            {palletRows.length > 0 && (
              <SectionCard
                title={`Pallets (${palletRows.length})`}
                icon={Package}
                collapsible
                defaultOpen={false}
              >
                <div className="overflow-x-auto -mx-1 rounded-xl border border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-3">#</th>
                        <th className="px-4 py-3">Dimensions (cm)</th>
                        <th className="px-4 py-3">Weight</th>
                        <th className="px-4 py-3">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {palletRows.map((row, i) => (
                        <tr
                          key={row.index}
                          className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}
                        >
                          <td className="px-4 py-3 font-medium text-slate-700">{row.index}</td>
                          <td className="px-4 py-3 tabular-nums">{row.dims}</td>
                          <td className="px-4 py-3 tabular-nums">{row.weight} kg</td>
                          <td className="px-4 py-3 tabular-nums">{row.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            )}

            <SectionCard title="Documents" icon={FileText}>
              {documentRows.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">No documents uploaded yet.</p>
              ) : (
                <div className="space-y-3">
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden">
                    {documentRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-slate-50/80"
                      >
                        <FileText className="w-4 h-4 text-[#215497] shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-800 truncate">{row.typeLabel}</p>
                          <p className="text-[11px] text-slate-500 truncate">{row.fileName}</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs shrink-0"
                          onClick={() => handleViewDocument(row.url)}
                        >
                          <ExternalLink className="w-3.5 h-3.5 mr-1" />
                          View
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    className="w-full bg-[#215497] hover:bg-[#1a4378] text-white"
                    onClick={handleDownloadAll}
                    disabled={zipLoading}
                  >
                    {zipLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    Download all (ZIP)
                  </Button>
                </div>
              )}
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard title="Airway Bill (AWB)" icon={Plane}>
              {readOnly ? (
                <DefItem label="AWB number" value={q.awb_number || 'Pending'} />
              ) : (
                <>
                  {awbSubmitted && (
                    <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      AWB submitted
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="awb-upload" className="text-xs font-semibold text-slate-700 mb-2 block">
                        Upload Air Waybill
                      </Label>
                      <label
                        htmlFor="awb-upload"
                        className={`flex items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed px-4 py-6 cursor-pointer transition-colors ${
                          extractingAwb
                            ? 'border-slate-200 bg-slate-50 opacity-60 pointer-events-none'
                            : 'border-[#215497]/30 bg-slate-50 hover:bg-blue-50/50 hover:border-[#215497]/50'
                        }`}
                      >
                        {extractingAwb ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin text-[#215497]" />
                            <span className="text-sm font-medium text-slate-600">Reading AWB number…</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-5 h-5 text-[#215497]" />
                            <span className="text-sm font-medium text-slate-700">
                              Choose AWB file (PDF or image)
                            </span>
                          </>
                        )}
                        <input
                          id="awb-upload"
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp"
                          className="sr-only"
                          onChange={handleAwbFileSelect}
                          disabled={extractingAwb}
                        />
                      </label>
                    </div>

                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50/80 p-4 ring-2 ring-amber-200/60">
                      <Label
                        htmlFor="awb-number"
                        className="text-xs font-bold uppercase tracking-wider text-amber-900 mb-2 block"
                      >
                        AWB Number — verify before submit
                      </Label>
                      <Input
                        id="awb-number"
                        type="text"
                        placeholder="e.g. 123-45678901"
                        value={awbNumberInput}
                        onChange={(e) => {
                          setAwbNumberInput(e.target.value);
                          setAwbSubmitted(false);
                        }}
                        className="bg-white border-amber-300 focus-visible:ring-amber-500 font-semibold text-slate-900"
                      />
                      <p className="text-[11px] text-amber-800/80 mt-2">
                        Auto-filled after upload. Edit if needed, then submit.
                      </p>
                    </div>

                    <Button
                      type="button"
                      className="w-full bg-[#215497] hover:bg-[#1a4378] text-white"
                      onClick={handleSubmitAwb}
                      disabled={submittingAwb || extractingAwb || !awbNumberInput.trim()}
                    >
                      {submittingAwb ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                      )}
                      Submit AWB
                    </Button>
                  </div>
                </>
              )}
            </SectionCard>

            <SectionCard title="Booking request" icon={Plane}>
              <DefItem label="Product" value={details.product} />
              <DefItem label="Airline" value={details.airline} />
              <DefItem
                label="Preferred shipment date"
                value={details.preferredShipmentDate}
                icon={Calendar}
              />
              <DefItem label="Pick-up" value={details.pickupLocation} />
              <DefItem label="Origin" value={details.origin} />
              <DefItem label="Consignee" value={details.consignee} icon={User} />
              <DefItem label="Routing" value={details.routing} icon={Route} />
              <DefItem label="Pieces" value={details.numberOfPieces} icon={Package} />
              <DefItem label="Pallet dimensions" value={details.palletDimensions} />
              <DefItem label="MAWB (requested)" value={details.mawb} />
            </SectionCard>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-400 py-6 border-t border-slate-200/60 bg-white/50">
        OMG Experience — Air Freight Booking
      </footer>
    </div>
  );
}
